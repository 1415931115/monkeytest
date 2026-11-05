import * as THREE from 'three';
import type { Input } from '../core/Input';
import { LOW_SPEC } from '../core/Quality';
import { clampToCorridor, type ColliderGrid } from '../game/LevelPath';

export const PLAYER = {
  eyeHeight: 1.62,
  radius: 0.35,
  walkSpeed: 3.8,
  sprintSpeed: 6.7,
  accel: 14,
  staminaMax: 100,
  staminaDrain: 24,
  staminaRegen: 16,
  batteryMax: 100,
  batteryDrain: 1.6,
  batteryRegen: 4.5,
  healthMax: 100,
};

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
  private readonly handPivot = new THREE.Group();
  private flicker = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    this.flashlight = new THREE.SpotLight('#fff1d6', 0, 34, 0.46, 0.55, 1.4);
    this.flashlight.castShadow = !LOW_SPEC;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.3;
    this.flashlight.shadow.camera.far = 22;
    this.flashlight.shadow.bias = -0.0004;
    this.flashlight.shadow.normalBias = 0.03;
    scene.add(this.flashlight, this.flashlight.target);

    // Viewmodel: furry monkey hand gripping a brass-and-black flashlight.
    const fur = new THREE.MeshStandardMaterial({ color: '#5a3b26', roughness: 1 });
    const palm = new THREE.MeshStandardMaterial({ color: '#8a6a55', roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.35, metalness: 0.8 });
    const brass = new THREE.MeshStandardMaterial({ color: '#a8823c', roughness: 0.3, metalness: 0.9 });
    this.lens = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#fff1c8', emissiveIntensity: 3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.24, 14), metal);
    body.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.03, 0.07, 16), brass);
    head.rotation.x = Math.PI / 2;
    head.position.z = -0.15;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), this.lens);
    lens.position.z = -0.186;
    lens.rotation.y = Math.PI;
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 14), brass);
    grip.position.z = 0.05;
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.36, 10), fur);
    forearm.rotation.x = Math.PI / 2 - 0.25;
    forearm.position.set(0.02, -0.05, 0.22);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), palm);
    hand.scale.set(1, 0.8, 1.3);
    hand.position.set(0.01, -0.02, 0.02);
    this.handPivot.add(body, head, lens, grip, forearm, hand);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.04, 3, 6), palm);
      finger.rotation.z = Math.PI / 2;
      finger.position.set(-0.025, 0.0, -0.035 + i * 0.024);
      this.handPivot.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.035, 3, 6), palm);
    thumb.position.set(0.02, 0.03, -0.02);
    thumb.rotation.x = 0.8;
    this.handPivot.add(thumb);
    this.handPivot.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    this.viewmodel.add(this.handPivot);
    this.viewmodel.position.set(0.24, -0.22, -0.38);
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
      this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy, -1.35, 1.35);
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
    this.lens.emissiveIntensity = this.lightOn ? 3 * this.flicker : 0.0;
    this.lens.color.set(this.lightOn ? '#fff7e0' : '#3a3a36');

    // viewmodel sway
    const bob = Math.sin(this.bobPhase * 2) * 0.012 * Math.min(1, horizSpeed / 3);
    this.viewmodel.position.set(0.24 + Math.cos(this.bobPhase) * 0.01, -0.22 + bob - (this.rooted ? 0.05 : 0), -0.38 + (this.rooted ? 0.06 : 0));
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
