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
}
