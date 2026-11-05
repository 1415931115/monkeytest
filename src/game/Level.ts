import * as THREE from 'three';
import { MaterialLibrary } from '../assets/MaterialLibrary';
import {
  buildGrassClump,
  buildPaifang,
  buildRockGeometry,
  buildStoneLantern,
  buildTreeTemplate,
  type TreeTemplate,
} from '../assets/WorldKit';
import { createSeededRandom } from '../utils/random';
import { ColliderGrid, PATH_LENGTH, ZONE_GLYPHS, ZONE_STARTS, pathSlope, pathX, zoneAt } from './LevelPath';

export interface PeachSpot {
  position: THREE.Vector3;
  zone: number;
  /** Guaranteed ancient peach (altar). */
  special?: number;
}

export interface ShrineSite {
  index: number;
  t: number;
  position: THREE.Vector3;
  rotationY: number;
  lanterns: THREE.Mesh[];
  column: THREE.Mesh;
  ring: THREE.Mesh;
  active: boolean;
}

const CHUNK = 50;

export function pathPoint(t: number, lateral: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = pathSlope(t);
  const k = 1 / Math.sqrt(1 + s * s);
  // normal to the tangent (s, -1) in xz is (1, s) normalised
  out.set(pathX(t) + lateral * k, 0, -t + lateral * s * k);
  return out;
}

export function pathYaw(t: number): number {
  return Math.atan2(pathSlope(t), -1);
}

export class Level {
  readonly root = new THREE.Group();
  readonly colliders = new ColliderGrid();
  readonly peachSpots: PeachSpot[] = [];
  readonly shrines: ShrineSite[] = [];
  readonly fireflies: THREE.Points;
  private readonly fireflyMat: THREE.ShaderMaterial;
  private readonly skyMat: THREE.ShaderMaterial;
  readonly sky: THREE.Mesh;
  private readonly columnMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  /** Two shared lights that move to whichever shrines are lit this run. */
  readonly shrineLights = [new THREE.PointLight('#ff8a4a', 0, 18, 1.5), new THREE.PointLight('#ff8a4a', 0, 18, 1.5)];

  constructor(private readonly mats: MaterialLibrary) {
    const rng = createSeededRandom(2024);
    this.buildGround();
    const templates = [101, 202, 303, 404, 505].map((s) => buildTreeTemplate(s));
    for (const t of templates) this.disposables.push(t.trunk, t.canopy);
    this.columnMat = this.makeColumnMaterial();
    this.buildLandmarks();
    this.buildTrees(templates, rng);
    this.buildScatter(rng);
    this.sky = this.buildSky();
    this.skyMat = this.sky.material as THREE.ShaderMaterial;
    const ff = this.buildFireflies(rng);
    this.fireflies = ff.points;
    this.fireflyMat = ff.mat;
    this.root.add(this.fireflies);
    for (const l of this.shrineLights) this.root.add(l);
  }

  update(elapsed: number, cameraPos: THREE.Vector3, hunt01: number): void {
    this.fireflyMat.uniforms.uTime.value = elapsed;
    this.columnMat.uniforms.uTime.value = elapsed;
    this.sky.position.copy(cameraPos);
    this.skyMat.uniforms.uHunt.value = hunt01;
    this.shrineLights.forEach((l, i) => {
      l.intensity = 14 + Math.sin(elapsed * 7.3 + i) * 1.6 + Math.sin(elapsed * 13.1 + i * 2) * 0.8;
    });
    for (const s of this.shrines) {
      if (!s.active) continue;
      const pulse = 1 + Math.sin(elapsed * 2 + s.index) * 0.05;
      s.ring.scale.set(pulse, pulse, 1);
    }
  }

  setActiveShrines(indices: number[]): void {
    for (const s of this.shrines) {
      s.active = indices.includes(s.index);
      for (const l of s.lanterns) l.material = s.active ? this.mats.lanternLit : this.mats.lanternDark;
      s.column.visible = s.active;
      s.ring.visible = s.active;
    }
    const active = this.shrines.filter((s) => s.active);
    this.shrineLights.forEach((l, i) => {
      const s = active[i];
      if (s) l.position.set(s.position.x, 2.2, s.position.z);
      else l.position.set(0, -50, 0);
    });
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.InstancedMesh) o.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.fireflyMat.dispose();
    this.skyMat.dispose();
    this.columnMat.dispose();
  }

  // ---------------------------------------------------------------- ground
  private buildGround(): void {
    const len = PATH_LENGTH + 120;
    const geo = new THREE.PlaneGeometry(200, len, 60, 120);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -len / 2 + 50);
    // gentle undulation outside the corridor, flat inside (collision is flat)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const lat = Math.abs(x - pathX(-z));
      const edge = THREE.MathUtils.smoothstep(lat, 12, 24);
      const h = (Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.9 + Math.sin(x * 0.07 + z * 0.05) * 1.6) * edge;
      pos.setY(i, h + edge * 0.6);
      uv.setXY(i, x / 7, z / 7);
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, this.mats.ground);
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.root.add(ground);

    // trail ribbon
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const tmp = new THREE.Vector3();
    let row = 0;
    for (let t = -12; t <= PATH_LENGTH + 12; t += 1) {
      const w = 1.9 + Math.sin(t * 0.13) * 0.35 + Math.sin(t * 0.41) * 0.2;
      for (const side of [-1, 1]) {
        pathPoint(t, side * w, tmp);
        positions.push(tmp.x, 0.012, tmp.z);
        uvs.push(side < 0 ? 0 : 1, t / 4);
      }
      if (row > 0) {
        const a = (row - 1) * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      row++;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    pg.setIndex(indices);
    pg.computeVertexNormals();
    const trail = new THREE.Mesh(pg, this.mats.path);
    trail.receiveShadow = true;
    trail.name = 'trail';
    this.root.add(trail);
  }

  // ---------------------------------------------------------------- landmarks
  private buildLandmarks(): void {
    // Zone gates
    const gateTexts = ['蟠桃园', ZONE_GLYPHS[1], ZONE_GLYPHS[2]];
    ZONE_STARTS.forEach((t0, i) => {
      const t = t0 + (i === 0 ? 4 : 0);
      const gate = buildPaifang(this.mats, { width: 5.4, height: 4.6, text: gateTexts[i], lanterns: true });
      const p = pathPoint(t, 0);
      gate.root.position.copy(p);
      gate.root.rotation.y = pathYaw(t);
      for (const l of gate.lanterns) l.material = this.mats.lanternLit;
      this.root.add(gate.root);
      gate.root.updateMatrixWorld(true);
      for (const x of gate.pillarOffsets) {
        const w = new THREE.Vector3(x, 0, 0).applyMatrix4(gate.root.matrixWorld);
        this.colliders.add({ x: w.x, z: w.z, r: 0.42 });
      }
    });

    // Extraction shrine candidates (2 per zone)
    const sites = [
      { t: 62, side: 1 },
      { t: 108, side: -1 },
      { t: 168, side: -1 },
      { t: 228, side: 1 },
      { t: 298, side: 1 },
      { t: 352, side: -1 },
    ];
    const ringGeo = new THREE.RingGeometry(2.1, 2.5, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffb36a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const colGeo = new THREE.CylinderGeometry(2.0, 2.3, 26, 24, 1, true);
    colGeo.translate(0, 13, 0);
    this.disposables.push(ringMat);
    sites.forEach((s, index) => {
      const pos = pathPoint(s.t, s.side * 6.2);
      const yaw = pathYaw(s.t) + (s.side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const gate = buildPaifang(this.mats, { width: 2.8, height: 3.4, text: '归途', lanterns: true });
      gate.root.position.copy(pos);
      gate.root.rotation.y = yaw;
      this.root.add(gate.root);
      gate.root.updateMatrixWorld(true);
      for (const x of gate.pillarOffsets) {
        const w = new THREE.Vector3(x, 0, 0).applyMatrix4(gate.root.matrixWorld);
        this.colliders.add({ x: w.x, z: w.z, r: 0.42 });
      }
      // stone platform
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.0, 0.14, 24), this.mats.stone);
      plat.position.set(pos.x, 0.07, pos.z);
      plat.receiveShadow = true;
      this.root.add(plat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(pos.x, 0.16, pos.z);
      this.root.add(ring);
      const column = new THREE.Mesh(colGeo, this.columnMat);
      column.position.set(pos.x, 0.1, pos.z);
      this.root.add(column);
      this.shrines.push({ index, t: s.t, position: pos.clone(), rotationY: yaw, lanterns: gate.lanterns, column, ring, active: false });
    });

    // Altar of the ten-thousand-year peach at the end of the trail
    const altarT = PATH_LENGTH - 6;
    const ap = pathPoint(altarT, 0);
    const altar = new THREE.Group();
    const step1 = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.3, 8), this.mats.stone);
    step1.position.y = 0.15;
    const step2 = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.3, 8), this.mats.stone);
    step2.position.y = 0.45;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.7, 8), this.mats.stone);
    pillar.position.y = 0.95;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.18, 12), this.mats.gold);
    bowl.position.y = 1.38;
    for (const m of [step1, step2, pillar, bowl]) {
      m.castShadow = true;
      m.receiveShadow = true;
      altar.add(m);
    }
    altar.position.copy(ap);
    this.root.add(altar);
    this.colliders.add({ x: ap.x, z: ap.z, r: 1.0 });
    this.peachSpots.push({ position: new THREE.Vector3(ap.x, 1.62, ap.z), zone: 2, special: 3 });
  }

  // ---------------------------------------------------------------- trees
  private buildTrees(templates: TreeTemplate[], rng: () => number): void {
    type Placement = { tpl: number; x: number; z: number; s: number; ry: number; chunk: number; peach: boolean };
    const placements: Placement[] = [];
    const occupied: { x: number; z: number; r: number }[] = [];
    const tmp = new THREE.Vector3();
    const blocked = (x: number, z: number, r: number) => {
      for (const o of occupied) {
        const dx = o.x - x;
        const dz = o.z - z;
        if (dx * dx + dz * dz < (o.r + r) * (o.r + r)) return true;
      }
      return false;
    };
    for (const s of this.shrines) occupied.push({ x: s.position.x, z: s.position.z, r: 4.2 });
    for (const t0 of ZONE_STARTS) {
      const p = pathPoint(t0 + (t0 === 0 ? 4 : 0), 0);
      occupied.push({ x: p.x, z: p.z, r: 4.5 });
    }
    const altar = pathPoint(PATH_LENGTH - 6, 0);
    occupied.push({ x: altar.x, z: altar.z, r: 4 });
    const start = pathPoint(0, 0);
    occupied.push({ x: start.x, z: start.z + 2, r: 5 });

    // Peach-bearing orchard trees inside the corridor
    for (let t = 6; t < PATH_LENGTH - 2; t += 3.2 + rng() * 2.2) {
      for (const side of [-1, 1]) {
        if (rng() < 0.18) continue;
        const lat = side * (3.4 + rng() * 6.2);
        pathPoint(t + (rng() - 0.5) * 2, lat, tmp);
        if (blocked(tmp.x, tmp.z, 2.4)) continue;
        occupied.push({ x: tmp.x, z: tmp.z, r: 2.4 });
        placements.push({ tpl: Math.floor(rng() * templates.length), x: tmp.x, z: tmp.z, s: 0.9 + rng() * 0.25, ry: rng() * Math.PI * 2, chunk: Math.floor(t / CHUNK), peach: true });
      }
    }
    // Dense wall of older, larger trees beyond the corridor
    for (let t = -40; t < PATH_LENGTH + 40; t += 1.6 + rng() * 1.2) {
      for (const side of [-1, 1]) {
        const lat = side * (12 + rng() * 22);
        pathPoint(t, lat, tmp);
        if (blocked(tmp.x, tmp.z, 1.8)) continue;
        occupied.push({ x: tmp.x, z: tmp.z, r: 1.8 });
        placements.push({ tpl: Math.floor(rng() * templates.length), x: tmp.x, z: tmp.z, s: 1.2 + rng() * 0.7, ry: rng() * Math.PI * 2, chunk: Math.floor(Math.max(0, t) / CHUNK), peach: false });
      }
    }
    // Wall behind the start and beyond the altar
    for (const tEnd of [-14, PATH_LENGTH + 14]) {
      for (let lat = -12; lat <= 12; lat += 2.2) {
        for (let row = 0; row < 3; row++) {
          pathPoint(tEnd + (tEnd < 0 ? -row * 2.5 : row * 2.5), lat + (rng() - 0.5) * 1.2, tmp);
          placements.push({ tpl: Math.floor(rng() * templates.length), x: tmp.x, z: tmp.z, s: 1.3 + rng() * 0.5, ry: rng() * Math.PI * 2, chunk: Math.floor(Math.max(0, -tmp.z) / CHUNK), peach: false });
        }
      }
    }

    // Instanced meshes per (chunk, template)
    const groups = new Map<string, Placement[]>();
    for (const p of placements) {
      const key = `${p.chunk}:${p.tpl}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(p);
      const tr = templates[p.tpl].trunkRadius * p.s + 0.12;
      this.colliders.add({ x: p.x, z: p.z, r: tr });
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (const [key, list] of groups) {
      const tpl = templates[Number(key.split(':')[1])];
      const trunk = new THREE.InstancedMesh(tpl.trunk, this.mats.bark, list.length);
      const canopy = new THREE.InstancedMesh(tpl.canopy, this.mats.leaves, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
        sc.setScalar(p.s);
        pos.set(p.x, 0, p.z);
        m.compose(pos, q, sc);
        trunk.setMatrixAt(i, m);
        canopy.setMatrixAt(i, m);
        if (p.peach) {
          for (const a of tpl.anchors) {
            const wp = a.clone().applyMatrix4(m);
            if (wp.y < 1.2 || wp.y > 2.5) continue;
            this.peachSpots.push({ position: wp, zone: zoneAt(-p.z) });
          }
        }
      });
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      canopy.castShadow = false;
      canopy.receiveShadow = true;
      trunk.computeBoundingSphere();
      canopy.computeBoundingSphere();
      this.root.add(trunk, canopy);
    }
  }

  // ---------------------------------------------------------------- scatter
  private buildScatter(rng: () => number): void {
    const tmp = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const chunks = Math.ceil((PATH_LENGTH + 20) / CHUNK);
    const grassGeo = buildGrassClump(createSeededRandom(9));
    const rockGeo = buildRockGeometry(createSeededRandom(19));
    this.disposables.push(grassGeo, rockGeo);
    for (let c = 0; c < chunks; c++) {
      const grassCount = 900;
      const grass = new THREE.InstancedMesh(grassGeo, this.mats.grass, grassCount);
      for (let i = 0; i < grassCount; i++) {
        const t = c * CHUNK + rng() * CHUNK - 5;
        let lat = (rng() - 0.5) * 2 * 16;
        if (Math.abs(lat) < 2.2) lat = Math.sign(lat || 1) * (2.2 + rng() * 2);
        pathPoint(t, lat, tmp);
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        const k = 0.7 + rng() * 0.9;
        s.set(k, k * (0.8 + rng() * 0.6), k);
        m.compose(tmp, q, s);
        grass.setMatrixAt(i, m);
      }
      grass.computeBoundingSphere();
      grass.receiveShadow = true;
      this.root.add(grass);

      const rockCount = 26;
      const rocks = new THREE.InstancedMesh(rockGeo, this.mats.rock, rockCount);
      for (let i = 0; i < rockCount; i++) {
        const t = c * CHUNK + rng() * CHUNK;
        const lat = (rng() < 0.5 ? -1 : 1) * (2.6 + rng() * 12);
        pathPoint(t, lat, tmp);
        tmp.y = -0.05;
        q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * 6, rng() * 0.4));
        const k = 0.4 + rng() * 1.2;
        s.set(k, k * (0.6 + rng() * 0.6), k);
        m.compose(tmp, q, s);
        rocks.setMatrixAt(i, m);
        if (k > 0.9 && Math.abs(lat) < 11) this.colliders.add({ x: tmp.x, z: tmp.z, r: 0.4 * k });
      }
      rocks.computeBoundingSphere();
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      this.root.add(rocks);
    }

    // Stone lanterns lining the trail
    const { body, glow } = buildStoneLantern();
    this.disposables.push(body, glow);
    const lanternSpots: THREE.Vector3[] = [];
    let side = 1;
    for (let t = 14; t < PATH_LENGTH - 10; t += 26 + rng() * 10) {
      const p = pathPoint(t, side * 2.7);
      side = -side;
      if (this.shrines.some((sh) => sh.position.distanceTo(p) < 4)) continue;
      lanternSpots.push(p);
    }
    const bodies = new THREE.InstancedMesh(body, this.mats.stone, lanternSpots.length);
    const lit = lanternSpots.filter(() => rng() < 0.55);
    const glows = new THREE.InstancedMesh(glow, this.mats.stoneLanternGlow, Math.max(1, lit.length));
    lanternSpots.forEach((p, i) => {
      q.setFromAxisAngle(up, rng() * 3);
      s.setScalar(1);
      m.compose(p, q, s);
      bodies.setMatrixAt(i, m);
      this.colliders.add({ x: p.x, z: p.z, r: 0.38 });
    });
    lit.forEach((p, i) => {
      m.compose(p, q.identity(), s.setScalar(1));
      glows.setMatrixAt(i, m);
    });
    glows.count = lit.length;
    bodies.castShadow = true;
    bodies.computeBoundingSphere();
    glows.computeBoundingSphere();
    this.root.add(bodies, glows);

    // Lantern glow cards on the ground
    const cardMat = new THREE.MeshBasicMaterial({ map: this.mats.glow, color: '#ff9a4a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(cardMat);
    const cardGeo = new THREE.PlaneGeometry(4, 4);
    cardGeo.rotateX(-Math.PI / 2);
    const cards = new THREE.InstancedMesh(cardGeo, cardMat, Math.max(1, lit.length));
    lit.forEach((p, i) => {
      m.compose(tmp.set(p.x, 0.03, p.z), q.identity(), s.setScalar(1));
      cards.setMatrixAt(i, m);
    });
    cards.count = lit.length;
    cards.computeBoundingSphere();
    this.root.add(cards);
  }

  // ---------------------------------------------------------------- sky
  private buildSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uHunt: { value: 0 }, uMoonDir: { value: new THREE.Vector3(-0.35, 0.55, -0.75).normalize() } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uHunt;
        uniform vec3 uMoonDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 horizon = vec3(0.035, 0.045, 0.07);
          vec3 zenith = vec3(0.008, 0.012, 0.03);
          vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.6, h));
          // stars
          vec3 cell = floor(d * 180.0);
          float s = hash(cell);
          float star = step(0.9965, s) * smoothstep(0.05, 0.3, h);
          col += vec3(0.8, 0.85, 1.0) * star * (0.4 + 0.6 * hash(cell + 3.1));
          // moon + halo
          float md = dot(d, uMoonDir);
          col += vec3(0.9, 0.92, 1.0) * smoothstep(0.9993, 0.9996, md) * 1.6;
          col += vec3(0.25, 0.3, 0.45) * pow(max(md, 0.0), 60.0) * 0.6;
          // blood tint during the hunt
          col = mix(col, col * vec3(2.4, 0.6, 0.5) + vec3(0.03, 0.0, 0.0) * (1.0 - h), uHunt * 0.85);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 16), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.root.add(sky);
    return sky;
  }

  // ---------------------------------------------------------------- fireflies
  private buildFireflies(rng: () => number): { points: THREE.Points; mat: THREE.ShaderMaterial } {
    const count = 180;
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      pathPoint(rng() * PATH_LENGTH, (rng() - 0.5) * 24, tmp);
      pos[i * 3] = tmp.x;
      pos[i * 3 + 1] = 0.4 + rng() * 3.2;
      pos[i * 3 + 2] = tmp.z;
      phase[i] = rng() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uMap: { value: this.mats.glow } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float t = uTime * 0.35 + aPhase;
          p.x += sin(t * 1.3) * 0.8 + sin(t * 0.37) * 1.4;
          p.y += sin(t * 0.9) * 0.4;
          p.z += cos(t * 1.1) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float blink = smoothstep(0.2, 1.0, sin(uTime * (0.8 + fract(aPhase) * 1.4) + aPhase * 7.0));
          float dist = -mv.z;
          vAlpha = blink * smoothstep(38.0, 10.0, dist);
          gl_PointSize = 70.0 / max(dist, 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r * vAlpha;
          gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a * 1.6, a);
        }`,
    });
    const points = new THREE.Points(g, mat);
    points.frustumCulled = false;
    return { points, mat };
  }

  private makeColumnMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vY;
        void main() {
          vUv = uv;
          vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying float vY;
        void main() {
          float fade = (1.0 - smoothstep(0.0, 26.0, vY)) * smoothstep(0.0, 1.2, vY);
          float streak = 0.55 + 0.45 * sin(vUv.x * 40.0 + uTime * 1.5) * sin(vUv.x * 13.0 - uTime * 0.7);
          float rise = 0.6 + 0.4 * sin(vY * 1.2 - uTime * 3.0);
          float a = fade * streak * rise * 0.22;
          gl_FragColor = vec4(vec3(1.0, 0.62, 0.32) * a, a);
        }`,
    });
  }
}
