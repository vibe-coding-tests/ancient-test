import { dist2 } from './math2d';
import type { Unit } from './unit';
import type { Vec2 } from './types';

/**
 * Deterministic broadphase for the headless sim.
 *
 * The grid is rebuilt from `unitsArr` at fixed points in the tick, so queries
 * stay seed-deterministic while avoiding all-units scans in local systems.
 */
export class SpatialGrid {
  private buckets = new Map<string, Unit[]>();

  constructor(readonly cellSize: number) {}

  rebuild(units: readonly Unit[]): void {
    this.buckets.clear();
    for (const u of units) {
      if (!u.alive) continue;
      const key = this.keyForPoint(u.pos);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(u);
    }
  }

  queryRadius(center: Vec2, radius: number, pred: (u: Unit) => boolean): Unit[] {
    const out: Unit[] = [];
    const r2 = radius * radius;
    this.forEachBroadphase(center, radius, (u) => {
      if (dist2(u.pos, center) <= r2 && pred(u)) out.push(u);
    });
    out.sort((a, b) => a.uid - b.uid);
    return out;
  }

  forEachRadius(center: Vec2, radius: number, fn: (u: Unit) => void): void {
    const r2 = radius * radius;
    this.forEachBroadphase(center, radius, (u) => {
      if (dist2(u.pos, center) <= r2) fn(u);
    });
  }

  nearest(center: Vec2, radius: number, pred: (u: Unit) => boolean): Unit | null {
    let best: Unit | null = null;
    let bestD2 = radius * radius;
    this.forEachBroadphase(center, radius, (u) => {
      if (!pred(u)) return;
      const d2 = dist2(u.pos, center);
      if (d2 < bestD2 || (d2 === bestD2 && best && u.uid < best.uid)) {
        bestD2 = d2;
        best = u;
      }
    });
    return best;
  }

  private forEachBroadphase(center: Vec2, radius: number, fn: (u: Unit) => void): void {
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minY = Math.floor((center.y - radius) / this.cellSize);
    const maxY = Math.floor((center.y + radius) / this.cellSize);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.buckets.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const u of bucket) fn(u);
      }
    }
  }

  private keyForPoint(p: Vec2): string {
    return this.key(Math.floor(p.x / this.cellSize), Math.floor(p.y / this.cellSize));
  }

  private key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }
}
