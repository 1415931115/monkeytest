import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSeededRandom } from '../utils/random';
import type { MaterialLibrary } from './MaterialLibrary';
import { plaqueTexture } from './ProceduralTextures';

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

/** Tapered open cylinder from p0 to p1 with bark-friendly UVs. */
export function limb(p0: THREE.Vector3, p1: THREE.Vector3, r0: number, r1: number, radial = 7): THREE.BufferGeometry {
  tmpDir.subVectors(p1, p0);
  const len = tmpDir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 2, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, r0 * 8), uv.getY(i) * len * 0.8);
  g.translate(0, len / 2, 0);
  tmpQuat.setFromUnitVectors(UP, tmpDir.normalize());
  g.applyQuaternion(tmpQuat);
  g.translate(p0.x, p0.y, p0.z);
  return g;
}

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Lumpy faceted blob with per-face colour (leaf/blossom clusters, rocks). */
export function lumpyBlob(
  radius: number,
  detail: number,
  jitter: number,
  colorFn: ((rng: () => number) => THREE.Color) | null,
  rng: () => number,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = hash3(Math.round(v.x * 50), Math.round(v.y * 50), Math.round(v.z * 50));
    v.multiplyScalar(1 + (h - 0.5) * jitter);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  if (colorFn) {
    const colors = new Float32Array(pos.count * 3);
    for (let f = 0; f < pos.count; f += 3) {
      const c = colorFn(rng);
      for (let k = 0; k < 3; k++) {
        colors[(f + k) * 3] = c.r;
        colors[(f + k) * 3 + 1] = c.g;
        colors[(f + k) * 3 + 2] = c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  g.computeVertexNormals();
  return g;
}

const LEAF_DARK = new THREE.Color('#16301a');
const LEAF_MID = new THREE.Color('#2a4d24');
const LEAF_LIGHT = new THREE.Color('#47693a');
const BLOSSOM = new THREE.Color('#d9839f');
const BLOSSOM_PALE = new THREE.Color('#f0b8c8');

function leafColor(rng: () => number): THREE.Color {
  const r = rng();
  if (r < 0.14) return BLOSSOM.clone().lerp(BLOSSOM_PALE, rng());
  if (r < 0.5) return LEAF_DARK.clone().lerp(LEAF_MID, rng());
  return LEAF_MID.clone().lerp(LEAF_LIGHT, rng() * 0.8);
}

export interface TreeTemplate {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  /** Local hang points for peaches (under branches, reachable height). */
  anchors: THREE.Vector3[];
  trunkRadius: number;
}

/** A gnarled pan-tao tree: twisted trunk, spreading low branches, blossom-flecked canopy. */
export function buildTreeTemplate(seed: number): TreeTemplate {
  const rng = createSeededRandom(seed);
  const limbs: THREE.BufferGeometry[] = [];
  const blobs: THREE.BufferGeometry[] = [];
  const anchors: THREE.Vector3[] = [];

  // Trunk: three bent segments.
  const trunkPts: THREE.Vector3[] = [new THREE.Vector3(0, -0.1, 0)];
  const H = 1.3 + rng() * 0.6;
  let lean = new THREE.Vector3((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize();
  for (let i = 0; i < 3; i++) {
    const prev = trunkPts[trunkPts.length - 1];
    lean = lean.clone().add(new THREE.Vector3((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6)).normalize();
    trunkPts.push(prev.clone().addScaledVector(lean, H / 3 + 0.05));
  }
  const trunkR = 0.24 + rng() * 0.08;
  for (let i = 0; i < 3; i++) {
    limbs.push(limb(trunkPts[i], trunkPts[i + 1], trunkR * (1 - i * 0.22), trunkR * (1 - (i + 1) * 0.22), 9));
  }
  // Root flare
  const roots = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng() * 0.6;
    const p0 = new THREE.Vector3(0, 0.35, 0);
    const p1 = new THREE.Vector3(Math.cos(a) * (0.55 + rng() * 0.3), -0.05, Math.sin(a) * (0.55 + rng() * 0.3));
    limbs.push(limb(p0, p1, trunkR * 0.55, 0.03, 6));
  }
  // Knot
  const knot = lumpyBlob(trunkR * 1.05, 0, 0.5, null, rng);
  knot.deleteAttribute('uv');
  const top = trunkPts[3];

  // Branches
  const branches = 4 + Math.floor(rng() * 3);
  const az0 = rng() * Math.PI * 2;
  for (let b = 0; b < branches; b++) {
    const az = az0 + (b / branches) * Math.PI * 2 + (rng() - 0.5) * 0.7;
    const elev = 0.35 + rng() * 0.5;
    const len = 1.5 + rng() * 0.8;
    const start = trunkPts[2].clone().lerp(top, 0.3 + rng() * 0.7);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const mid = start.clone().addScaledVector(dir, len * 0.55);
    const dir2 = dir.clone().add(new THREE.Vector3((rng() - 0.5) * 0.5, 0.35, (rng() - 0.5) * 0.5)).normalize();
    const end = mid.clone().addScaledVector(dir2, len * 0.5);
    const r0 = 0.11 + rng() * 0.03;
    limbs.push(limb(start, mid, r0, r0 * 0.65, 6));
    limbs.push(limb(mid, end, r0 * 0.65, 0.025, 5));
    // twig
    const twigDir = new THREE.Vector3(-dir.z, 0.6, dir.x).multiplyScalar(rng() < 0.5 ? 1 : -1).normalize();
    const twigEnd = mid.clone().addScaledVector(twigDir, 0.6 + rng() * 0.4);
    limbs.push(limb(mid, twigEnd, r0 * 0.4, 0.015, 4));

    // canopy clusters above the branch tip and twig
    for (const c of [end, twigEnd, mid.clone().lerp(end, 0.5)]) {
      const r = 0.7 + rng() * 0.5;
      const blob = lumpyBlob(r, 1, 0.45, leafColor, rng);
      blob.scale(1.15, 0.62, 1.15);
      blob.translate(c.x + (rng() - 0.5) * 0.3, c.y + 0.35 + rng() * 0.2, c.z + (rng() - 0.5) * 0.3);
      blobs.push(blob);
    }

    // peach hang points along the branch
    for (const f of [0.45, 0.8]) {
      const hp = f < 0.6 ? start.clone().lerp(mid, f + 0.3) : mid.clone().lerp(end, f - 0.4);
      hp.y -= 0.28;
      if (hp.y > 1.25 && hp.y < 2.45) anchors.push(hp);
    }
  }
  // crown cluster
  const crown = lumpyBlob(1.1 + rng() * 0.3, 1, 0.4, leafColor, rng);
  crown.scale(1.2, 0.7, 1.2);
  crown.translate(top.x, top.y + 1.2, top.z);
  blobs.push(crown);

  const trunkParts = limbs.map((g) => {
    g.deleteAttribute('uv');
    return g;
  });
  // re-add uvs consistently? bark uses triplanar-ish world mapping via cylinder uvs; keep uvs by rebuilding.
  const trunk = mergeGeometries([...trunkParts.map((g) => g.toNonIndexed()), knot.translate(top.x, top.y - 0.1, top.z)]);
  addCylindricalUv(trunk);
  for (const b of blobs) b.deleteAttribute('uv');
  const canopy = mergeGeometries(blobs);
  trunk.computeBoundingSphere();
  canopy.computeBoundingSphere();
  return { trunk, canopy, anchors, trunkRadius: trunkR };
}

/** Cheap cylindrical projection UVs for merged bark geometry. */
function addCylindricalUv(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    uv[i * 2] = (Math.atan2(z, x) / (Math.PI * 2)) * 2 + x * 0.6;
    uv[i * 2 + 1] = y * 0.9;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Flat "donut" peach (pan-tao) lathe with tier-specific blush vertex colours. */
export function buildPeachGeometry(tier: number): THREE.BufferGeometry {
  const s = 1.25;
  const profile = [
    [0.0, -0.032],
    [0.02, -0.04],
    [0.05, -0.05],
    [0.09, -0.046],
    [0.118, -0.026],
    [0.127, 0.0],
    [0.12, 0.022],
    [0.096, 0.044],
    [0.06, 0.054],
    [0.03, 0.046],
    [0.012, 0.036],
    [0.0, 0.03],
  ].map(([r, y]) => new THREE.Vector2(r * s, y * s));
  const g = new THREE.LatheGeometry(profile, 28);
  // suture groove: pinch along one meridian
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const palettes: [string, string, string][] = [
    ['#e8d6a0', '#e48a6a', '#b84a4a'],
    ['#f5d0b4', '#ff6f8f', '#d42a5c'],
    ['#ffe08a', '#ffb43a', '#ff7a2a'],
    ['#f4fbff', '#c8f2ff', '#ffd6f4'],
  ];
  const [base, blush, deep] = palettes[tier].map((c) => new THREE.Color(c));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const groove = Math.exp(-Math.pow(Math.sin(ang * 0.5), 2) * 60);
    const r = Math.sqrt(x * x + z * z);
    if (r > 0.02) {
      const k = 1 - groove * 0.06;
      pos.setX(i, x * k);
      pos.setZ(i, z * k);
    }
    const side = 0.5 + 0.5 * Math.cos(ang - 1.2);
    const top = THREE.MathUtils.clamp((y / s + 0.05) / 0.1, 0, 1);
    c.copy(base).lerp(blush, side * 0.85).lerp(deep, Math.pow(side, 3) * top * 0.6);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Stem + two leaves sitting on top of a peach. */
export function buildPeachLeafGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.05, 0.05, 0, 0.16);
  shape.quadraticCurveTo(-0.05, 0.05, 0, 0);
  const a = new THREE.ShapeGeometry(shape, 4);
  a.rotateX(-1.1);
  a.rotateY(0.4);
  a.translate(0, 0.07, 0);
  const b = a.clone().rotateY(Math.PI * 0.9);
  const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.32, 4);
  stem.translate(0, 0.2, 0);
  stem.deleteAttribute('uv');
  a.deleteAttribute('uv');
  b.deleteAttribute('uv');
  return mergeGeometries([a, b, stem.toNonIndexed()].map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Clump of curved grass blades with vertex-colour gradient. */
export function buildGrassClump(rng: () => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const base = new THREE.Color('#14240f');
  const tip = new THREE.Color('#4d6b31');
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2;
    const h = 0.25 + rng() * 0.35;
    const w = 0.035;
    const ox = (rng() - 0.5) * 0.25;
    const oz = (rng() - 0.5) * 0.25;
    const bend = 0.12 + rng() * 0.15;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz * w;
    const pz = dx * w;
    // two-segment blade
    const p = [
      [ox - px, 0, oz - pz],
      [ox + px, 0, oz + pz],
      [ox + dx * bend * 0.4 - px * 0.6, h * 0.55, oz + dz * bend * 0.4 - pz * 0.6],
      [ox + dx * bend * 0.4 + px * 0.6, h * 0.55, oz + dz * bend * 0.4 + pz * 0.6],
      [ox + dx * bend, h, oz + dz * bend],
    ];
    const tris = [
      [0, 1, 2],
      [1, 3, 2],
      [2, 3, 4],
    ];
    for (const tri of tris) {
      for (const k of tri) {
        positions.push(p[k][0], p[k][1], p[k][2]);
        const c = base.clone().lerp(tip, p[k][1] / h);
        colors.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRockGeometry(rng: () => number): THREE.BufferGeometry {
  const g = lumpyBlob(0.5, 1, 0.6, null, rng);
  g.scale(1, 0.55, 0.8);
  g.translate(0, 0.12, 0);
  return g;
}

/** Stone lantern (石灯笼): returns stone body and glowing firebox geometries. */
export function buildStoneLantern(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.32, 0.4, 0.2, 6);
  base.translate(0, 0.1, 0);
  const post = new THREE.CylinderGeometry(0.11, 0.14, 0.75, 6);
  post.translate(0, 0.57, 0);
  const plate = new THREE.CylinderGeometry(0.3, 0.26, 0.1, 6);
  plate.translate(0, 0.99, 0);
  const pillarA = new THREE.BoxGeometry(0.06, 0.32, 0.06);
  const pillars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    pillars.push(pillarA.clone().translate(Math.cos(a) * 0.19, 1.2, Math.sin(a) * 0.19));
  }
  const roof = new THREE.ConeGeometry(0.45, 0.3, 6);
  roof.translate(0, 1.5, 0);
  const knob = new THREE.SphereGeometry(0.07, 6, 4);
  knob.translate(0, 1.7, 0);
  parts.push(base, post, plate, ...pillars, roof, knob);
  const body = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  const glow = new THREE.BoxGeometry(0.28, 0.26, 0.28);
  glow.translate(0, 1.2, 0);
  return { body, glow };
}

/** Red paper lantern (lathe). */
export function buildPaperLantern(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const r = 0.04 + Math.sin(t * Math.PI) * 0.19;
    pts.push(new THREE.Vector2(r, t * 0.42 - 0.21));
  }
  return new THREE.LatheGeometry(pts, 14);
}

/** Paifang memorial archway with sweeping roof, plaque and paper lanterns. */
export function buildPaifang(
  mats: MaterialLibrary,
  opts: { width: number; height: number; text: string; lanterns: boolean },
): { root: THREE.Group; lanterns: THREE.Mesh[]; pillarOffsets: number[] } {
  const root = new THREE.Group();
  const { width: w, height: h } = opts;
  const pillarOffsets = [-w / 2, w / 2];
  for (const x of pillarOffsets) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, h, 10), mats.lacquer);
    pillar.position.set(x, h / 2, 0);
    pillar.castShadow = true;
    root.add(pillar);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), mats.stone);
    base.position.set(x, 0.25, 0);
    root.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 10), mats.gold);
    cap.position.set(x, 0.56, 0);
    root.add(cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.26, 0.3), mats.lacquer);
  beam.position.y = h - 0.25;
  root.add(beam);
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.18, 0.26), mats.lacquer);
  beam2.position.y = h - 1.05;
  root.add(beam2);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.95, 0.05, 0.34), mats.gold);
  trim.position.y = h - 0.1;
  root.add(trim);

  // sweeping roof: extruded profile with upturned eaves
  const roofShape = new THREE.Shape();
  const rw = w / 2 + 1.0;
  roofShape.moveTo(-rw - 0.25, 0.35);
  roofShape.quadraticCurveTo(-rw + 0.4, -0.05, -rw + 1.0, 0.12);
  roofShape.lineTo(-0.6, 0.55);
  roofShape.lineTo(0.6, 0.55);
  roofShape.lineTo(rw - 1.0, 0.12);
  roofShape.quadraticCurveTo(rw - 0.4, -0.05, rw + 0.25, 0.35);
  roofShape.lineTo(rw - 0.2, 0.0);
  roofShape.lineTo(-rw + 0.2, 0.0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1.0, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  roofGeo.translate(0, 0, -0.5);
  const roof = new THREE.Mesh(roofGeo, mats.roofTile);
  roof.position.y = h;
  roof.castShadow = true;
  root.add(roof);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.16), mats.gold);
  ridge.position.y = h + 0.62;
  root.add(ridge);

  // plaque
  const plaqueMat = new THREE.MeshStandardMaterial({ map: plaqueTexture(opts.text), roughness: 0.5, emissive: '#3a2a10', emissiveIntensity: 0.4 });
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.56, 0.08), [mats.darkWood, mats.darkWood, mats.darkWood, mats.darkWood, plaqueMat, plaqueMat]);
  plaque.position.set(0, h - 0.65, 0.18);
  root.add(plaque);

  const lanterns: THREE.Mesh[] = [];
  if (opts.lanterns) {
    const lg = buildPaperLantern();
    for (const x of [-w / 2 + 0.55, w / 2 - 0.55]) {
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 3), mats.darkWood);
      string.position.set(x, h - 1.4, 0.05);
      root.add(string);
      const lantern = new THREE.Mesh(lg, mats.lanternDark);
      lantern.position.set(x, h - 1.85, 0.05);
      root.add(lantern);
      const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 5), mats.gold);
      tassel.position.set(x, h - 2.16, 0.05);
      tassel.rotation.x = Math.PI;
      root.add(tassel);
      lanterns.push(lantern);
    }
  }
  return { root, lanterns, pillarOffsets };
}
