import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 仙衣妖面 kit — the three sisters keep their immortal-fairy attire (gauze, feather shawl,
 * gold-thread robes) but wear evil-ghost / oni faces: ashen skin, ink sockets, fierce brows,
 * cracks, fangs and RED glowing slit eyes (HDR red so the bloom pass catches them).
 *
 * Everything is procedural: a canvas "makeup" decal wrapped on a front-cap sphere plus a few
 * primitives placed through the same (u, v) mapping, so painted sockets and 3D eyes line up.
 */

export type FaceKind = 'zimo' | 'qing' | 'jin';

// Front cap used by the face decal (SphereGeometry phi/theta window, +Z is the face).
const PHI_L = Math.PI * 0.95;
const PHI0 = Math.PI / 2 - PHI_L / 2;
const TH0 = Math.PI * 0.12;
const TH_L = Math.PI * 0.72;

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.5, ...p });
const gauze = (color: number, emissive: number, opacity: number) =>
  std({ color, emissive, emissiveIntensity: 0.3, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, roughness: 0.45 });

/** Crimson-ink silk with gold-thread cloud scrolls (祥云) and border bands, tiled around lathes. */
function goldThreadTexture(): THREE.Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (g) {
    const bg = g.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, '#5a1830');
    bg.addColorStop(1, '#3a0e22');
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#e6b850';
    g.lineCap = 'round';
    // border bands
    g.lineWidth = 6;
    for (const y of [10, S - 10]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
    }
    g.lineWidth = 2;
    for (const y of [22, S - 22]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
    }
    // cloud scrolls
    g.lineWidth = 3;
    const cloud = (x: number, y: number, r: number) => {
      g.beginPath();
      g.arc(x, y, r, Math.PI * 0.2, Math.PI * 1.9);
      g.arc(x + r * 1.1, y + r * 0.2, r * 0.55, Math.PI, Math.PI * 2.6);
      g.moveTo(x - r, y + r * 0.4);
      g.quadraticCurveTo(x - r * 2, y + r * 1.2, x - r * 2.6, y + r * 0.6);
      g.stroke();
    };
    cloud(70, 80, 18);
    cloud(190, 150, 16);
    cloud(90, 200, 12);
    cloud(210, 60, 10);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  tex.anisotropy = 4;
  return tex;
}

function makeKit() {
  return {
    // eyes: HDR red (> bloom threshold), never fogged out — the read at distance is "two red eyes"
    oniEye: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.35, 0.18), fog: false }),
    oniEyeCore: new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 2.2, 0.8), fog: false }),
    eyeBlack: new THREE.MeshBasicMaterial({ color: 0x050003 }),
    fang: std({ color: 0xf4ecdc, roughness: 0.3 }),
    horn: std({ color: 0x241018, roughness: 0.35, emissive: 0x5a0812, emissiveIntensity: 0.35 }),
    hair: std({ color: 0x0c0912, roughness: 0.32, metalness: 0.15 }),
    lips: std({ color: 0x5a0614, roughness: 0.35, emissive: 0x3a0008, emissiveIntensity: 0.5 }),
    // 紫陌: lotus-pink silk + sheer gauze
    lotusSilk: std({ color: 0xe77aa6, roughness: 0.42, emissive: 0x3a0a20, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
    lotusPetal: std({ color: 0xffb2cf, roughness: 0.5, emissive: 0x6a1c3e, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
    lotusGauze: gauze(0xffa6c9, 0x6a1c3e, 0.34),
    // 青鸾: pine-smoke teal gauze
    tealGauze: gauze(0x7fd8cc, 0x0c3a36, 0.3),
    tealSash: std({ color: 0x173c3c, roughness: 0.6 }),
    jade: std({ color: 0x8ff0d0, emissive: 0x1a7a60, emissiveIntensity: 0.8, roughness: 0.2 }),
    // 金阙: gold-thread crimson-ink court robe
    jinRobe: std({ map: goldThreadTexture(), roughness: 0.55, metalness: 0.25, emissive: 0x16040a, emissiveIntensity: 0.4, side: THREE.DoubleSide }),
    jinGold: std({ color: 0xe0b450, metalness: 0.9, roughness: 0.28, emissive: 0x5a3c0c, emissiveIntensity: 0.55 }),
    // ghost skins (faint emissive so the face reads in moonlight with the lantern off)
    skin: {
      zimo: std({ color: 0xe2d2ec, roughness: 0.55, emissive: 0x2c1838, emissiveIntensity: 0.45 }),
      qing: std({ color: 0xdfe9ec, roughness: 0.5, emissive: 0x16303a, emissiveIntensity: 0.45 }),
      jin: std({ color: 0xd8cfc2, roughness: 0.5, emissive: 0x2a2014, emissiveIntensity: 0.4 }),
    } as Record<FaceKind, THREE.MeshStandardMaterial>,
    decal: {} as Partial<Record<FaceKind, THREE.MeshStandardMaterial>>,
  };
}

let kitCache: ReturnType<typeof makeKit> | null = null;
export function fairyKit(): ReturnType<typeof makeKit> {
  return (kitCache ??= makeKit());
}

/** Per-face layout in decal (u, v) space: u 0..1 left→right as seen from the front, v 0..1 top→chin. */
export interface FaceLayout {
  eyeU: number; // left eye u (right eye mirrored)
  eyeV: number;
  mouthV: number;
  mouthW: number;
}

export const FACE_LAYOUT: Record<FaceKind, FaceLayout> = {
  zimo: { eyeU: 0.4, eyeV: 0.5, mouthV: 0.74, mouthW: 0.2 },
  qing: { eyeU: 0.37, eyeV: 0.42, mouthV: 0.68, mouthW: 0.14 },
  jin: { eyeU: 0.405, eyeV: 0.47, mouthV: 0.74, mouthW: 0.11 },
};

function faceCanvas(kind: FaceKind): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (!g) return c;
  const L = FACE_LAYOUT[kind];
  const ex = [L.eyeU * S, (1 - L.eyeU) * S];
  const ey = L.eyeV * S;
  const my = L.mouthV * S;
  const mw = L.mouthW * S;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // ink sockets: ghost hollows around both eyes
  for (const x of ex) {
    const r = g.createRadialGradient(x, ey, 2, x, ey, 30);
    r.addColorStop(0, 'rgba(18,0,14,0.95)');
    r.addColorStop(0.55, 'rgba(40,4,30,0.6)');
    r.addColorStop(1, 'rgba(40,4,30,0)');
    g.fillStyle = r;
    g.beginPath();
    g.ellipse(x, ey + 2, 30, 22, 0, 0, Math.PI * 2);
    g.fill();
  }
  // red winged liner sweeping up and out (fairy makeup turned demon)
  g.strokeStyle = kind === 'qing' ? 'rgba(160,10,40,0.95)' : 'rgba(200,14,36,0.95)';
  g.lineWidth = 3.5;
  for (const [i, x] of ex.entries()) {
    const s = i === 0 ? -1 : 1;
    g.beginPath();
    g.moveTo(x - s * 14, ey + 3);
    g.quadraticCurveTo(x + s * 10, ey + 6, x + s * 30, ey - 14);
    g.stroke();
  }
  // fierce oni brows: thick, low at the nose, slashing up to the temples
  g.strokeStyle = 'rgba(8,2,8,0.95)';
  g.lineWidth = kind === 'jin' ? 6 : 7;
  for (const [i, x] of ex.entries()) {
    const s = i === 0 ? -1 : 1;
    g.beginPath();
    g.moveTo(S / 2 + s * 10, ey - 14);
    g.quadraticCurveTo(x, ey - 22, x + s * 32, ey - 44);
    g.stroke();
  }
  // ghost cracks + black tear streaks
  g.strokeStyle = 'rgba(110,8,22,0.9)';
  g.lineWidth = 1.6;
  const crack = (x: number, y: number, dx: number, dy: number, n: number) => {
    g.beginPath();
    g.moveTo(x, y);
    let px = x;
    let py = y;
    for (let i = 0; i < n; i++) {
      px += dx + Math.sin(i * 7.1 + x) * 5;
      py += dy + Math.cos(i * 3.7 + y) * 3;
      g.lineTo(px, py);
    }
    g.stroke();
  };
  g.strokeStyle = 'rgba(10,0,8,0.7)';
  g.lineWidth = 2.4;
  for (const x of ex) crack(x - 3, ey + 14, 0.5, 10, 5);
  g.strokeStyle = 'rgba(120,10,26,0.9)';
  g.lineWidth = 1.5;
  crack(ex[0] - 16, ey + 10, -5, 8, 5);
  crack(ex[1] + 18, ey - 30, 6, -6, 4);

  // mouth
  if (kind === 'zimo') {
    // split jaw: a sweet peach-pink smile torn into a gash toward the ears, stitched with teeth
    g.fillStyle = 'rgba(20,0,8,0.95)';
    g.beginPath();
    g.moveTo(S / 2 - mw, my - 14);
    g.quadraticCurveTo(S / 2, my + 16, S / 2 + mw, my - 14);
    g.quadraticCurveTo(S / 2, my + 4, S / 2 - mw, my - 14);
    g.fill();
    g.strokeStyle = 'rgba(232,90,140,0.95)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S / 2 - 18, my - 2);
    g.quadraticCurveTo(S / 2, my + 8, S / 2 + 18, my - 2);
    g.stroke();
    g.strokeStyle = 'rgba(240,230,215,0.95)';
    g.lineWidth = 1.6;
    for (let i = -5; i <= 5; i++) {
      const x = S / 2 + i * (mw / 6);
      const yy = my - 8 + Math.abs(i) * -1.2 + 8 * (1 - (i * i) / 30);
      g.beginPath();
      g.moveTo(x, yy - 3);
      g.lineTo(x, yy + 3);
      g.stroke();
    }
  } else if (kind === 'qing') {
    // crooked, teasing cruel smile in dark lip-stain, one corner hooked high
    g.strokeStyle = 'rgba(70,4,20,0.95)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(S / 2 - mw, my - 4);
    g.quadraticCurveTo(S / 2 - 4, my + 12, S / 2 + mw, my - 16);
    g.stroke();
    // teal feather 花钿 at the temples
    g.strokeStyle = 'rgba(40,190,170,0.9)';
    g.lineWidth = 2;
    for (const [i, x] of ex.entries()) {
      const s = i === 0 ? -1 : 1;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(x + s * 28, ey + 4);
        g.lineTo(x + s * (44 + k * 4), ey - 10 + k * 10);
        g.stroke();
      }
    }
  } else {
    // cold, thin vermilion line
    g.strokeStyle = 'rgba(150,10,20,0.95)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S / 2 - mw, my - 2);
    g.lineTo(S / 2 + mw, my + 1);
    g.stroke();
    // gold sigils crawling over the right half-face
    g.strokeStyle = 'rgba(255,200,70,1)';
    g.lineWidth = 2.6;
    const x0 = S / 2 + 6;
    g.beginPath();
    g.arc(ex[1], ey, 24, -Math.PI * 0.9, Math.PI * 0.6);
    g.stroke();
    g.beginPath();
    g.moveTo(x0, ey - 60);
    g.lineTo(x0 + 18, ey - 34);
    g.lineTo(x0 + 52, ey - 40);
    g.lineTo(x0 + 80, ey - 18);
    g.moveTo(x0 + 18, ey - 34);
    g.lineTo(x0 + 10, ey + 26);
    g.lineTo(x0 + 40, ey + 50);
    g.lineTo(x0 + 78, ey + 44);
    g.moveTo(x0 + 40, ey + 50);
    g.lineTo(x0 + 34, ey + 86);
    g.stroke();
    for (const [dx, dy] of [
      [60, 30],
      [24, 70],
      [70, -50],
    ]) {
      g.beginPath();
      g.arc(x0 + dx, ey + dy, 5, 0, Math.PI * 2);
      g.stroke();
    }
    // vermilion third-eye mark (the 3D eye sits on top of it)
    g.fillStyle = 'rgba(200,20,20,0.9)';
    g.beginPath();
    g.ellipse(S / 2, ey - 48, 7, 16, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function decalMaterial(kind: FaceKind): THREE.MeshStandardMaterial {
  const kit = fairyKit();
  const cached = kit.decal[kind];
  if (cached) return cached;
  const tex = new THREE.CanvasTexture(faceCanvas(kind));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: kind === 'jin' ? 0xffd080 : 0xff8080,
    emissiveIntensity: kind === 'jin' ? 0.7 : 0.25,
    transparent: true,
    depthWrite: false,
    roughness: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  kit.decal[kind] = mat;
  return mat;
}

const Z = new THREE.Vector3(0, 0, 1);

/** A ghost/oni face on an ellipsoid head: skin, makeup decal, red slit eyes, fangs. */
export class FaceRig {
  readonly eyes: THREE.Object3D[] = [];
  constructor(
    readonly parent: THREE.Object3D,
    readonly kind: FaceKind,
    readonly r: number,
    readonly center: THREE.Vector3,
    readonly scale: THREE.Vector3,
  ) {}

  /** Surface point (lift = radial multiplier) at decal coords. */
  at(u: number, v: number, lift = 1, out = new THREE.Vector3()): THREE.Vector3 {
    const phi = PHI0 + u * PHI_L;
    const th = TH0 + v * TH_L;
    return out
      .set(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th))
      .multiplyScalar(this.r * lift)
      .multiply(this.scale)
      .add(this.center);
  }

  /** Outward normal of the ellipsoid at decal coords. */
  normal(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.at(u, v, 1, out).sub(this.center);
    return p.set(p.x / (this.scale.x * this.scale.x), p.y / (this.scale.y * this.scale.y), p.z / (this.scale.z * this.scale.z)).normalize();
  }

  /** Orient `o` so its +Z follows the surface normal at (u, v). */
  place(o: THREE.Object3D, u: number, v: number, lift = 1): THREE.Object3D {
    this.at(u, v, lift, o.position);
    o.quaternion.setFromUnitVectors(Z, this.normal(u, v));
    this.parent.add(o);
    return o;
  }

  /** Base skin (optional — pass false when the head already has one) + makeup decal. */
  skin(withBase: boolean): this {
    const kit = fairyKit();
    if (withBase) {
      const base = new THREE.Mesh(new THREE.SphereGeometry(this.r, 20, 16), kit.skin[this.kind]);
      base.position.copy(this.center);
      base.scale.copy(this.scale);
      base.castShadow = true;
      this.parent.add(base);
    }
    const decal = new THREE.Mesh(new THREE.SphereGeometry(this.r * 1.012, 24, 18, PHI0, PHI_L, TH0, TH_L), decalMaterial(this.kind));
    decal.position.copy(this.center);
    decal.scale.copy(this.scale);
    decal.renderOrder = 2;
    this.parent.add(decal);
    return this;
  }

  /** Red glowing slit-pupil eyes in black almond sclera, slanted up at the outer corners. */
  addEyes(size: number, slant = 0.35): this {
    const kit = fairyKit();
    const L = FACE_LAYOUT[this.kind];
    for (const [i, u] of [L.eyeU, 1 - L.eyeU].entries()) {
      const s = i === 0 ? 1 : -1; // outer corner up on both sides
      const g = new THREE.Group();
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), kit.eyeBlack);
      sclera.scale.set(1.55, 0.8, 0.4);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(size * 0.62, 12, 8), kit.oniEye);
      iris.scale.set(1, 1.05, 0.45);
      iris.position.z = size * 0.22;
      const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.24, 8, 6), kit.oniEyeCore);
      core.position.set(size * 0.18, size * 0.18, size * 0.36);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(size * 0.16, size * 1.05, size * 0.05), kit.eyeBlack);
      slit.position.z = size * 0.42;
      g.add(sclera, iris, slit, core);
      this.place(g, u, L.eyeV, 0.99);
      g.rotateZ(-s * slant);
      this.eyes.push(g);
    }
    return this;
  }

  /** Extra eye on the brow (金阙's third eye). */
  addThirdEye(size: number): this {
    const kit = fairyKit();
    const L = FACE_LAYOUT[this.kind];
    const g = new THREE.Group();
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), kit.eyeBlack);
    sclera.scale.set(0.6, 1.4, 0.35);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(size * 0.55, 10, 8), kit.oniEye);
    iris.scale.set(0.8, 1.6, 0.4);
    iris.position.z = size * 0.2;
    const slit = new THREE.Mesh(new THREE.BoxGeometry(size * 0.6, size * 0.12, size * 0.05), kit.eyeBlack);
    slit.position.z = size * 0.36;
    g.add(sclera, iris, slit);
    this.place(g, 0.5, L.eyeV - 0.19, 1.0);
    this.eyes.push(g);
    return this;
  }

  /** Upper fangs hanging over the lip line. */
  addFangs(len: number, spread: number, count = 2): this {
    const kit = fairyKit();
    const L = FACE_LAYOUT[this.kind];
    const geos: THREE.BufferGeometry[] = [];
    const tmp = new THREE.Object3D();
    for (let k = 0; k < count; k++) {
      const f = count === 1 ? 0 : k / (count - 1) - 0.5;
      const u = 0.5 + f * spread;
      const big = Math.abs(f) > 0.3 || count <= 2;
      const h = big ? len : len * 0.55;
      const cone = new THREE.ConeGeometry(h * 0.2, h, 5);
      cone.rotateX(Math.PI); // point down
      cone.translate(0, -h * 0.35, 0);
      this.at(u, L.mouthV - 0.02, 0.985, tmp.position);
      tmp.rotation.set(0, 0, f * 0.4); // fangs hang straight down, splaying slightly
      tmp.updateMatrix();
      cone.applyMatrix4(tmp.matrix);
      geos.push(cone);
    }
    const merged = mergeGeometries(geos);
    if (merged) this.parent.add(new THREE.Mesh(merged, kit.fang));
    return this;
  }

  /** Small curved oni horns at the hairline. */
  addHorns(len: number, u = 0.3, v = 0.08, splay = 0.5): this {
    const kit = fairyKit();
    for (const side of [-1, 1]) {
      const uu = side < 0 ? u : 1 - u;
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.ConeGeometry(len * 0.18, len * 0.6, 6), kit.horn);
      a.position.y = len * 0.3;
      const b = new THREE.Mesh(new THREE.ConeGeometry(len * 0.11, len * 0.5, 6), kit.horn);
      b.position.set(-side * len * 0.08, len * 0.78, -len * 0.06);
      b.rotation.z = side * 0.45;
      g.add(a, b);
      this.at(uu, v, 0.92, g.position);
      g.rotation.set(-0.35, 0, -side * splay);
      this.parent.add(g);
    }
    return this;
  }
}

/** Lathe skirt that flares from `r0` at y=0 to `r1` at y=-len, with a wavy, ragged hem. */
export function skirtGeometry(r0: number, r1: number, len: number, waves = 7, amp = 0.06, belly = 0.12, segs = 28): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const rows = 8;
  for (let i = 0; i <= rows; i++) {
    const f = i / rows;
    const r = r0 + (r1 - r0) * Math.pow(f, 1.35) + Math.sin(f * Math.PI) * belly * r1;
    pts.push(new THREE.Vector2(Math.max(0.01, r), -f * len));
  }
  pts.reverse();
  const geo = new THREE.LatheGeometry(pts, segs);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = -y / len;
    if (f < 0.35) continue;
    const a = Math.atan2(pos.getX(i), pos.getZ(i));
    const w = (f - 0.35) / 0.65;
    pos.setY(i, y + Math.sin(a * waves) * amp * w + Math.sin(a * waves * 2.3 + 1.1) * amp * 0.4 * w);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Petal (flattened, pointed sphere) used for lotus overskirts and feather crests. */
export function petalGeometry(w: number, h: number, depth = 0.25): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 10, 8);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const taper = y < 0 ? 1 - Math.pow(-y * 2, 1.6) * 0.85 : 1;
    pos.setX(i, pos.getX(i) * taper);
    pos.setZ(i, pos.getZ(i) * taper);
  }
  g.scale(w, h, w * depth);
  g.computeVertexNormals();
  return g;
}

/** Merge several transformed copies of geometries into one mesh (fewer draw calls). */
export function mergedMesh(parts: Array<{ geo: THREE.BufferGeometry; m: THREE.Matrix4 }>, mat: THREE.Material): THREE.Mesh | null {
  const geos = parts.map(({ geo, m }) => {
    const g = geo.clone();
    g.applyMatrix4(m);
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  return mesh;
}

/** Matrix from position / euler / uniform-or-vector scale. */
export function trs(px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, s: number | THREE.Vector3 = 1): THREE.Matrix4 {
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s;
  return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), sc);
}
