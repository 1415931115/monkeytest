import * as THREE from 'three';
import type { Input } from '../core/Input';
import { LOW_SPEC } from '../core/Quality';
import { clampToCorridor, type ColliderGrid } from '../game/LevelPath';

export const PLAYER = {
  eyeHeight: 1.62,
  radius: 0.35,
  walkSpeed: 7.2,
  sprintSpeed: 11.5,
  accel: 22,
  staminaMax: 100,
  staminaDrain: 24,
  staminaRegen: 16,
  batteryMax: 100,
  batteryDrain: 1.6,
  batteryRegen: 4.5,
  healthMax: 100,
};

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** First-person monkey thief: movement, look, stamina, flashlight battery, viewmodel. */
export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = PLAYER.healthMax;
  stamina = PLAYER.staminaMax;
  battery = PLAYER.batteryMax;
  lightOn = true;
  sprinting = false;
  frozen = false;
  /** While picking, the body is rooted (look still free). */
  rooted = false;
  private staminaLock = 0;
  private bobPhase = 0;
  private shake = 0;
  private batteryLock = false;
  readonly forward = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly flashlight: THREE.SpotLight;
  private readonly lightDir = new THREE.Vector3(0, 0, -1);
  readonly viewmodel = new THREE.Group();
  private readonly lens: THREE.MeshStandardMaterial;
  private readonly flameHalo: THREE.MeshStandardMaterial;
  private readonly handPivot = new THREE.Group();
  private flicker = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    this.flashlight = new THREE.SpotLight('#ffb07a', 0, 34, 0.5, 0.7, 1.4);
    this.flashlight.castShadow = !LOW_SPEC;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.3;
    this.flashlight.shadow.camera.far = 22;
    this.flashlight.shadow.bias = -0.0004;
    this.flashlight.shadow.normalBias = 0.03;
    scene.add(this.flashlight, this.flashlight.target);

    // Viewmodel: monkey hand gripping the bail of an antique caged lantern.
    const fur = new THREE.MeshStandardMaterial({ color: '#5a3b26', roughness: 1 });
    const palm = new THREE.MeshStandardMaterial({ color: '#8a6a55', roughness: 0.8 });
    const wrap = new THREE.MeshStandardMaterial({ color: '#2a1a14', roughness: 0.95 });
    const bronze = new THREE.MeshStandardMaterial({ color: '#8a6a35', roughness: 0.5, metalness: 0.85 });
    const iron = new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.55, metalness: 0.8 });
    this.lens = new THREE.MeshStandardMaterial({ color: '#ff5a2a', emissive: '#ff5a2a', emissiveIntensity: 3 });
    this.flameHalo = new THREE.MeshStandardMaterial({
      color: '#c9a227',
      emissive: '#c9a227',
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const add = (mesh: THREE.Mesh, x = 0, y = 0, z = 0): THREE.Mesh => {
      mesh.position.set(x, y, z);
      this.handPivot.add(mesh);
      return mesh;
    };
    /** Capsule (finger segment) spanning two points in handPivot space. */
    const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
      const d = b.clone().sub(a);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, d.length(), 3, 6), palm);
      m.quaternion.setFromUnitVectors(UP, d.normalize());
      add(m).position.copy(a).lerp(b, 0.5);
    };

    // Lantern, centred on the pivot: hollow spherical cage with a flame inside.
    const R = 0.058;
    const meridian = new THREE.TorusGeometry(R, 0.0028, 5, 24);
    for (let i = 0; i < 3; i++) add(new THREE.Mesh(meridian, bronze)).rotation.y = (i * Math.PI) / 3;
    for (const lat of [-0.6, 0, 0.6]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * Math.cos(lat), 0.0028, 5, 24), iron);
      ring.rotation.x = Math.PI / 2;
      add(ring, 0, R * Math.sin(lat), 0);
    }
    add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), this.lens));
    add(new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), this.flameHalo));
    // Pointed lid and foot.
    add(new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.05, 12), iron), 0, 0.075, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.016, 12), iron), 0, -0.06, 0);
    const footRing = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.004, 5, 18), bronze);
    footRing.rotation.x = Math.PI / 2;
    add(footRing, 0, -0.068, 0);
    // Short stem, crossbar and arched bail; the fist closes around the arch top.
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.024, 6), bronze), 0, 0.11, 0);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.064, 6), bronze);
    bar.rotation.z = Math.PI / 2;
    add(bar, 0, 0.12, 0);
    add(new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.0035, 5, 16, Math.PI), bronze), 0, 0.12, 0);

    // Forearm rises from the lower right into the fist, wrapped in dark cloth.
    const wrist = new THREE.Vector3(0.012, 0.165, 0.055);
    const elbow = new THREE.Vector3(0.13, -0.06, 0.4);
    const armAxis = wrist.clone().sub(elbow);
    const armLength = armAxis.length();
    armAxis.normalize();
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.066, armLength, 10), fur);
    forearm.quaternion.setFromUnitVectors(UP, armAxis);
    add(forearm).position.copy(elbow).lerp(wrist, 0.5);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35);
    for (const t of [0.42, 0.62, 0.82]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry((0.066 - 0.018 * t) * 1.04, 0.007, 5, 18), wrap);
      band.scale.z = 2.6;
      band.quaternion.setFromUnitVectors(FORWARD, armAxis).multiply(tilt);
      add(band).position.copy(elbow).lerp(wrist, t);
    }

    // Palm behind the bail; four fingers over it, thumb closing from below.
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), palm);
    hand.scale.set(0.95, 0.75, 0.8);
    add(hand, 0.005, 0.165, 0.032);
    for (let i = 0; i < 4; i++) {
      const x = -0.036 + i * 0.024;
      const knuckle = new THREE.Vector3(x, 0.18, 0.012);
      const joint = new THREE.Vector3(x, 0.176, -0.02);
      limb(knuckle, joint, 0.011);
      limb(joint, new THREE.Vector3(x, 0.142, -0.024), 0.01);
    }
    limb(new THREE.Vector3(0.04, 0.14, 0.03), new THREE.Vector3(0.012, 0.136, -0.012), 0.012);
    this.handPivot.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    this.viewmodel.add(this.handPivot);
    this.viewmodel.position.set(0.24, -0.17, -0.42);
    camera.add(this.viewmodel);
  }

  reset(pos: THREE.Vector3, yaw: number): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = PLAYER.healthMax;
    this.stamina = PLAYER.staminaMax;
    this.battery = PLAYER.batteryMax;
    this.lightOn = true;
    this.frozen = false;
    this.rooted = false;
    this.shake = 0;
    this.batteryLock = false;
    this.lightDir.set(0, 0, -1);
    this.syncCamera(0, 0);
    this.lightDir.copy(this.forward);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  knockback(from: THREE.Vector3, strength: number): void {
    const d = this.position.clone().sub(from).setY(0);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize().multiplyScalar(strength);
    this.velocity.add(d);
  }

  /** Returns true when the flashlight state toggled. */
  update(dt: number, elapsed: number, input: Input, colliders: ColliderGrid, lightToggle: boolean): boolean {
    let toggled = false;
    if (!this.frozen) {
      const look = input.consumeLook();
      this.yaw -= look.dx;
      // Vertical look disabled — pin pitch level.
      this.pitch = 0;
    } else {
      input.consumeLook();
    }

    // flashlight & battery
    if (lightToggle && !this.frozen) {
      if (this.lightOn || !this.batteryLock) {
        this.lightOn = !this.lightOn;
        toggled = true;
      }
    }
    if (this.lightOn) {
      this.battery = Math.max(0, this.battery - PLAYER.batteryDrain * dt);
      if (this.battery <= 0) {
        this.lightOn = false;
        this.batteryLock = true;
        toggled = true;
      }
    } else {
      this.battery = Math.min(PLAYER.batteryMax, this.battery + PLAYER.batteryRegen * dt);
      if (this.battery > 25) this.batteryLock = false;
    }

    // movement
    const canMove = !this.frozen && !this.rooted;
    const mx = canMove ? input.moveX : 0;
    const my = canMove ? input.moveY : 0;
    const wantsSprint = input.sprint && my > 0.2 && this.stamina > 0 && this.staminaLock <= 0;
    this.sprinting = wantsSprint;
    if (wantsSprint) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      if (this.stamina <= 0) this.staminaLock = 1.4;
    } else {
      this.staminaLock -= dt;
      if (this.staminaLock <= 0) this.stamina = Math.min(PLAYER.staminaMax, this.stamina + PLAYER.staminaRegen * dt);
    }
    const speed = wantsSprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // camera forward on xz is (-sin, -cos); right is (cos, -sin)
    const tx = (-sin * my + cos * mx) * speed;
    const tz = (-cos * my - sin * mx) * speed;
    const a = 1 - Math.exp(-PLAYER.accel * dt);
    this.velocity.x += (tx - this.velocity.x) * a;
    this.velocity.z += (tz - this.velocity.z) * a;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    colliders.resolve(this.position, PLAYER.radius);
    clampToCorridor(this.position, PLAYER.radius);

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.bobPhase += horizSpeed * dt * (wantsSprint ? 1.45 : 1.75);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.syncCamera(elapsed, horizSpeed);

    // flashlight follows the view with a slight physical lag
    const lag = 1 - Math.exp(-dt * 18);
    this.lightDir.lerp(this.forward, lag).normalize();
    const lowBattery = this.battery < 18;
    this.flicker = lowBattery && Math.sin(elapsed * 31) * Math.sin(elapsed * 7.7) > 0.55 ? 0.25 : 1;
    const targetI = this.lightOn ? 62 * this.flicker : 0;
    this.flashlight.intensity += (targetI - this.flashlight.intensity) * Math.min(1, dt * 30);
    this.flashlight.position.copy(this.eye).addScaledVector(this.rightVec(), 0.18).y -= 0.18;
    this.flashlight.target.position.copy(this.flashlight.position).addScaledVector(this.lightDir, 10);
    this.lens.emissiveIntensity = this.lightOn ? 3 * this.flicker : 0.12;
    this.lens.color.set(this.lightOn ? '#ff5a2a' : '#3a1a12');
    this.flameHalo.emissiveIntensity = this.lightOn ? 1.6 * this.flicker : 0;
    this.flameHalo.opacity = this.lightOn ? 0.45 : 0;

    // viewmodel sway
    const bob = Math.sin(this.bobPhase * 2) * 0.012 * Math.min(1, horizSpeed / 3);
    this.viewmodel.position.set(0.24 + Math.cos(this.bobPhase) * 0.01, -0.17 + bob - (this.rooted ? 0.05 : 0), -0.42 + (this.rooted ? 0.06 : 0));
    this.handPivot.rotation.set(this.rooted ? -0.35 : 0, this.rooted ? 0.25 : 0, 0);
    return toggled;
  }

  private readonly right = new THREE.Vector3();
  private readonly lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  rightVec(): THREE.Vector3 {
    return this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  syncCamera(elapsed: number, horizSpeed: number): void {
    const bobAmt = Math.min(1, horizSpeed / PLAYER.walkSpeed) * 0.045;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmt;
    const bobX = Math.cos(this.bobPhase) * bobAmt * 0.5;
    const s = this.shake * this.shake;
    const shx = (Math.sin(elapsed * 61) + Math.sin(elapsed * 37)) * 0.04 * s;
    const shy = (Math.sin(elapsed * 53) + Math.cos(elapsed * 29)) * 0.04 * s;
    this.eye.set(this.position.x, this.position.y + PLAYER.eyeHeight, this.position.z);
    this.camera.position.set(this.eye.x + bobX * Math.cos(this.yaw), this.eye.y + bobY, this.eye.z - bobX * Math.sin(this.yaw));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch + shy, this.yaw + shx, shx * 0.5);
    this.lookEuler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.forward.set(0, 0, -1).applyEuler(this.lookEuler);
  }

  /** Horizontal camera forward. */
  flatForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
