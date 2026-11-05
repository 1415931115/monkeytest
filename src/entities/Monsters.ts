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
  colliders: ColliderGrid;
  audio: AudioSystem;
  rng: () => number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const avoid = { x: 0, z: 0 };

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  return m;
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
      const tooth = mesh(new THREE.ConeGeometry(0.012, 0.05, 4), m.mask, false);
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

  /** Returns true when it catches the player this frame. */
  update(dt: number, ctx: MonsterContext, zoneBonus: number): boolean {
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
        steer(this.position, chaseTarget(this.position, ctx.playerPos, tmpB), speed, dt, ctx.colliders, this.heading, 0.45, 3);
        this.growlTimer -= dt;
        if (this.growlTimer <= 0 && dist < 30) {
          this.growlTimer = 2.5 + ctx.rng() * 2.5;
          ctx.audio.chaserGrowl(this.position);
        }
        if (dist < 1.25) {
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
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 6);
    this.root.rotation.y = this.heading.v;
    return caught;
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
    // long neck
    this.head.position.set(0, 2.3, 0);
    this.root.add(this.head);
    const neck = mesh(limb(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, 0.35, 0.04), 0.06, 0.05, 8), m.grabberSkin);
    this.head.add(neck);
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
      const brow = mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI), m.maskHole, false);
      brow.position.set(side * 0.08, 0.68, 0.19);
      this.head.add(brow);
    }
    const smile = mesh(new THREE.TorusGeometry(0.1, 0.014, 4, 16, Math.PI * 0.9), m.maskHole, false);
    smile.position.set(0, 0.47, 0.19);
    smile.rotation.z = Math.PI + 0.15;
    this.head.add(smile);
    // long arms hanging past the knees
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.3, 2.0, 0);
      arm.add(mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.08, -1.0, 0.05), 0.07, 0.04, 6), m.robe));
      arm.add(mesh(limb(new THREE.Vector3(side * 0.08, -1.0, 0.05), new THREE.Vector3(side * 0.1, -1.55, 0.12), 0.035, 0.028, 6), m.grabberSkin));
      for (let f = 0; f < 4; f++) {
        arm.add(mesh(limb(new THREE.Vector3(side * 0.1, -1.55, 0.12), new THREE.Vector3(side * (0.06 + f * 0.03), -1.9, 0.14 + f * 0.01), 0.012, 0.006, 4), m.grabberSkin, false));
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
    this.state = 'calling';
    this.root.visible = true;
    this.callDelay = 0.75;
    this.voiceDuration = 0;
    this.window = 99; // set precisely once the voice starts
    this.timer = 0;
  }

  /** Kill check is armed when this is true. */
  get armed(): boolean {
    return this.state === 'calling' && this.timer > 0.45;
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
    // arms dragging to the ground
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.95, 5.0, 1.1);
      arm.add(mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.6, -2.4, 0.6), 0.18, 0.12, 8), hide));
      arm.add(mesh(limb(new THREE.Vector3(side * 0.6, -2.4, 0.6), new THREE.Vector3(side * 0.7, -4.6, 1.2), 0.12, 0.07, 8), hide));
      for (let f = 0; f < 4; f++) {
        arm.add(mesh(limb(new THREE.Vector3(side * 0.7, -4.6, 1.2), new THREE.Vector3(side * (0.5 + f * 0.12), -5.05, 1.5 + f * 0.05), 0.04, 0.015, 4), m.howlerBone, false));
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
