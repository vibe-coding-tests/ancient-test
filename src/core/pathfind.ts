// Grid A* pathfinding for overworld / town / dungeon navigation (SPEC §3).
//
// The kinematic steering in `movement.ts` only does *local* avoidance: it slips
// around the nearest blocking circle but has no notion of the route to the goal,
// so it orbits and wedges against large props (town buildings) and gives up at a
// projected rim point. This module computes an actual route around solid
// obstacles and hands `steerToward` a list of waypoints to chase, while local
// avoidance still resolves moving units between waypoints.
//
// It is deliberately lazy and cheap: callers first check `directWalkable` (a
// straight shot, the common case in open field / combat) and only fall back to
// `findPath` (a bounded local grid search) when the direct line is blocked.

import { collisionBodyPushOut, obstacleBlocksMovement } from './collision';
import type { CollisionBody, Vec2 } from './types';
import type { Sim } from './sim';

interface Solid {
  pos: Vec2;
  radius: number;
  body: CollisionBody;
}

const MAX_CELLS = 120;        // hard cap on grid dimension per axis (search bound)
const MIN_CELL = 40;          // finest cell size in sim units
const MAX_CELL = 160;         // coarsest cell size (used when the box is huge)
const BBOX_MARGIN = 720;      // how far outside the start/goal box to consider routing
const SQRT2 = Math.SQRT2;

function solidsOf(sim: Sim): Solid[] {
  const out: Solid[] = [];
  for (const o of sim.obstacles) {
    if (!obstacleBlocksMovement(o)) continue;
    out.push({ pos: o.pos, radius: o.radius, body: o.body });
  }
  return out;
}

/** True when a unit of `radius` can travel `a`→`b` in a straight line unobstructed by solids. */
export function directWalkable(sim: Sim, a: Vec2, b: Vec2, radius: number): boolean {
  return segmentClear(solidsOf(sim), a, b, radius);
}

function segmentClear(solids: Solid[], a: Vec2, b: Vec2, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const step = Math.max(16, radius * 0.75);
  const steps = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: a.x + dx * t, y: a.y + dy * t };
    for (const s of solids) {
      // cheap broad reject before the exact body test
      const rr = s.radius + radius;
      const ddx = p.x - s.pos.x;
      const ddy = p.y - s.pos.y;
      if (ddx * ddx + ddy * ddy > rr * rr) continue;
      if (collisionBodyPushOut(s.pos, s.body, p, radius)) return false;
    }
  }
  return true;
}

interface Grid {
  cols: number;
  rows: number;
  cell: number;
  ox: number;
  oy: number;
  blocked: Uint8Array;
}

function buildGrid(sim: Sim, solids: Solid[], start: Vec2, goal: Vec2, radius: number): Grid {
  let minX = Math.min(start.x, goal.x) - BBOX_MARGIN;
  let minY = Math.min(start.y, goal.y) - BBOX_MARGIN;
  let maxX = Math.max(start.x, goal.x) + BBOX_MARGIN;
  let maxY = Math.max(start.y, goal.y) + BBOX_MARGIN;
  minX = Math.max(0, minX);
  minY = Math.max(0, minY);
  maxX = Math.min(sim.bounds.w, maxX);
  maxY = Math.min(sim.bounds.h, maxY);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  let cell = Math.min(MAX_CELL, Math.max(MIN_CELL, radius * 1.6));
  // Grow the cell if the box would exceed the search cap, so the grid stays bounded.
  cell = Math.max(cell, w / MAX_CELLS, h / MAX_CELLS);
  const cols = Math.max(1, Math.min(MAX_CELLS, Math.ceil(w / cell)));
  const rows = Math.max(1, Math.min(MAX_CELLS, Math.ceil(h / cell)));

  const blocked = new Uint8Array(cols * rows);
  const center = (cx: number, cy: number): Vec2 => ({ x: minX + (cx + 0.5) * cell, y: minY + (cy + 0.5) * cell });

  // Rasterize each solid into the cells its inflated footprint touches.
  for (const s of solids) {
    const reach = s.radius + radius;
    const c0 = Math.max(0, Math.floor((s.pos.x - reach - minX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((s.pos.x + reach - minX) / cell));
    const r0 = Math.max(0, Math.floor((s.pos.y - reach - minY) / cell));
    const r1 = Math.min(rows - 1, Math.floor((s.pos.y + reach - minY) / cell));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const idx = cy * cols + cx;
        if (blocked[idx]) continue;
        if (collisionBodyPushOut(s.pos, s.body, center(cx, cy), radius)) blocked[idx] = 1;
      }
    }
  }

  return { cols, rows, cell, ox: minX, oy: minY, blocked };
}

function cellOf(g: Grid, p: Vec2): { cx: number; cy: number } {
  return {
    cx: Math.max(0, Math.min(g.cols - 1, Math.floor((p.x - g.ox) / g.cell))),
    cy: Math.max(0, Math.min(g.rows - 1, Math.floor((p.y - g.oy) / g.cell)))
  };
}

/** Nearest free cell to (cx,cy) via ring BFS; null if the whole grid is blocked. */
function nearestFree(g: Grid, cx: number, cy: number): number | null {
  const start = cy * g.cols + cx;
  if (!g.blocked[start]) return start;
  const seen = new Uint8Array(g.cols * g.rows);
  const queue: number[] = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const x = idx % g.cols;
    const y = (idx - x) / g.cols;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
        const nidx = ny * g.cols + nx;
        if (seen[nidx]) continue;
        seen[nidx] = 1;
        if (!g.blocked[nidx]) return nidx;
        queue.push(nidx);
      }
    }
  }
  return null;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
];

/**
 * Compute a route from `start` to `goal` for a unit of `radius`, as a list of
 * world waypoints (excluding the start, the final point is `goal` or, if goal is
 * blocked, the nearest reachable point). Returns null when no route exists — the
 * caller should then fall back to direct steering and surface `no-path`.
 */
export function findPath(sim: Sim, start: Vec2, goal: Vec2, radius: number): Vec2[] | null {
  const solids = solidsOf(sim);
  if (solids.length === 0) return [{ ...goal }];
  if (segmentClear(solids, start, goal, radius)) return [{ ...goal }];

  const g = buildGrid(sim, solids, start, goal, radius);
  const sCell = cellOf(g, start);
  const gCell = cellOf(g, goal);
  const startIdx = nearestFree(g, sCell.cx, sCell.cy);
  const goalIdx = nearestFree(g, gCell.cx, gCell.cy);
  if (startIdx == null || goalIdx == null) return null;
  if (startIdx === goalIdx) return [{ ...goal }];

  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const open = new MinHeap();

  const goalX = goalIdx % g.cols;
  const goalY = (goalIdx - goalX) / g.cols;
  const heuristic = (idx: number): number => {
    const x = idx % g.cols;
    const y = (idx - x) / g.cols;
    const dx = Math.abs(x - goalX);
    const dy = Math.abs(y - goalY);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy); // octile
  };

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startIdx);
  open.push(startIdx, fScore[startIdx]);

  let found = false;
  while (open.size > 0) {
    const current = open.pop();
    if (current === goalIdx) { found = true; break; }
    const cx = current % g.cols;
    const cy = (current - cx) / g.cols;
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const nidx = ny * g.cols + nx;
      if (g.blocked[nidx]) continue;
      // forbid diagonal moves that cut a blocked corner
      if (dx !== 0 && dy !== 0) {
        if (g.blocked[cy * g.cols + nx] || g.blocked[ny * g.cols + cx]) continue;
      }
      const tentative = gScore[current] + cost;
      if (tentative < gScore[nidx]) {
        came[nidx] = current;
        gScore[nidx] = tentative;
        fScore[nidx] = tentative + heuristic(nidx);
        open.push(nidx, fScore[nidx]);
      }
    }
  }
  if (!found) return null;

  // Reconstruct cell path, then convert to world points.
  const cellPath: number[] = [];
  for (let idx = goalIdx; idx !== -1; idx = came[idx]) cellPath.push(idx);
  cellPath.reverse();

  const points: Vec2[] = cellPath.map((idx) => {
    const x = idx % g.cols;
    const y = (idx - x) / g.cols;
    return { x: g.ox + (x + 0.5) * g.cell, y: g.oy + (y + 0.5) * g.cell };
  });
  // The true destination replaces the last cell center when goal was reachable.
  if (gCell.cx === goalX && gCell.cy === goalY) points[points.length - 1] = { ...goal };

  return stringPull(solids, start, points, radius);
}

/** Drop intermediate waypoints the unit can skip with a clear straight line. */
function stringPull(solids: Solid[], start: Vec2, points: Vec2[], radius: number): Vec2[] {
  if (points.length <= 1) return points;
  const out: Vec2[] = [];
  let anchor = start;
  let i = 0;
  while (i < points.length) {
    let j = points.length - 1;
    // Find the farthest point reachable from the anchor in a straight line.
    for (; j > i; j--) {
      if (segmentClear(solids, anchor, points[j], radius)) break;
    }
    out.push(points[j]);
    anchor = points[j];
    i = j + 1;
  }
  return out;
}

/** Tiny binary min-heap over cell indices keyed by f-score. */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, priority: number): void {
    this.items.push(item);
    this.prio.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const last = this.items.length - 1;
    this.swap(0, last);
    this.items.pop();
    this.prio.pop();
    let i = 0;
    const len = this.items.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < len && this.prio[l] < this.prio[smallest]) smallest = l;
      if (r < len && this.prio[r] < this.prio[smallest]) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
