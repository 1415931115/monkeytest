import * as THREE from 'three';
import { LOW_SPEC } from '../core/Quality';
import { MaterialLibrary, TIER_COLORS } from '../assets/MaterialLibrary';
import { buildPeachGeometry, buildPeachLeafGeometry } from '../assets/WorldKit';
import type { PeachSpot } from '../game/Level';

export type Tier = 0 | 1 | 2 | 3;
export const TIER_YEARS = [10, 100, 1000, 10000] as const;
export const TIER_VALUE = [10, 100, 1000, 10000] as const;
export const TIER_HARVEST_TIME = [0.9, 1.5, 2.3, 3.2] as const;
export const TIER_NAMES = ['十年桃', '百年桃', '千年桃', '万年蟠桃'] as const;

/** Tier weights per zone (10y,100y,1000y,10000y). */
const ZONE_WEIGHTS: number[][] = [
  [0.74, 0.24, 0.02, 0],
  [0.44, 0.41, 0.135, 0.015],
  [0.25, 0.42, 0.27, 0.06],
];
const PER_ZONE = [17, 17, 15];
const MAX_PER_TREE_SPACING = 1.6;

export interface Peach {
  id: number;
  tier: Tier;
  position: THREE.Vector3;
  active: boolean;
  slot: number;
  phase: number;
}

/** Instanced flat peaches with tier halos; re-rolled each run. */
export class PeachField {
  readonly root = new THREE.Group();
  readonly peaches: Peach[] = [];
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly leaves: THREE.InstancedMesh;
  private readonly halos: THREE.Points[] = [];
  private readonly haloMats: THREE.PointsMaterial[] = [];
  private readonly sparkles: THREE.Points;
  private readonly sparkleMat: THREE.ShaderMaterial;
  private readonly cap = 40;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(mats: MaterialLibrary) {
    for (let tier = 0; tier < 4; tier++) {
      const mesh = new THREE.InstancedMesh(buildPeachGeometry(tier), mats.peach[tier], this.cap);
      mesh.castShadow = !LOW_SPEC;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.bodies.push(mesh);
      this.root.add(mesh);
      const hm = new THREE.PointsMaterial({
        map: mats.glow,
        color: TIER_COLORS[tier],
        size: [0.0, 0.9, 1.8, 2.8][tier],
        sizeAttenuation: true,
        transparent: true,
        opacity: [0, 0.55, 0.85, 1][tier],
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: tier < 2,
      });
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3));
      const halo = new THREE.Points(hg, hm);
      halo.frustumCulled = false;
      this.halos.push(halo);
      this.haloMats.push(hm);
      if (tier > 0) this.root.add(halo);
    }
    this.leaves = new THREE.InstancedMesh(buildPeachLeafGeometry(), mats.peachLeaf, this.cap * 4);
    this.leaves.frustumCulled = false;
    this.leaves.count = 0;
    this.root.add(this.leaves);

    // orbiting sparkles around ancient (1000y+) peaches
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.cap * 6 * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(this.cap * 6), 1));
    this.sparkleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uMap: { value: mats.sparkle } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        varying float vA;
        void main() {
          float t = uTime * (0.8 + fract(aSeed * 7.0)) + aSeed * 6.28;
          vec3 p = position + vec3(cos(t) * 0.32, sin(t * 1.7) * 0.18, sin(t) * 0.32);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = (0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 20.0)) * smoothstep(60.0, 4.0, -mv.z);
          gl_PointSize = 30.0 / max(-mv.z, 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vA;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r * vA;
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.6) * a * 2.0, a);
        }`,
    });
    this.sparkles = new THREE.Points(sg, this.sparkleMat);
    this.sparkles.frustumCulled = false;
    this.root.add(this.sparkles);
  }

  /** Choose this run's peaches from the level's hang points. */
  reset(spots: PeachSpot[], rng: () => number): void {
    this.peaches.length = 0;
    const byZone: PeachSpot[][] = [[], [], []];
    for (const sp of spots) if (sp.special === undefined) byZone[sp.zone].push(sp);
    let id = 0;
    const chosen: THREE.Vector3[] = [];
    const counts = [0, 0, 0, 0];
    const push = (pos: THREE.Vector3, tier: Tier) => {
      if (counts[tier] >= this.cap) return;
      counts[tier]++;
      chosen.push(pos);
      this.peaches.push({ id: id++, tier, position: pos.clone(), active: true, slot: -1, phase: rng() * 10 });
    };
    for (const sp of spots) if (sp.special !== undefined) push(sp.position, sp.special as Tier);
    byZone.forEach((list, zone) => {
      // shuffle
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      let placed = 0;
      let guaranteedRare = zone === 1; // Mist Grove always has at least one 1,000-year peach
      for (const sp of list) {
        if (placed >= PER_ZONE[zone]) break;
        if (chosen.some((c) => c.distanceToSquared(sp.position) < MAX_PER_TREE_SPACING * MAX_PER_TREE_SPACING)) continue;
        let tier = this.rollTier(zone, rng);
        if (guaranteedRare && placed === 5) {
          tier = 2;
          guaranteedRare = false;
        }
        push(sp.position, tier);
        placed++;
      }
    });
    this.rebuildInstances();
  }

  private rollTier(zone: number, rng: () => number): Tier {
    const w = ZONE_WEIGHTS[zone];
    let r = rng();
    for (let i = 0; i < 4; i++) {
      r -= w[i];
      if (r <= 0) return i as Tier;
    }
    return 0;
  }

  private rebuildInstances(): void {
    const counters = [0, 0, 0, 0];
    for (const p of this.peaches) {
      p.slot = counters[p.tier]++;
    }
    for (let t = 0; t < 4; t++) {
      this.bodies[t].count = counters[t];
      const attr = this.halos[t].geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.array.fill(0);
      this.halos[t].geometry.setDrawRange(0, counters[t]);
    }
    this.leaves.count = this.peaches.length;
    const sp = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ss = this.sparkles.geometry.getAttribute('aSeed') as THREE.BufferAttribute;
    let n = 0;
    for (const p of this.peaches) {
      const halo = this.halos[p.tier].geometry.getAttribute('position') as THREE.BufferAttribute;
      halo.setXYZ(p.slot, p.position.x, p.position.y, p.position.z);
      halo.needsUpdate = true;
      if (p.tier >= 2) {
        const k = p.tier === 3 ? 6 : 3;
        for (let i = 0; i < k && n < this.cap * 6; i++, n++) {
          sp.setXYZ(n, p.position.x, p.position.y, p.position.z);
          ss.setX(n, p.id * 1.37 + i * 0.71);
        }
      }
    }
    sp.needsUpdate = true;
    ss.needsUpdate = true;
    this.sparkles.geometry.setDrawRange(0, n);
    this.update(0, 0);
  }

  update(_dt: number, elapsed: number): void {
    this.sparkleMat.uniforms.uTime.value = elapsed;
    for (let i = 0; i < this.peaches.length; i++) {
      const p = this.peaches[i];
      const body = this.bodies[p.tier];
      if (!p.active) {
        body.setMatrixAt(p.slot, this.hidden);
        this.leaves.setMatrixAt(i, this.hidden);
        continue;
      }
      const sway = Math.sin(elapsed * 1.3 + p.phase) * 0.12;
      const bob = p.tier >= 2 ? Math.sin(elapsed * 2 + p.phase) * 0.03 : 0;
      this.e.set(sway, p.phase + (p.tier === 3 ? elapsed * 0.6 : 0), sway * 0.6);
      this.q.setFromEuler(this.e);
      this.s.setScalar(p.tier === 3 ? 1.25 : 1);
      this.m.compose(new THREE.Vector3(p.position.x, p.position.y + bob, p.position.z), this.q, this.s);
      body.setMatrixAt(p.slot, this.m);
      this.leaves.setMatrixAt(i, this.m);
    }
    for (const b of this.bodies) b.instanceMatrix.needsUpdate = true;
    this.leaves.instanceMatrix.needsUpdate = true;
    const pulse = 0.85 + Math.sin(elapsed * 2.4) * 0.15;
    this.haloMats[2].opacity = 0.75 * pulse;
    this.haloMats[3].opacity = 0.95 * pulse;
  }

  collect(p: Peach): void {
    p.active = false;
    const halo = this.halos[p.tier].geometry.getAttribute('position') as THREE.BufferAttribute;
    halo.setXYZ(p.slot, 0, -500, 0);
    halo.needsUpdate = true;
    if (p.tier >= 2) {
      const sp = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < sp.count; i++) {
        if (Math.abs(sp.getX(i) - p.position.x) < 1e-4 && Math.abs(sp.getZ(i) - p.position.z) < 1e-4) sp.setXYZ(i, 0, -500, 0);
      }
      sp.needsUpdate = true;
    }
  }

  /**
   * Peach under the reticle within reach, or null.
   * Pitch is locked level, so the aim cone is horizontal. Height still counts
   * toward `reach` — a peach you are facing must stay pickable when it hangs
   * above or below the horizon.
   */
  findTarget(
    eye: THREE.Vector3,
    forward: THREE.Vector3,
    reach: number,
    occluders?: { blocksSegment(x0: number, z0: number, x1: number, z1: number): boolean } | null,
  ): Peach | null {
    let best: Peach | null = null;
    let bestScore = Infinity;
    const d = new THREE.Vector3();
    const fh = Math.hypot(forward.x, forward.z);
    const fx = fh > 1e-5 ? forward.x / fh : 0;
    const fz = fh > 1e-5 ? forward.z / fh : -1;
    for (const p of this.peaches) {
      if (!p.active) continue;
      d.subVectors(p.position, eye);
      const dist = d.length();
      if (dist > reach || dist < 1e-4) continue;
      const horiz = Math.hypot(d.x, d.z);
      const cos = horiz < 1e-4 ? 1 : (d.x * fx + d.z * fz) / horiz;
      const allowed = Math.cos(THREE.MathUtils.degToRad(8 + 14 / Math.max(dist, 0.6)));
      if (cos < allowed) continue;
      if (occluders?.blocksSegment(eye.x, eye.z, p.position.x, p.position.z)) continue;
      const score = (1 - cos) * 10 + dist * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  dispose(): void {
    for (const b of this.bodies) b.geometry.dispose();
    this.leaves.geometry.dispose();
    for (const h of this.halos) h.geometry.dispose();
    for (const m of this.haloMats) m.dispose();
    this.sparkles.geometry.dispose();
    this.sparkleMat.dispose();
  }
}
