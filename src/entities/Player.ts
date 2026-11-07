import * as THREE from 'three';
import type { Input } from '../core/Input';
import { LOW_SPEC } from '../core/Quality';
import { furTexture, wrapTexture } from '../assets/ProceduralTextures';
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
  private guardArm!: THREE.Group;
  private flicker = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    this.flashlight = new THREE.SpotLight('#ffa05a', 0, 34, 0.5, 0.7, 1.4);
    this.flashlight.castShadow = !LOW_SPEC;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.3;
    this.flashlight.shadow.camera.far = 22;
    this.flashlight.shadow.bias = -0.0004;
    this.flashlight.shadow.normalBias = 0.03;
    scene.add(this.flashlight, this.flashlight.target);

    // Viewmodel: monkey hand gripping the chain/bail of an antique filigree cage lantern (VISUAL_QA_ANCHORS §2/§3).
    const furMap = furTexture();
    furMap.repeat.set(2, 1.5);
    const wrapMap = wrapTexture();
    wrapMap.repeat.set(1, 3);
    const fur = new THREE.MeshStandardMaterial({ color: '#c08a5a', map: furMap, roughness: 1 });
    const palm = new THREE.MeshStandardMaterial({ color: '#b08470', roughness: 0.75 });
    const nail = new THREE.MeshStandardMaterial({ color: '#2a1c16', roughness: 0.4 });
    const wrap = new THREE.MeshStandardMaterial({ color: '#8a7a6a', map: wrapMap, roughness: 0.95 });
    const sleeve = new THREE.MeshStandardMaterial({ color: '#2a2040', roughness: 0.9 });
    const trim = new THREE.MeshStandardMaterial({ color: '#8a6a2a', roughness: 0.5, metalness: 0.6 });
    const bronze = new THREE.MeshStandardMaterial({ color: '#a07a3a', roughness: 0.42, metalness: 0.85 });
    const iron = new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.55, metalness: 0.8 });
    this.lens = new THREE.MeshStandardMaterial({ color: '#ff3a1a', emissive: '#e0201a', emissiveIntensity: 3 });
    this.flameHalo = new THREE.MeshStandardMaterial({
      color: '#ffb84a',
      emissive: '#ffa830',
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const add = (mesh: THREE.Mesh, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.handPivot): THREE.Mesh => {
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    /** Capsule (finger segment) spanning two points in parent space. */
    const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material = palm, parent: THREE.Object3D = this.handPivot): void => {
      const d = b.clone().sub(a);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, d.length(), 3, 6), mat);
      m.quaternion.setFromUnitVectors(UP, d.normalize());
      add(m, 0, 0, 0, parent).position.copy(a).lerp(b, 0.5);
    };
    /** Furred forearm with woven wraps and a ragged night-runner sleeve, elbow→wrist. */
    const forearm = (elbow: THREE.Vector3, wrist: THREE.Vector3, parent: THREE.Object3D): void => {
      const axis = wrist.clone().sub(elbow);
      const len = axis.length();
      axis.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.05, len, 14, 1), fur);
      arm.quaternion.copy(q);
      add(arm, 0, 0, 0, parent).position.copy(elbow).lerp(wrist, 0.5);
      // spiral cloth wrap: overlapping tilted strips over the wrist half
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.32);
      for (let i = 0; i < 6; i++) {
        const t = 0.5 + i * 0.085;
        const r = (0.05 - 0.014 * t) * 1.06;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.03, 14, 1, true), wrap);
        band.quaternion.copy(q).multiply(tilt.clone().setFromAxisAngle(new THREE.Vector3(1, 0, 0), i % 2 ? 0.28 : -0.22));
        add(band, 0, 0, 0, parent).position.copy(elbow).lerp(wrist, t);
      }
      // frayed tail of the wrap
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.004), wrap);
      tail.quaternion.copy(q);
      tail.rotateZ(0.5);
      add(tail, 0, 0, 0, parent).position.copy(elbow).lerp(wrist, 0.62).add(new THREE.Vector3(0.05, -0.02, 0));
      // sleeve: dark indigo short cuff with a thin dull-gold hem, ragged edge
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.12, 12, 1, true), sleeve);
      cuff.material.side = THREE.DoubleSide;
      cuff.quaternion.copy(q);
      add(cuff, 0, 0, 0, parent).position.copy(elbow).lerp(wrist, 0.08);
      const hem = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.004, 4, 18), trim);
      hem.quaternion.setFromUnitVectors(FORWARD, axis);
      add(hem, 0, 0, 0, parent).position.copy(elbow).lerp(wrist, 0.08 + 0.06 / len);
      for (let k = 0; k < 5; k++) {
        const rag = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 3), sleeve);
        const ang = (k / 5) * Math.PI * 2;
        const off = new THREE.Vector3(Math.cos(ang) * 0.064, 0, Math.sin(ang) * 0.064).applyQuaternion(q);
        rag.quaternion.copy(q);
        add(rag, 0, 0, 0, parent).position.copy(elbow).lerp(wrist, 0.08 + 0.07 / len).add(off);
      }
    };

    // Lantern, centred on the pivot: spherical filigree cage, ruby core inside a gold-amber halo.
    const R = 0.058;
    const meridian = new THREE.TorusGeometry(R, 0.0024, 5, 28);
    for (let i = 0; i < 6; i++) add(new THREE.Mesh(meridian, i % 2 ? iron : bronze)).rotation.y = (i * Math.PI) / 6;
    for (const lat of [-0.7, -0.3, 0.3, 0.7]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * Math.cos(lat), 0.0022, 5, 28), bronze);
      ring.rotation.x = Math.PI / 2;
      add(ring, 0, R * Math.sin(lat), 0);
    }
    // equatorial cloud-scroll filigree band
    const knot = new THREE.TorusGeometry(0.009, 0.0016, 4, 10);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const k = add(new THREE.Mesh(knot, bronze), Math.cos(a) * R, 0, Math.sin(a) * R);
      k.rotation.y = -a;
    }
    add(new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), this.lens));
    const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, 8), this.lens), 0, 0.018, 0);
    flame.scale.z = 0.7;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), this.flameHalo));
    // Pointed pagoda lid with finial, and a lotus foot.
    add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.045, 12), iron), 0, 0.072, 0);
    add(new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.003, 4, 20), bronze), 0, 0.05, 0).rotation.x = Math.PI / 2;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), bronze), 0, 0.1, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tip = add(new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.016, 4), bronze), Math.cos(a) * 0.05, 0.052, Math.sin(a) * 0.05);
      tip.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    }
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.016, 12), iron), 0, -0.062, 0);
    const footRing = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 5, 18), bronze);
    footRing.rotation.x = Math.PI / 2;
    add(footRing, 0, -0.07, 0);
    add(new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 6), bronze), 0, -0.084, 0).rotation.x = Math.PI;
    // Short chain (alternating links) from finial up into the fist bail.
    const link = new THREE.TorusGeometry(0.006, 0.0017, 4, 10);
    for (let i = 0; i < 4; i++) {
      const l = add(new THREE.Mesh(link, bronze), 0, 0.108 + i * 0.01, 0);
      l.scale.y = 1.5;
      l.rotation.y = i % 2 ? Math.PI / 2 : 0;
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.064, 6), bronze);
    bar.rotation.z = Math.PI / 2;
    add(bar, 0, 0.15, 0);
    add(new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.0035, 5, 16, Math.PI), bronze), 0, 0.15, 0);

    // Right forearm rises from the lower right into the fist around the bail.
    forearm(new THREE.Vector3(0.17, -0.3, 0.1), new THREE.Vector3(0.012, 0.19, 0.06), this.handPivot);

    // Palm behind the bail; four fingers curled over it, thumb closing from below = five digits.
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), palm);
    hand.scale.set(0.95, 0.75, 0.8);
    add(hand, 0.005, 0.195, 0.032);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), fur);
    back.scale.set(0.95, 0.7, 0.85);
    back.rotation.x = -0.6;
    add(back, 0.005, 0.2, 0.04);
    for (let i = 0; i < 4; i++) {
      const x = -0.036 + i * 0.024;
      const knuckle = new THREE.Vector3(x, 0.21, 0.012);
      const joint = new THREE.Vector3(x, 0.206, -0.02);
      const tip = new THREE.Vector3(x, 0.172, -0.024);
      limb(knuckle, joint, 0.011, fur);
      limb(joint, tip, 0.01);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), nail)).position.copy(tip).add(new THREE.Vector3(0, -0.006, -0.006));
    }
    limb(new THREE.Vector3(0.04, 0.17, 0.03), new THREE.Vector3(0.012, 0.166, -0.012), 0.012);

    // Left arm: empty fist guarding the chest / satchel, lower-left of frame.
    const guard = new THREE.Group();
    forearm(new THREE.Vector3(-0.1, -0.16, 0.2), new THREE.Vector3(0.02, -0.02, -0.02), guard);
    const fist = add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), palm), 0.035, 0.02, -0.05, guard);
    fist.scale.set(1, 0.85, 0.9);
    const fistFur = add(new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), fur), 0.0, 0.0, -0.02, guard);
    fistFur.rotation.set(0.4, 0, 1.6);
    for (let i = 0; i < 4; i++) {
      const y = 0.045 - i * 0.022;
      limb(new THREE.Vector3(0.06, y, -0.07), new THREE.Vector3(0.075, y - 0.006, -0.04), 0.011, palm, guard);
    }
    limb(new THREE.Vector3(0.02, 0.05, -0.08), new THREE.Vector3(0.06, 0.055, -0.085), 0.012, palm, guard);
    guard.position.set(-0.45, -0.06, 0.02);
    guard.rotation.set(0.1, 0.5, 0.25);
    this.guardArm = guard;
    this.viewmodel.add(guard);

    this.viewmodel.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    this.handPivot.position.y = -0.03;
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
    // emit from just ahead of the held lantern so the beam does not blow out the viewmodel itself
    this.flashlight.position.copy(this.eye).addScaledVector(this.rightVec(), 0.18).addScaledVector(this.forward, 0.7).y -= 0.18;
    this.flashlight.target.position.copy(this.flashlight.position).addScaledVector(this.lightDir, 10);
    this.lens.emissiveIntensity = this.lightOn ? 3 * this.flicker : 0.12;
    this.lens.color.set(this.lightOn ? '#ff5a2a' : '#3a1a12');
    this.flameHalo.emissiveIntensity = this.lightOn ? 1.6 * this.flicker : 0;
    this.flameHalo.opacity = this.lightOn ? 0.45 : 0;

    // viewmodel sway
    const bob = Math.sin(this.bobPhase * 2) * 0.012 * Math.min(1, horizSpeed / 3);
    this.viewmodel.position.set(0.24 + Math.cos(this.bobPhase) * 0.01, -0.17 + bob - (this.rooted ? 0.05 : 0), -0.42 + (this.rooted ? 0.06 : 0));
    this.handPivot.rotation.set(this.rooted ? -0.35 : 0, this.rooted ? 0.25 : 0, Math.sin(this.bobPhase) * 0.04);
    // guard arm reaches forward while picking, tucks to the chest otherwise
    this.guardArm.position.set(this.rooted ? -0.3 : -0.45, this.rooted ? 0.02 : -0.06 + bob * 0.6, this.rooted ? -0.08 : 0.02);
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
