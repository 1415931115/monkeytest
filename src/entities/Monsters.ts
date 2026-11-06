import * as THREE from 'three';
import type { MaterialLibrary } from '../assets/MaterialLibrary';
import { limb } from '../assets/WorldKit';
import { CORRIDOR_HALF_WIDTH, clampToCorridor, lateralOffset, pathSlope, zoneAt, type ColliderGrid } from '../game/LevelPath';
import { pathPoint } from '../game/Level';
import type { AudioSystem } from '../systems/AudioSystem';

export interface MonsterContext {
  playerPos: THREE.Vector3;
  eye: THREE.Vector3;
  forward: THREE.Vector3;
  lightOn: boolean;
  sprinting: boolean;
  moving: boolean;
  harvesting: boolean;
  hunt: boolean;
  /** Active 圣地护体 circle (real shrine being charged), or null. Monsters may not enter it. */
  sanctuary: { x: number; z: number; r: number } | null;
  colliders: ColliderGrid;
  audio: AudioSystem;
  rng: () => number;
}

/** Keep monsters this far outside the sanctuary edge. */
const SANCTUARY_MARGIN = 0.6;

/** Push `pos` out to the sanctuary edge if it is inside. Returns true if it was moved. */
export function pushOutOfSanctuary(pos: THREE.Vector3, s: MonsterContext['sanctuary'], margin = SANCTUARY_MARGIN): boolean {
  if (!s) return false;
  const r = s.r + margin;
  let dx = pos.x - s.x;
  let dz = pos.z - s.z;
  const d = Math.hypot(dx, dz);
  if (d >= r) return false;
  if (d < 1e-4) {
    dx = 1;
    dz = 0;
  } else {
    dx /= d;
    dz /= d;
  }
  pos.x = s.x + dx * r;
  pos.z = s.z + dz * r;
  return true;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const avoid = { x: 0, z: 0 };

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  return m;
}

/** Shared accent materials for monster-form identity marks (created once, reused by every instance). */
let accentCache: ReturnType<typeof makeAccents> | null = null;
function accents(): ReturnType<typeof makeAccents> {
  return (accentCache ??= makeAccents());
}
function makeAccents() {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.5, ...p });
  return {
    // 紫陌
    palmSclera: std({ color: 0x2a0a10, roughness: 0.4 }),
    palmIris: std({ color: 0xffb040, emissive: 0xff3a1a, emissiveIntensity: 2.4 }),
    slit: std({ color: 0x080002, roughness: 0.3 }),
    peachMark: std({ color: 0xff6f9a, emissive: 0xd8204a, emissiveIntensity: 1.4 }),
    bloodVein: std({ color: 0x8a0f1e, emissive: 0x5a0410, emissiveIntensity: 0.8 }),
    mist: std({ color: 0xc9a2c8, emissive: 0x6a3a6e, emissiveIntensity: 0.35, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    fang: std({ color: 0xf2ead8, roughness: 0.35 }),
    // 青鸾
    plume: std({ color: 0x1f6f66, roughness: 0.7, side: THREE.DoubleSide, flatShading: true }),
    plumeDark: std({ color: 0x0f2f33, roughness: 0.8, side: THREE.DoubleSide, flatShading: true }),
    iceIris: std({ color: 0x9fe8ff, emissive: 0x3ad0ff, emissiveIntensity: 2.2 }),
    beak: std({ color: 0x2b2a24, roughness: 0.35, metalness: 0.2 }),
    featherMist: std({ color: 0x1a3a3c, emissive: 0x0c2a2a, emissiveIntensity: 0.3, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
    talon: std({ color: 0x050506, roughness: 0.25, metalness: 0.3 }),
    goldThread: std({ color: 0xd9b25a, metalness: 0.85, roughness: 0.3, emissive: 0x4a3510, emissiveIntensity: 0.4 }),
    // 金阙
    gold: std({ color: 0xe0b450, metalness: 0.9, roughness: 0.28, emissive: 0x5a3c0c, emissiveIntensity: 0.5 }),
    goldVein: std({ color: 0xffd36a, emissive: 0xffa820, emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.3 }),
    goldEye: std({ color: 0xffe08a, emissive: 0xffb000, emissiveIntensity: 3 }),
    sigil: new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    inkPurple: std({ color: 0x1c1024, roughness: 0.85 }),
  };
}

/** Steer `pos` toward target with tree avoidance; returns distance moved. */
function steer(pos: THREE.Vector3, target: THREE.Vector3, speed: number, dt: number, colliders: ColliderGrid, heading: { v: number }, radius = 0.45, extra = 2.5): void {
  let dx = target.x - pos.x;
  let dz = target.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  dx /= d;
  dz /= d;
  colliders.avoid(pos.x + dx * 1.2, pos.z + dz * 1.2, 1.4, avoid);
  dx += avoid.x * 1.6;
  dz += avoid.z * 1.6;
  const l = Math.hypot(dx, dz) || 1;
  const step = Math.min(d, speed * dt);
  pos.x += (dx / l) * step;
  pos.z += (dz / l) * step;
  colliders.resolve(pos, radius);
  clampToCorridor(pos, 0, extra);
  const want = Math.atan2(dx, dz);
  let diff = want - heading.v;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  heading.v += diff * Math.min(1, dt * 8);
}

/** Path-aware chase target: follow the trail when far, beeline when close. */
function chaseTarget(from: THREE.Vector3, player: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const gt = -from.z;
  const pt = -player.z;
  if (Math.abs(pt - gt) < 14) return out.copy(player);
  const nt = gt + Math.sign(pt - gt) * 8;
  const lat = lateralOffset(from.x, from.z) * 0.6;
  return pathPoint(nt, THREE.MathUtils.clamp(lat, -6, 6), out);
}

// ============================================================== GRABBER
type GrabberState = 'patrol' | 'alert' | 'chase' | 'retreat';
/** Keep bodies outside each other's grab radius (catch distance is 1.25). */
const GRABBER_MIN_SEP = 2.6;

interface Limb2 {
  upper: THREE.Group;
  lower: THREE.Group;
}

/** Close-range hunter: a pale, long-armed ape-thing. Catching you drains half your health. */
export class Grabber {
  readonly root = new THREE.Group();
  readonly position: THREE.Vector3;
  state: GrabberState = 'patrol';
  private readonly heading = { v: 0 };
  private readonly home = new THREE.Vector3();
  private readonly wander = new THREE.Vector3();
  private wanderTimer = 0;
  private stateTimer = 0;
  private lostTimer = 0;
  private sated = 0;
  private growlTimer = 2;
  private gait = 0;
  private speedNow = 0;
  lit = false;
  private readonly hips = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly arms: Limb2[] = [];
  private readonly legs: Limb2[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  readonly zone: number;

  constructor(mats: MaterialLibrary, spawn: THREE.Vector3, readonly index: number) {
    this.position = this.root.position;
    this.position.copy(spawn);
    this.home.copy(spawn);
    this.wander.copy(spawn);
    this.zone = zoneAt(-spawn.z);
    this.build(mats);
  }

  private build(m: MaterialLibrary): void {
    const skin = m.grabberSkin;
    this.hips.position.y = 0.88;
    this.root.add(this.hips);
    const pelvis = mesh(new THREE.SphereGeometry(0.22, 12, 8), skin);
    pelvis.scale.set(1.1, 0.7, 0.9);
    this.hips.add(pelvis);
    // legs
    for (const side of [-1, 1]) {
      const upper = new THREE.Group();
      upper.position.set(side * 0.17, -0.02, 0);
      const thigh = mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.46, 0.05), 0.1, 0.065, 8), skin);
      upper.add(thigh);
      const lower = new THREE.Group();
      lower.position.set(0, -0.46, 0.05);
      const shin = mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.42, -0.04), 0.065, 0.045, 8), skin);
      const foot = mesh(new THREE.BoxGeometry(0.12, 0.06, 0.26), skin);
      foot.position.set(0, -0.43, 0.06);
      lower.add(shin, foot);
      for (let t = 0; t < 3; t++) {
        const toe = mesh(new THREE.ConeGeometry(0.018, 0.08, 4), m.claw, false);
        toe.rotation.x = Math.PI / 2;
        toe.position.set(-0.04 + t * 0.04, -0.45, 0.22);
        lower.add(toe);
      }
      upper.add(lower);
      this.hips.add(upper);
      this.legs.push({ upper, lower });
    }
    // spine and torso
    this.spine.rotation.x = 0.75;
    this.hips.add(this.spine);
    const chest = mesh(new THREE.SphereGeometry(0.3, 14, 10), skin);
    chest.scale.set(1.15, 1.45, 0.85);
    chest.position.y = 0.42;
    const belly = mesh(new THREE.SphereGeometry(0.22, 12, 8), skin);
    belly.scale.set(1, 1, 0.8);
    belly.position.set(0, 0.12, 0.04);
    this.spine.add(chest, belly);
    // protruding vertebrae and ribs
    for (let i = 0; i < 7; i++) {
      const v = mesh(new THREE.SphereGeometry(0.045, 6, 4), skin, false);
      v.position.set(0, 0.05 + i * 0.1, -0.22 - Math.sin((i / 6) * Math.PI) * 0.05);
      this.spine.add(v);
    }
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const rib = mesh(new THREE.TorusGeometry(0.2, 0.014, 4, 10, Math.PI * 0.6), m.grabberDark, false);
        rib.position.set(side * 0.12, 0.3 + i * 0.09, 0.05);
        rib.rotation.set(Math.PI / 2, 0, side > 0 ? -0.6 : Math.PI - 1.3);
        this.spine.add(rib);
      }
    }
    // arms
    for (const side of [-1, 1]) {
      const upper = new THREE.Group();
      upper.position.set(side * 0.36, 0.7, 0.02);
      const shoulder = mesh(new THREE.SphereGeometry(0.11, 10, 8), skin);
      upper.add(shoulder);
      upper.add(mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.04, -0.74, 0), 0.085, 0.06, 8), skin));
      const lower = new THREE.Group();
      lower.position.set(side * 0.04, -0.74, 0);
      lower.add(mesh(new THREE.SphereGeometry(0.065, 8, 6), skin));
      lower.add(mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.78, 0.02), 0.06, 0.045, 8), skin));
      const hand = mesh(new THREE.SphereGeometry(0.08, 10, 8), skin);
      hand.scale.set(0.9, 1.3, 0.6);
      hand.position.set(0, -0.84, 0.02);
      lower.add(hand);
      // 掌心竖瞳：暗红眼白 + 金红发光虹膜 + 黑色竖缝瞳
      const fx = accents();
      const palmEye = new THREE.Group();
      palmEye.position.set(0, -0.85, 0.062);
      const sclera = mesh(new THREE.SphereGeometry(0.042, 10, 8), fx.palmSclera, false);
      sclera.scale.set(0.75, 1.15, 0.35);
      const iris = mesh(new THREE.SphereGeometry(0.03, 10, 8), fx.palmIris, false);
      iris.scale.set(0.8, 1.2, 0.3);
      iris.position.z = 0.009;
      const slit = mesh(new THREE.BoxGeometry(0.008, 0.062, 0.006), fx.slit, false);
      slit.position.z = 0.017;
      const lid = mesh(new THREE.TorusGeometry(0.036, 0.007, 4, 12), skin, false);
      lid.scale.set(0.8, 1.25, 1);
      lid.position.z = 0.006;
      palmEye.add(sclera, iris, slit, lid);
      lower.add(palmEye);
      // 雾手：半透明藕荷薄纱裹住小臂，末端散成雾缕
      const veil = mesh(limb(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, -0.92, 0.03), 0.1, 0.17, 10), fx.mist, false);
      lower.add(veil);
      for (let w = 0; w < 3; w++) {
        const wisp = mesh(new THREE.ConeGeometry(0.05, 0.32, 6, 1, true), fx.mist, false);
        wisp.rotation.set(Math.PI + (w - 1) * 0.35, 0, side * (0.2 + w * 0.15));
        wisp.position.set(side * (0.05 + w * 0.03), -1.0 - w * 0.05, -0.02 + w * 0.03);
        lower.add(wisp);
      }
      for (let f = 0; f < 4; f++) {
        const finger = mesh(limb(new THREE.Vector3(-0.045 + f * 0.03, -0.9, 0.03), new THREE.Vector3(-0.06 + f * 0.04, -1.08, 0.09), 0.016, 0.01, 5), skin, false);
        const claw = mesh(new THREE.ConeGeometry(0.012, 0.07, 4), m.claw, false);
        claw.position.set(-0.06 + f * 0.04, -1.12, 0.1);
        claw.rotation.x = Math.PI + 0.3;
        lower.add(finger, claw);
      }
      upper.add(lower);
      this.spine.add(upper);
      this.arms.push({ upper, lower });
    }
    // head
    this.head.position.set(0, 0.86, 0.1);
    this.spine.add(this.head);
    const neck = mesh(limb(new THREE.Vector3(0, -0.2, -0.05), new THREE.Vector3(0, 0.05, 0.02), 0.08, 0.07, 8), skin);
    this.head.add(neck);
    const skull = mesh(new THREE.SphereGeometry(0.2, 14, 10), skin);
    skull.scale.set(1, 1.1, 1.1);
    skull.position.set(0, 0.1, 0);
    const brow = mesh(new THREE.BoxGeometry(0.3, 0.06, 0.1), skin);
    brow.position.set(0, 0.16, 0.17);
    brow.rotation.x = 0.3;
    const muzzle = mesh(new THREE.SphereGeometry(0.13, 12, 8), skin);
    muzzle.scale.set(1.1, 0.8, 1.1);
    muzzle.position.set(0, 0.02, 0.18);
    this.head.add(skull, brow, muzzle);
    // 额心桃花钿（五瓣 + 花心）+ 向下渗血纹
    const fxH = accents();
    const dian = new THREE.Group();
    dian.position.set(0, 0.255, 0.175);
    dian.rotation.x = -0.65;
    const petalGeo = new THREE.SphereGeometry(0.016, 6, 4);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + Math.PI / 2;
      const petal = mesh(petalGeo, fxH.peachMark, false);
      petal.scale.set(0.7, 1.2, 0.35);
      petal.position.set(Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0);
      petal.rotation.z = a - Math.PI / 2;
      dian.add(petal);
    }
    const core = mesh(new THREE.SphereGeometry(0.008, 6, 4), fxH.palmIris, false);
    core.position.z = 0.004;
    dian.add(core);
    this.head.add(dian);
    for (const [x, len, tilt] of [
      [-0.012, 0.09, 0.15],
      [0.014, 0.06, -0.2],
    ] as const) {
      const drip = mesh(new THREE.BoxGeometry(0.006, len, 0.004), fxH.bloodVein, false);
      drip.position.set(x, 0.225 - len / 2, 0.205 - len * 0.15);
      drip.rotation.set(-0.35, 0, tilt);
      this.head.add(drip);
    }
    // 苍白肤面红裂纹（两颊）
    for (const side of [-1, 1]) {
      for (let c = 0; c < 2; c++) {
        const crack = mesh(new THREE.BoxGeometry(0.005, 0.07 - c * 0.02, 0.004), fxH.bloodVein, false);
        crack.position.set(side * (0.13 + c * 0.03), 0.04 - c * 0.02, 0.2 - c * 0.04);
        crack.rotation.set(-0.2, side * 0.6, side * (0.5 + c * 0.4));
        this.head.add(crack);
      }
    }
    // 上颌獠牙（加强版尖牙）
    for (const side of [-1, 1]) {
      const fang = mesh(new THREE.ConeGeometry(0.016, 0.1, 5), fxH.fang, false);
      fang.rotation.x = Math.PI - 0.15;
      fang.position.set(side * 0.05, -0.07, 0.27);
      this.head.add(fang);
    }
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.07, 8, 6), skin, false);
      ear.scale.set(0.4, 1, 0.8);
      ear.position.set(side * 0.21, 0.12, -0.02);
      const socket = mesh(new THREE.SphereGeometry(0.05, 8, 6), m.grabberDark, false);
      socket.position.set(side * 0.075, 0.1, 0.19);
      const eye = mesh(new THREE.SphereGeometry(0.03, 8, 6), m.grabberEye, false);
      eye.position.set(side * 0.075, 0.1, 0.225);
      this.eyes.push(eye);
      this.head.add(ear, socket, eye);
    }
    // jaw with teeth
    this.jaw.position.set(0, -0.02, 0.12);
    const jawMesh = mesh(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin);
    jawMesh.scale.set(1.05, 0.9, 1.3);
    const mouth = mesh(new THREE.SphereGeometry(0.1, 10, 6), m.grabberDark, false);
    mouth.scale.set(0.9, 0.35, 1);
    mouth.position.set(0, 0.0, 0.05);
    this.jaw.add(jawMesh, mouth);
    for (let t = 0; t < 6; t++) {
      const tooth = mesh(new THREE.ConeGeometry(0.014, t === 0 || t === 5 ? 0.085 : 0.06, 4), m.mask, false);
      const a = -0.9 + (t / 5) * 1.8;
      tooth.position.set(Math.sin(a) * 0.09, 0.03, 0.06 + Math.cos(a) * 0.08);
      this.jaw.add(tooth);
    }
    this.head.add(this.jaw);
    this.root.rotation.y = this.heading.v;
  }

  respawn(spawn: THREE.Vector3): void {
    this.position.copy(spawn);
    this.home.copy(spawn);
    this.wander.copy(spawn);
    this.state = 'patrol';
    this.sated = 0;
    this.lostTimer = 0;
  }

  /** Bait penalty: lunge `meters` toward the player (never closer than `minGap`) and commit to the chase. */
  lurch(target: THREE.Vector3, meters: number, colliders: ColliderGrid, minGap = 2.5): void {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(meters, Math.max(0, d - minGap));
    if (step > 0 && d > 1e-4) {
      this.position.x += (dx / d) * step;
      this.position.z += (dz / d) * step;
      colliders.resolve(this.position, 0.45);
      clampToCorridor(this.position, 0, 3);
    }
    if (this.state === 'patrol' || this.state === 'alert') this.state = 'chase';
    this.lostTimer = 0;
  }

  /** Returns true when it catches the player this frame. */
  update(dt: number, ctx: MonsterContext, zoneBonus: number, allies?: readonly Grabber[]): boolean {
    this.separateFrom(allies);
    const toPlayer = tmpA.subVectors(ctx.playerPos, this.position).setY(0);
    const dist = toPlayer.length();
    this.sated = Math.max(0, this.sated - dt);

    // Light cone check: shining the flashlight on it makes it recoil.
    this.lit = false;
    if (ctx.lightOn && dist < 13) {
      tmpB.set(this.position.x, 1.3, this.position.z).sub(ctx.eye).normalize();
      if (tmpB.dot(ctx.forward) > Math.cos(0.33)) this.lit = true;
    }

    const hearing = (ctx.lightOn ? 17 : 8.5) * (ctx.sprinting ? 1.6 : ctx.moving ? 1 : 0.7);
    let speed = 0;
    let caught = false;
    switch (this.state) {
      case 'patrol': {
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0 || this.position.distanceTo(this.wander) < 0.6) {
          this.wanderTimer = 4 + ctx.rng() * 5;
          pathPoint(-this.home.z + (ctx.rng() - 0.5) * 20, (ctx.rng() - 0.5) * 16, this.wander);
        }
        speed = 1.25;
        steer(this.position, this.wander, speed, dt, ctx.colliders, this.heading);
        if (this.sated <= 0 && (ctx.hunt || dist < hearing)) {
          this.state = ctx.hunt || dist < hearing * 0.6 ? 'chase' : 'alert';
          this.stateTimer = 1.2;
          ctx.audio.chaserScream(this.position);
        }
        break;
      }
      case 'alert': {
        // freeze, sniff, then commit
        this.stateTimer -= dt;
        const want = Math.atan2(toPlayer.x, toPlayer.z);
        this.heading.v += Math.atan2(Math.sin(want - this.heading.v), Math.cos(want - this.heading.v)) * Math.min(1, dt * 5);
        if (this.stateTimer <= 0) this.state = dist < hearing * 1.3 || ctx.hunt ? 'chase' : 'patrol';
        break;
      }
      case 'chase': {
        const base = [4.5, 4.9, 5.4][this.zone] + zoneBonus;
        speed = base + (ctx.hunt ? 0.9 : 0);
        if (ctx.hunt && dist > 40) speed = 8.5; // summoned from afar: rush in
        if (this.lit) speed *= 0.45;
        const sanc = ctx.sanctuary;
        if (sanc && Math.hypot(this.position.x - sanc.x, this.position.z - sanc.z) < sanc.r + 6) {
          // 圣地护体: prowl along the rim, staying on the player's side of the circle.
          let ax = ctx.playerPos.x - sanc.x;
          let az = ctx.playerPos.z - sanc.z;
          const al = Math.hypot(ax, az);
          if (al < 0.3) {
            ax = this.position.x - sanc.x;
            az = this.position.z - sanc.z;
          }
          const n = Math.hypot(ax, az) || 1;
          const rr = sanc.r + SANCTUARY_MARGIN + 0.1;
          tmpB.set(sanc.x + (ax / n) * rr, 0, sanc.z + (az / n) * rr);
        } else chaseTarget(this.position, ctx.playerPos, tmpB);
        steer(this.position, tmpB, speed, dt, ctx.colliders, this.heading, 0.45, 3);
        this.growlTimer -= dt;
        if (this.growlTimer <= 0 && dist < 30) {
          this.growlTimer = 2.5 + ctx.rng() * 2.5;
          ctx.audio.chaserGrowl(this.position);
        }
        if (dist < 1.25 && !ctx.sanctuary) {
          caught = true;
          this.state = 'retreat';
          this.stateTimer = 5;
          this.sated = 11;
        } else if (!ctx.hunt && dist > 30) {
          this.lostTimer += dt;
          if (this.lostTimer > 3.5) {
            this.state = 'patrol';
            this.lostTimer = 0;
            this.home.copy(this.position);
          }
        } else this.lostTimer = 0;
        break;
      }
      case 'retreat': {
        this.stateTimer -= dt;
        speed = 4.5;
        tmpB.copy(this.position).addScaledVector(toPlayer.normalize(), -6);
        steer(this.position, tmpB, speed, dt, ctx.colliders, this.heading, 0.45, 4);
        if (this.stateTimer <= 0) {
          this.state = 'patrol';
          this.home.copy(this.position);
        }
        break;
      }
    }
    // 圣地护体: never inside the circle, whatever the state.
    pushOutOfSanctuary(this.position, ctx.sanctuary);
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 6);
    this.root.rotation.y = this.heading.v;
    this.separateFrom(allies);
    if (allies) {
      ctx.colliders.resolve(this.position, 0.45);
      const extra = this.state === 'retreat' ? 4 : this.state === 'chase' ? 3 : 2.5;
      clampToCorridor(this.position, 0, extra);
    }
    return caught;
  }

  /** Shove away from overlapping grabbers. Does not change chase speed. */
  private separateFrom(allies: readonly Grabber[] | undefined): void {
    if (!allies) return;
    let px = 0;
    let pz = 0;
    for (const other of allies) {
      if (other === this) continue;
      let dx = this.position.x - other.position.x;
      let dz = this.position.z - other.position.z;
      let dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        const ang = (this.index + 1) * 2.399963;
        dx = Math.cos(ang);
        dz = Math.sin(ang);
        dist = 0.05;
      }
      if (dist >= GRABBER_MIN_SEP) continue;
      const overlap = GRABBER_MIN_SEP - dist;
      px += (dx / dist) * overlap;
      pz += (dz / dist) * overlap;
    }
    const mag = Math.hypot(px, pz);
    if (mag < 1e-5) return;
    const step = Math.min(mag, GRABBER_MIN_SEP);
    this.position.x += (px / mag) * step;
    this.position.z += (pz / mag) * step;
  }

  animate(dt: number, elapsed: number, ctx: MonsterContext): void {
    const sp = this.speedNow;
    const running = sp > 3;
    this.gait += dt * (1.6 + sp * 1.25);
    const g = this.gait;
    const amp = Math.min(1, sp / 2.5);
    // legs
    this.legs.forEach((l, i) => {
      const ph = g + (i === 0 ? 0 : Math.PI);
      l.upper.rotation.x = -Math.sin(ph) * 0.65 * amp - (running ? 0.35 : 0.1);
      l.lower.rotation.x = Math.max(0, Math.sin(ph + 1.2)) * 1.1 * amp + 0.25;
    });
    // knuckle-walking arms: counter phase, reaching forward when chasing
    this.arms.forEach((a, i) => {
      const ph = g + (i === 0 ? Math.PI : 0);
      const reach = this.state === 'chase' ? -0.55 : 0;
      a.upper.rotation.x = -0.75 + reach + Math.sin(ph) * 0.75 * amp;
      a.upper.rotation.z = (i === 0 ? -1 : 1) * (0.12 + (this.lit ? 0.6 : 0));
      a.lower.rotation.x = -0.25 - Math.max(0, -Math.sin(ph)) * 0.6 * amp - (this.lit ? 1.4 : 0);
    });
    this.hips.position.y = 0.88 + Math.abs(Math.sin(g)) * 0.07 * amp - (running ? 0.08 : 0);
    this.spine.rotation.x = (running ? 0.95 : 0.75) + Math.sin(g * 2) * 0.05 * amp + Math.sin(elapsed * 1.7 + this.index) * 0.03;
    // head tracks player, twitches
    tmpA.subVectors(ctx.playerPos, this.position);
    const want = Math.atan2(tmpA.x, tmpA.z) - this.heading.v;
    const yaw = Math.atan2(Math.sin(want), Math.cos(want));
    const twitch = Math.sin(elapsed * 23 + this.index * 3) > 0.96 ? 0.3 : 0;
    this.head.rotation.set(-(this.spine.rotation.x) + 0.15, THREE.MathUtils.clamp(yaw, -1.1, 1.1) * (this.state === 'patrol' ? 0.3 : 0.9), twitch);
    this.jaw.rotation.x = this.state === 'chase' ? 0.35 + Math.sin(elapsed * 9) * 0.15 : 0.05 + Math.sin(elapsed * 1.3) * 0.04;
    const eyeScale = this.state === 'chase' ? 1.3 : 1;
    for (const e of this.eyes) e.scale.setScalar(eyeScale);
  }
}

// ============================================================== CALLER
type CallerState = 'dormant' | 'rising' | 'calling' | 'stalk' | 'vanish';

/** Mid-range mimic. While you pick, it calls "猴哥" behind you. Look at it and you die. */
export class Caller {
  readonly root = new THREE.Group();
  state: CallerState = 'dormant';
  private timer = 0;
  cooldown = 0;
  /** Kill window active (seconds remaining). */
  window = 0;
  private callDelay = 0;
  /** True only after the 「猴哥——」 warning has been voiced this call. */
  private warned = false;
  private voiceDuration = 0;
  private readonly heading = { v: 0 };
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private visibleAmt = 0;

  constructor(mats: MaterialLibrary, readonly zone: number) {
    this.build(mats);
    this.root.visible = false;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  private build(m: MaterialLibrary): void {
    // robe: lathe with ragged hem
    const pts: THREE.Vector2[] = [];
    const prof = [
      [0.55, 0],
      [0.5, 0.2],
      [0.42, 0.7],
      [0.34, 1.3],
      [0.3, 1.8],
      [0.34, 2.05],
      [0.22, 2.2],
      [0.1, 2.28],
    ];
    for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
    const robeGeo = new THREE.LatheGeometry(pts, 24);
    const pos = robeGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.05) pos.setY(i, Math.max(-0.02, Math.sin(i * 12.9898) * 0.12 + 0.06));
    }
    robeGeo.computeVertexNormals();
    const robe = mesh(robeGeo, m.robe);
    this.root.add(robe);
    // long neck — 青鸾怪物态：鸟颈异常拉长（S 形两段）
    const fq = accents();
    this.head.position.set(0, 2.55, 0);
    this.root.add(this.head);
    const neckLow = mesh(limb(new THREE.Vector3(0, -0.4, -0.04), new THREE.Vector3(0, -0.02, 0.07), 0.07, 0.05, 8), m.grabberSkin);
    const neck = mesh(limb(new THREE.Vector3(0, -0.02, 0.07), new THREE.Vector3(0, 0.38, 0.02), 0.05, 0.045, 8), m.grabberSkin);
    this.head.add(neckLow, neck);
    // 颈羽领：颈根一圈细羽
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.y = -0.2;
      pivot.rotation.y = a;
      const f = mesh(new THREE.ConeGeometry(0.035, 0.22, 4), i % 2 ? fq.plumeDark : fq.plume, false);
      f.scale.z = 0.3;
      f.position.set(0, 0, 0.07);
      f.rotation.x = Math.PI / 2 + 0.9;
      pivot.add(f);
      this.head.add(pivot);
    }
    // mask: pale elongated monkey face
    const mask = mesh(new THREE.SphereGeometry(0.22, 18, 14), m.mask);
    mask.scale.set(0.95, 1.25, 0.75);
    mask.position.set(0, 0.55, 0.04);
    this.head.add(mask);
    const hood = mesh(new THREE.SphereGeometry(0.27, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), m.robe);
    hood.scale.set(1, 1.3, 1);
    hood.position.set(0, 0.6, -0.04);
    hood.rotation.x = -0.35;
    this.head.add(hood);
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.045, 10, 8), m.maskHole, false);
      eye.scale.set(1, 1.5, 0.5);
      eye.position.set(side * 0.08, 0.62, 0.2);
      this.head.add(eye);
      // 冰蓝鸟瞳 + 竖瞳缝
      const iris = mesh(new THREE.SphereGeometry(0.028, 10, 8), fq.iceIris, false);
      iris.scale.set(1, 1.35, 0.4);
      iris.position.set(side * 0.08, 0.62, 0.218);
      const pupil = mesh(new THREE.BoxGeometry(0.007, 0.05, 0.005), fq.talon, false);
      pupil.position.set(side * 0.08, 0.62, 0.23);
      this.head.add(iris, pupil);
      const brow = mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI), m.maskHole, false);
      brow.position.set(side * 0.08, 0.68, 0.19);
      this.head.add(brow);
    }
    const smile = mesh(new THREE.TorusGeometry(0.1, 0.014, 4, 16, Math.PI * 0.9), m.maskHole, false);
    smile.position.set(0, 0.47, 0.19);
    smile.rotation.z = Math.PI + 0.15;
    this.head.add(smile);
    // 弯喙：上喙前伸 + 下勾尖
    const beak = mesh(new THREE.ConeGeometry(0.045, 0.17, 6), fq.beak);
    beak.scale.set(1, 1, 0.75);
    beak.rotation.x = Math.PI / 2 + 0.12;
    beak.position.set(0, 0.545, 0.27);
    const hook = mesh(new THREE.ConeGeometry(0.018, 0.07, 5), fq.beak, false);
    hook.rotation.x = Math.PI - 0.5;
    hook.position.set(0, 0.505, 0.345);
    const beakLine = mesh(new THREE.TorusGeometry(0.05, 0.004, 3, 10, Math.PI * 0.8), fq.goldThread, false);
    beakLine.rotation.set(0, Math.PI / 2, Math.PI * 0.6);
    beakLine.position.set(0, 0.54, 0.25);
    this.head.add(beak, hook, beakLine);
    // 肩羽环：两层青羽向外下披，金丝描边一圈
    for (let tier = 0; tier < 2; tier++) {
      const count = 16 - tier * 4;
      for (let i = 0; i < count; i++) {
        const a = ((i + tier * 0.5) / count) * Math.PI * 2;
        const pivot = new THREE.Group();
        pivot.position.y = 2.12 - tier * 0.12;
        pivot.rotation.y = a;
        const f = mesh(new THREE.ConeGeometry(0.075 + tier * 0.015, 0.46 + tier * 0.12, 4), (i + tier) % 2 ? fq.plumeDark : fq.plume);
        f.scale.z = 0.25;
        f.position.set(0, -0.05, 0.3 + tier * 0.04);
        f.rotation.x = Math.PI / 2 + 0.75 + tier * 0.15;
        pivot.add(f);
        this.root.add(pivot);
      }
    }
    const collarGold = mesh(new THREE.TorusGeometry(0.33, 0.012, 4, 28), fq.goldThread, false);
    collarGold.rotation.x = Math.PI / 2;
    collarGold.position.y = 2.06;
    this.root.add(collarGold);
    // 下摆溶入青黑羽雾
    const hemMist = mesh(new THREE.CylinderGeometry(0.5, 0.75, 0.6, 20, 1, true), fq.featherMist, false);
    hemMist.position.y = 0.22;
    this.root.add(hemMist);
    // long arms hanging past the knees
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.3, 2.0, 0);
      arm.add(mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.08, -1.0, 0.05), 0.07, 0.04, 6), m.robe));
      arm.add(mesh(limb(new THREE.Vector3(side * 0.08, -1.0, 0.05), new THREE.Vector3(side * 0.1, -1.55, 0.12), 0.035, 0.028, 6), m.grabberSkin));
      for (let f = 0; f < 4; f++) {
        arm.add(mesh(limb(new THREE.Vector3(side * 0.1, -1.55, 0.12), new THREE.Vector3(side * (0.06 + f * 0.03), -1.9, 0.14 + f * 0.01), 0.012, 0.006, 4), m.grabberSkin, false));
        // 黑长利爪
        const talon = mesh(new THREE.ConeGeometry(0.011, 0.2, 4), fq.talon, false);
        talon.rotation.x = Math.PI - 0.45;
        talon.position.set(side * (0.06 + f * 0.03), -1.99, 0.18 + f * 0.01);
        arm.add(talon);
      }
      this.arms.push(arm);
      this.root.add(arm);
    }
    this.root.scale.setScalar(1.08);
  }

  canCall(): boolean {
    return (this.state === 'dormant' || this.state === 'stalk') && this.cooldown <= 0;
  }

  /** Materialise behind the player and start the call. */
  beginCall(ctx: MonsterContext, flatForward: THREE.Vector3): void {
    if (this.state !== 'stalk') {
      const dist = 10.5 + ctx.rng() * 2.5;
      const side = (ctx.rng() - 0.5) * 3;
      const p = this.root.position;
      p.copy(ctx.playerPos).addScaledVector(flatForward, -dist);
      p.x += -flatForward.z * side;
      p.z += flatForward.x * side;
      ctx.colliders.resolve(p, 0.6);
      clampToCorridor(p, 0.5);
      p.y = 0;
    }
    this.callDelay = 0.75;
    this.warned = false;
    this.voiceDuration = 0;
    this.window = 99; // set precisely once the voice starts
    this.timer = 0;
    this.state = 'calling';
    this.root.visible = true;
  }

  /** Kill check is armed only once the warning voice has started. */
  get armed(): boolean {
    return this.state === 'calling' && this.warned;
  }

  startStalk(ctx: MonsterContext, flatForward: THREE.Vector3): void {
    if (this.state === 'calling') return;
    this.state = 'stalk';
    this.root.visible = true;
    const p = this.root.position;
    // appear far behind along the trail
    pathPoint(-ctx.playerPos.z + 26 + this.zone * 6, (this.zone - 1) * 4, p);
    void flatForward;
  }

  endStalk(): void {
    if (this.state === 'stalk') {
      this.state = 'vanish';
      this.timer = 0;
    }
  }

  /** Returns 'voice' on the frame the call is voiced. */
  update(dt: number, elapsed: number, ctx: MonsterContext, wantStalk: boolean): 'voice' | null {
    let event: 'voice' | null = null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const toPlayer = tmpA.subVectors(ctx.playerPos, this.root.position).setY(0);
    const dist = toPlayer.length();
    this.heading.v = Math.atan2(toPlayer.x, toPlayer.z);
    switch (this.state) {
      case 'dormant':
        this.visibleAmt = 0;
        this.root.visible = false;
        break;
      case 'calling': {
        this.timer += dt;
        this.visibleAmt = Math.min(1, this.visibleAmt + dt * 2.5);
        if (this.callDelay > 0) {
          this.callDelay -= dt;
          if (this.callDelay <= 0) {
            this.warned = true;
            this.voiceDuration = ctx.audio.callerVoice(tmpB.copy(this.root.position).setY(2.4));
            this.window = this.voiceDuration + 1.6;
            event = 'voice';
          }
        } else {
          this.window -= dt;
          // creep a little closer while calling
          if (dist > 7) {
            this.root.position.addScaledVector(toPlayer.normalize(), dt * 0.6);
          }
          if (this.window <= 0) {
            this.cooldown = wantStalk ? 7 : 24 + ctx.rng() * 14;
            this.state = wantStalk ? 'stalk' : 'vanish';
            this.timer = 0;
          }
        }
        break;
      }
      case 'stalk': {
        this.visibleAmt = Math.min(1, this.visibleAmt + dt);
        if (dist > 13) {
          steer(this.root.position, chaseTarget(this.root.position, ctx.playerPos, tmpB), dist > 30 ? 8 : 4.2, dt, ctx.colliders, { v: this.heading.v }, 0.6, 3);
        }
        if (!wantStalk) this.endStalk();
        break;
      }
      case 'vanish': {
        this.timer += dt;
        this.visibleAmt = Math.max(0, 1 - this.timer * 1.2);
        if (this.visibleAmt <= 0) {
          this.state = 'dormant';
          this.root.visible = false;
        }
        break;
      }
    }
    if (this.state !== 'dormant') pushOutOfSanctuary(this.root.position, ctx.sanctuary, 1.5);
    // presentation: rises from / sinks into the earth
    this.root.position.y = (this.visibleAmt - 1) * 2.6;
    this.root.rotation.y = this.heading.v;
    const tilt = this.state === 'calling' ? Math.min(0.5, this.timer * 0.25) : 0.1;
    this.head.rotation.set(Math.sin(elapsed * 0.7) * 0.05, 0, tilt);
    this.arms.forEach((a, i) => {
      a.rotation.x = this.state === 'calling' ? -Math.min(0.6, this.timer * 0.3) : Math.sin(elapsed * 0.9 + i) * 0.05;
      a.rotation.z = (i === 0 ? -1 : 1) * 0.05;
    });
    return event;
  }

  reset(): void {
    this.state = 'dormant';
    this.cooldown = 0;
    this.window = 0;
    this.callDelay = 0;
    this.warned = false;
    this.visibleAmt = 0;
    this.root.visible = false;
  }

  /** Jumpscare pose in the player's face. */
  lunge(eye: THREE.Vector3, forward: THREE.Vector3): void {
    this.root.visible = true;
    this.visibleAmt = 1;
    this.root.position.copy(eye).addScaledVector(forward, 1.0);
    this.root.position.y = eye.y - 2.75;
    this.root.rotation.y = Math.atan2(-forward.x, -forward.z);
    this.head.rotation.set(0.15, 0, 0.35);
  }
}

// ============================================================== HOWLER
type HowlerState = 'dormant' | 'rising' | 'watching' | 'leaving';

/** Far-range horror: appears when you take an ancient peach and summons everything. */
export class Howler {
  readonly root = new THREE.Group();
  state: HowlerState = 'dormant';
  private timer = 0;
  private howlTimer = 0;
  private side = 1;
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private readonly target = new THREE.Vector3();

  constructor(mats: MaterialLibrary) {
    this.build(mats);
    this.root.visible = false;
  }

  private build(m: MaterialLibrary): void {
    const hide = m.howlerHide;
    // stilt legs
    for (const side of [-1, 1]) {
      this.root.add(mesh(limb(new THREE.Vector3(side * 0.5, 3.4, 0), new THREE.Vector3(side * 0.9, 1.7, 0.4), 0.22, 0.14, 8), hide));
      this.root.add(mesh(limb(new THREE.Vector3(side * 0.9, 1.7, 0.4), new THREE.Vector3(side * 0.8, 0, -0.2), 0.14, 0.08, 8), hide));
    }
    // hunched torso
    const torsoPts = [
      [0.1, 0],
      [0.7, 0.3],
      [0.95, 1.2],
      [0.85, 2.1],
      [0.5, 2.7],
      [0.15, 2.9],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = mesh(new THREE.LatheGeometry(torsoPts, 14), hide);
    torso.position.set(0, 3.2, 0);
    torso.rotation.x = 0.55;
    this.root.add(torso);
    // ribs of bone
    for (let i = 0; i < 5; i++) {
      const rib = mesh(new THREE.TorusGeometry(0.85 - i * 0.06, 0.04, 4, 16, Math.PI * 1.2), m.howlerBone, false);
      rib.position.set(0, 3.7 + i * 0.4, 0.35 + i * 0.22);
      rib.rotation.set(Math.PI / 2 + 0.55, 0, -Math.PI * 0.1);
      this.root.add(rib);
    }
    // neck + skull
    this.head.position.set(0, 5.6, 1.7);
    this.root.add(this.head);
    this.head.add(mesh(limb(new THREE.Vector3(0, -0.6, -0.6), new THREE.Vector3(0, 0, 0), 0.25, 0.2, 8), hide));
    const skull = mesh(new THREE.SphereGeometry(0.5, 14, 10), m.howlerBone);
    skull.scale.set(0.8, 0.85, 1.5);
    skull.position.set(0, 0.1, 0.35);
    this.head.add(skull);
    const snout = mesh(new THREE.ConeGeometry(0.28, 0.9, 8), m.howlerBone);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.05, 1.1);
    this.head.add(snout);
    // many eyes
    const eyeGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const eyeSpots = [
      [-0.22, 0.25, 0.9],
      [0.22, 0.25, 0.9],
      [-0.32, 0.1, 0.75],
      [0.32, 0.1, 0.75],
      [-0.15, 0.4, 0.7],
      [0.15, 0.4, 0.7],
      [0, 0.32, 0.95],
    ];
    for (const [x, y, z] of eyeSpots) {
      const e = mesh(eyeGeo, m.howlerEye, false);
      e.position.set(x, y, z);
      e.scale.setScalar(x === 0 ? 1.3 : 1);
      this.eyes.push(e);
      this.head.add(e);
    }
    // antlers: branching bone
    for (const side of [-1, 1]) {
      const base = new THREE.Vector3(side * 0.3, 0.45, 0.2);
      const a1 = new THREE.Vector3(side * 1.1, 1.6, -0.1);
      const a2 = new THREE.Vector3(side * 1.9, 2.4, -0.3);
      const a3 = new THREE.Vector3(side * 1.4, 2.9, 0.2);
      const a4 = new THREE.Vector3(side * 0.7, 2.3, -0.4);
      this.head.add(mesh(limb(base, a1, 0.09, 0.07, 6), m.howlerBone));
      this.head.add(mesh(limb(a1, a2, 0.07, 0.03, 5), m.howlerBone));
      this.head.add(mesh(limb(a1, a3, 0.06, 0.025, 5), m.howlerBone));
      this.head.add(mesh(limb(a1, a4, 0.05, 0.02, 5), m.howlerBone));
      this.head.add(mesh(limb(a2, a2.clone().add(new THREE.Vector3(side * 0.5, 0.3, 0.2)), 0.03, 0.01, 4), m.howlerBone));
    }
    const fj = accents();
    // 裂冠：残缺凤冠金环（缺口）+ 高低不齐冠尖，一枚断片歪斜
    const crown = new THREE.Group();
    crown.position.set(0, 0.47, 0.3);
    crown.rotation.x = -0.12;
    const band = mesh(new THREE.TorusGeometry(0.3, 0.035, 5, 20, Math.PI * 1.55), fj.gold);
    band.rotation.set(Math.PI / 2, 0, Math.PI * 0.6);
    crown.add(band);
    const spikeH = [0.32, 0.18, 0.46, 0.22, 0.38, 0.12, 0.28];
    spikeH.forEach((h, i) => {
      const a = Math.PI * 0.6 + (i / (spikeH.length - 1)) * Math.PI * 1.5;
      const spike = mesh(new THREE.ConeGeometry(0.045, h, 4), fj.gold, false);
      spike.position.set(Math.cos(a) * 0.3, h / 2, -Math.sin(a) * 0.3);
      spike.rotation.set(Math.sin(i * 3.1) * 0.25, 0, Math.cos(i * 2.3) * 0.25);
      crown.add(spike);
      if (i % 3 === 0) {
        const gem = mesh(new THREE.OctahedronGeometry(0.035), fj.goldEye, false);
        gem.position.set(Math.cos(a) * 0.3, 0.02, -Math.sin(a) * 0.32);
        crown.add(gem);
      }
    });
    const shard = mesh(new THREE.ConeGeometry(0.05, 0.3, 4), fj.gold, false);
    shard.position.set(-0.36, 0.05, 0.18);
    shard.rotation.set(0.4, 0, 1.1);
    crown.add(shard);
    this.head.add(crown);
    // 半脸金纹：沿颅骨右侧表面爬行的金色裂纹
    const surf = (u: number, v: number) =>
      new THREE.Vector3(0.4 * Math.sin(u) * Math.cos(v), 0.425 * Math.sin(v), 0.75 * Math.cos(u) * Math.cos(v)).multiplyScalar(1.03).add(new THREE.Vector3(0, 0.1, 0.35));
    const veinPaths: [number, number][][] = [
      [[0.15, 0.55], [0.35, 0.4], [0.5, 0.45], [0.75, 0.3], [1.0, 0.35], [1.3, 0.15]],
      [[0.35, 0.4], [0.45, 0.15], [0.7, 0.05], [0.95, -0.1], [1.25, -0.2]],
      [[0.45, 0.15], [0.4, -0.15], [0.6, -0.35], [0.85, -0.45]],
      [[0.75, 0.3], [0.85, 0.6], [1.0, 0.8]],
      [[0.7, 0.05], [0.55, -0.05]],
    ];
    for (const path of veinPaths) {
      for (let i = 0; i < path.length - 1; i++) {
        const [u0, v0] = path[i]!;
        const [u1, v1] = path[i + 1]!;
        this.head.add(mesh(limb(surf(u0, v0), surf(u1, v1), 0.018, 0.012, 4), fj.goldVein, false));
      }
    }
    // 金瞳强调：右侧主眼套金环
    const goldRing = mesh(new THREE.TorusGeometry(0.1, 0.018, 4, 14), fj.goldVein, false);
    goldRing.position.set(0.22, 0.25, 0.9);
    goldRing.rotation.set(-0.2, 0.45, 0);
    const goldIris = mesh(new THREE.SphereGeometry(0.05, 8, 6), fj.goldEye, false);
    goldIris.position.set(0.23, 0.25, 0.93);
    this.head.add(goldRing, goldIris);
    // 背后召妖符阵：金线圆阵（双环 + 八卦刻度 + 六芒 + 符点）
    const sigil = new THREE.Group();
    sigil.name = 'howlerSigil';
    sigil.position.set(0, 5.4, -1.3);
    sigil.rotation.x = -0.15;
    const ringGeoOuter = new THREE.TorusGeometry(2.3, 0.035, 3, 64);
    const ringGeoInner = new THREE.TorusGeometry(1.75, 0.025, 3, 56);
    sigil.add(mesh(ringGeoOuter, fj.sigil, false), mesh(ringGeoInner, fj.sigil, false));
    sigil.add(mesh(new THREE.TorusGeometry(0.6, 0.03, 3, 32), fj.sigil, false));
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const tick = mesh(new THREE.BoxGeometry(0.03, i % 3 === 0 ? 0.5 : 0.25, 0.01), fj.sigil, false);
      const r = i % 3 === 0 ? 2.02 : 2.12;
      tick.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      tick.rotation.z = a - Math.PI / 2;
      sigil.add(tick);
    }
    for (let tri = 0; tri < 2; tri++) {
      for (let k = 0; k < 3; k++) {
        const a0 = Math.PI / 2 + tri * Math.PI + (k / 3) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / 3;
        const p0 = new THREE.Vector2(Math.cos(a0), Math.sin(a0)).multiplyScalar(1.75);
        const p1 = new THREE.Vector2(Math.cos(a1), Math.sin(a1)).multiplyScalar(1.75);
        const edge = mesh(new THREE.BoxGeometry(p0.distanceTo(p1), 0.03, 0.01), fj.sigil, false);
        edge.position.set((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 0);
        edge.rotation.z = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        sigil.add(edge);
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const glyph = new THREE.Group();
      glyph.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
      glyph.rotation.z = a;
      glyph.add(mesh(new THREE.BoxGeometry(0.22, 0.025, 0.01), fj.sigil, false));
      const bar = mesh(new THREE.BoxGeometry(0.025, 0.18, 0.01), fj.sigil, false);
      bar.position.x = (i % 2 ? 0.06 : -0.06);
      glyph.add(bar);
      const dot = mesh(new THREE.CircleGeometry(0.035, 8), fj.sigil, false);
      dot.position.set(0.12, 0.08, 0);
      glyph.add(dot);
      sigil.add(glyph);
    }
    this.root.add(sigil);
    // 金丝边：残破华服躯干金绣环 + 墨紫披帛
    const trim = new THREE.Group();
    trim.position.copy(torso.position);
    trim.rotation.copy(torso.rotation);
    for (const [r, y, arc] of [
      [0.98, 1.2, Math.PI * 1.7],
      [0.88, 2.1, Math.PI * 2],
      [0.53, 2.7, Math.PI * 1.4],
    ] as const) {
      const ring = mesh(new THREE.TorusGeometry(r, 0.03, 4, 32, arc), fj.gold, false);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      trim.add(ring);
    }
    const sash = mesh(new THREE.CylinderGeometry(0.9, 1.05, 1.3, 14, 1, true, Math.PI * 0.75, Math.PI * 1.5), fj.inkPurple);
    sash.position.y = 0.95;
    trim.add(sash);
    const sashEdge = mesh(new THREE.TorusGeometry(1.05, 0.025, 3, 28, Math.PI * 1.5), fj.gold, false);
    sashEdge.rotation.set(Math.PI / 2, 0, Math.PI * 0.75 - Math.PI / 2);
    sashEdge.position.y = 0.3;
    trim.add(sashEdge);
    this.root.add(trim);
    // arms dragging to the ground
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.95, 5.0, 1.1);
      arm.add(mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.6, -2.4, 0.6), 0.18, 0.12, 8), hide));
      arm.add(mesh(limb(new THREE.Vector3(side * 0.6, -2.4, 0.6), new THREE.Vector3(side * 0.7, -4.6, 1.2), 0.12, 0.07, 8), hide));
      for (let f = 0; f < 4; f++) {
        arm.add(mesh(limb(new THREE.Vector3(side * 0.7, -4.6, 1.2), new THREE.Vector3(side * (0.5 + f * 0.12), -5.05, 1.5 + f * 0.05), 0.04, 0.015, 4), m.howlerBone, false));
      }
      // 金绣袖口
      for (const [y, x, z, r] of [
        [-2.4, 0.6, 0.6, 0.15],
        [-4.3, 0.69, 1.12, 0.1],
      ] as const) {
        const cuff = mesh(new THREE.TorusGeometry(r, 0.022, 4, 16), fj.gold, false);
        cuff.position.set(side * x, y, z);
        cuff.rotation.x = Math.PI / 2 - 0.25;
        arm.add(cuff);
      }
      this.arms.push(arm);
      this.root.add(arm);
    }
    this.root.scale.setScalar(1.15);
  }

  get active(): boolean {
    return this.state !== 'dormant';
  }

  /** Appear ~50 m away at the forest edge. */
  appear(ctx: MonsterContext): void {
    const pt = -ctx.playerPos.z;
    this.side = ctx.rng() < 0.5 ? -1 : 1;
    const along = (ctx.rng() < 0.6 ? -1 : 1) * (30 + ctx.rng() * 12);
    const t = THREE.MathUtils.clamp(pt + along, 10, 370);
    pathPoint(t, this.side * (CORRIDOR_HALF_WIDTH + 13), this.root.position);
    this.target.copy(this.root.position);
    this.state = 'rising';
    this.timer = 0;
    this.root.visible = true;
    this.root.position.y = -9;
  }

  dismiss(): void {
    if (this.state === 'rising' || this.state === 'watching') {
      this.state = 'leaving';
      this.timer = 0;
    }
  }

  /** Returns true on frames where it howls. */
  update(dt: number, elapsed: number, ctx: MonsterContext): boolean {
    if (this.state === 'dormant') return false;
    let howl = false;
    this.timer += dt;
    const toPlayer = tmpA.subVectors(ctx.playerPos, this.root.position).setY(0);
    this.root.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
    switch (this.state) {
      case 'rising':
        this.root.position.y = Math.min(0, -9 + this.timer * 6);
        if (this.timer > 1.6) {
          this.state = 'watching';
          this.howlTimer = 0;
          howl = true;
        }
        break;
      case 'watching': {
        this.howlTimer += dt;
        if (this.howlTimer > 13) {
          this.howlTimer = 0;
          howl = true;
        }
        // keep pace ~45 m away, outside the corridor
        const pt = -ctx.playerPos.z;
        const mt = -this.root.position.z;
        const want = THREE.MathUtils.clamp(pt + Math.sign(mt - pt || 1) * 36, 0, 380);
        pathPoint(want, this.side * (CORRIDOR_HALF_WIDTH + 13 + Math.abs(pathSlope(want)) * 2), this.target);
        const d = this.target.clone().sub(this.root.position).setY(0);
        const len = d.length();
        if (len > 0.5) this.root.position.addScaledVector(d.normalize(), Math.min(len, dt * 5));
        pushOutOfSanctuary(this.root.position, ctx.sanctuary, 4);
        this.root.position.y = 0;
        break;
      }
      case 'leaving':
        this.root.position.y = -this.timer * 4;
        if (this.timer > 2.5) {
          this.state = 'dormant';
          this.root.visible = false;
        }
        break;
    }
    // presentation: breathing, head raised when howling
    const howling = this.state === 'watching' && this.howlTimer < 3.5;
    this.head.rotation.x = howling ? -0.6 + Math.sin(elapsed * 6) * 0.05 : 0.15 + Math.sin(elapsed * 0.8) * 0.05;
    this.arms.forEach((a, i) => (a.rotation.x = Math.sin(elapsed * 0.6 + i) * 0.06 + (howling ? -0.25 : 0)));
    const flicker = 1 + Math.sin(elapsed * 9) * 0.1;
    for (const e of this.eyes) e.scale.setScalar(flicker * (howling ? 1.5 : 1.1));
    return howl;
  }

  reset(): void {
    this.state = 'dormant';
    this.root.visible = false;
  }
}
