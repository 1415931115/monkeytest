/**
 * The orchard trail: a single winding corridor along −Z. The centerline is a
 * graph x = f(t) with z = −t, so projecting a point onto the path is cheap.
 */
export const PATH_LENGTH = 380;
export const CORRIDOR_HALF_WIDTH = 11;
export const ZONE_STARTS = [0, 125, 255] as const;
export const ZONE_NAMES = ['Outer Orchard', 'Mist Grove', 'Heart of the Orchard'] as const;
export const ZONE_GLYPHS = ['外园', '雾林', '园心'] as const;

export function pathX(t: number): number {
  return 12 * Math.sin(t * 0.017) + 5 * Math.sin(t * 0.043 + 1.3) - 5 * Math.sin(1.3);
}

export function pathSlope(t: number): number {
  return 12 * 0.017 * Math.cos(t * 0.017) + 5 * 0.043 * Math.cos(t * 0.043 + 1.3);
}

export function zoneAt(t: number): number {
  if (t >= ZONE_STARTS[2]) return 2;
  if (t >= ZONE_STARTS[1]) return 1;
  return 0;
}

/** Signed horizontal-perpendicular offset of (x,z) from the trail centerline. */
export function lateralOffset(x: number, z: number): number {
  const t = -z;
  const s = pathSlope(t);
  return (x - pathX(t)) / Math.sqrt(1 + s * s);
}

/** Clamp a point into the corridor (and between the start and end walls). */
export function clampToCorridor(p: { x: number; z: number }, margin = 0, extraWidth = 0): void {
  if (p.z > 6) p.z = 6;
  if (p.z < -(PATH_LENGTH + 8)) p.z = -(PATH_LENGTH + 8);
  const t = -p.z;
  const s = pathSlope(t);
  const k = Math.sqrt(1 + s * s);
  const limit = (CORRIDOR_HALF_WIDTH + extraWidth - margin) * k;
  const cx = pathX(t);
  const dx = p.x - cx;
  if (dx > limit) p.x = cx + limit;
  else if (dx < -limit) p.x = cx - limit;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** Tree trunks block harvest line of sight. Rocks and shrines do not. */
  sight?: boolean;
}

/** Uniform grid of static circle colliders (tree trunks, rocks, pillars). */
export class ColliderGrid {
  private readonly cell = 4;
  private readonly cells = new Map<number, Circle[]>();

  private key(ix: number, iz: number): number {
    return (ix + 512) * 4096 + (iz + 2048);
  }

  add(c: Circle): void {
    const ix = Math.floor(c.x / this.cell);
    const iz = Math.floor(c.z / this.cell);
    const k = this.key(ix, iz);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(c);
  }

  clear(): void {
    this.cells.clear();
  }

  /** Push p out of any collider overlapping a circle of radius r. */
  resolve(p: { x: number; z: number }, r: number): boolean {
    const ix = Math.floor(p.x / this.cell);
    const iz = Math.floor(p.z / this.cell);
    let hit = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const c of list) {
          const ex = p.x - c.x;
          const ez = p.z - c.z;
          const min = c.r + r;
          const d2 = ex * ex + ez * ez;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = (min - d) / d;
            p.x += ex * push;
            p.z += ez * push;
            hit = true;
          }
        }
      }
    }
    return hit;
  }

  /** Steering helper: sum of repulsion vectors from nearby colliders. */
  avoid(x: number, z: number, radius: number, out: { x: number; z: number }): void {
    out.x = 0;
    out.z = 0;
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const c of list) {
          const ex = x - c.x;
          const ez = z - c.z;
          const d = Math.sqrt(ex * ex + ez * ez);
          const range = c.r + radius;
          if (d < range && d > 1e-4) {
            const w = (range - d) / range;
            out.x += (ex / d) * w;
            out.z += (ez / d) * w;
          }
        }
      }
    }
  }

  isFree(x: number, z: number, r: number): boolean {
    const p = { x, z };
    return !this.resolve(p, r);
  }

  /**
   * True when a sight-blocking circle (tree trunk) cuts the XZ segment.
   * The last `endSlack` metres are ignored so a peach beside its own trunk
   * can still be picked from up close.
   */
  blocksSegment(x0: number, z0: number, x1: number, z1: number, endSlack = 0.55): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return false;
    const keep = Math.max(0, len - endSlack);
    const x2 = x0 + (dx / len) * keep;
    const z2 = z0 + (dz / len) * keep;
    const minX = Math.min(x0, x2);
    const maxX = Math.max(x0, x2);
    const minZ = Math.min(z0, z2);
    const maxZ = Math.max(z0, z2);
    const ix0 = Math.floor(minX / this.cell) - 1;
    const ix1 = Math.floor(maxX / this.cell) + 1;
    const iz0 = Math.floor(minZ / this.cell) - 1;
    const iz1 = Math.floor(maxZ / this.cell) + 1;
    const sdx = x2 - x0;
    const sdz = z2 - z0;
    const len2 = sdx * sdx + sdz * sdz;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (!c.sight) continue;
          let t = 0;
          if (len2 > 1e-8) t = ((c.x - x0) * sdx + (c.z - z0) * sdz) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const ex = x0 + sdx * t - c.x;
          const ez = z0 + sdz * t - c.z;
          if (ex * ex + ez * ez < c.r * c.r) return true;
        }
      }
    }
    return false;
  }
}
