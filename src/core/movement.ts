import { TUNING } from '../data/tuning';
import { angleDelta, clamp, closestOnSeg, dist, dist2, fromAngle, norm, pointSegDist, sub, turnToward, v2 } from './math2d';
import { cannotMove } from './status';
import type { Unit } from './unit';
import type { Vec2 } from './types';
import type { Sim } from './sim';

/**
 * Kinematic steering with local avoidance (SPEC §3): no physics, no navmesh.
 * Units turn with their turn rate (hero "weight"), then move along facing.
 */
export function steerToward(sim: Sim, u: Unit, point: Vec2, dt: number, arriveRadius: number): boolean {
  if (cannotMove(u.summary)) return false;
  const toTarget = sub(point, u.pos);
  const d = dist(u.pos, point);
  if (d <= arriveRadius) return true;

  let desired = Math.atan2(toTarget.y, toTarget.x);

  // Local avoidance: blocked ahead -> bias to a deterministic side
  const probe = Math.min(d, u.radius + 90);
  const ahead = v2(u.pos.x + Math.cos(u.facing) * probe, u.pos.y + Math.sin(u.facing) * probe);
  let blocker: { pos: Vec2; radius: number } | null = null;
  sim.forEachNearbyUnit(ahead, probe + u.radius + 80, (o) => {
    if (blocker) return;
    if (o === u || !o.alive || o.summary.cycloned) return;
    const aheadR = o.radius + u.radius + 6;
    const unitR = probe + o.radius + u.radius;
    if (dist2(o.pos, ahead) < aheadR * aheadR && dist2(o.pos, u.pos) < unitR * unitR) {
      blocker = o;
    }
  });
  if (!blocker) {
    for (const o of sim.obstacles) {
      const r = o.radius + u.radius + 6;
      if (dist2(o.pos, ahead) < r * r) {
        blocker = o;
        break;
      }
    }
  }
  if (blocker) {
    const off = sub(blocker.pos, u.pos);
    const side = off.x * toTarget.y - off.y * toTarget.x; // cross sign picks the slip side
    desired += (side >= 0 ? -1 : 1) * 0.9;
  }

  const turnSpeed = u.base.turnRate * TUNING.turnRateToRadPerSec;
  u.facing = turnToward(u.facing, desired, turnSpeed * dt);

  // move only when roughly aligned (units pivot in place on sharp turns)
  if (Math.abs(angleDelta(u.facing, desired)) < Math.PI * 0.55) {
    const step = u.stats.moveSpeed * dt;
    u.pos.x += Math.cos(u.facing) * Math.min(step, d);
    u.pos.y += Math.sin(u.facing) * Math.min(step, d);
  }
  resolveCollisions(sim, u);
  return dist(u.pos, point) <= arriveRadius;
}

export function faceToward(u: Unit, point: Vec2, dt: number): boolean {
  const desired = Math.atan2(point.y - u.pos.y, point.x - u.pos.x);
  const turnSpeed = u.base.turnRate * TUNING.turnRateToRadPerSec;
  u.facing = turnToward(u.facing, desired, turnSpeed * dt);
  return Math.abs(angleDelta(u.facing, desired)) < (TUNING.attackFacingDeg * Math.PI) / 180;
}

/** Circle-collider resolution against units, props, walls, and bounds. */
export function resolveCollisions(sim: Sim, u: Unit, ignoreUnits = false): void {
  for (let pass = 0; pass < 2; pass++) {
    if (!ignoreUnits) {
      sim.forEachNearbyUnit(u.pos, u.radius + 96, (o) => {
        if (o === u || !o.alive || o.summary.cycloned) return;
        const minD = o.radius + u.radius;
        const d2 = dist2(o.pos, u.pos);
        if (d2 < minD * minD && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (minD - d) * TUNING.separationStrength * 0.5;
          const n = norm(sub(u.pos, o.pos));
          u.pos.x += n.x * push;
          u.pos.y += n.y * push;
        } else if (d2 <= 1e-8) {
          // perfectly stacked: deterministic nudge by uid
          u.pos.x += (u.uid % 2 === 0 ? 1 : -1) * 2;
          u.pos.y += (u.uid % 3 === 0 ? 1 : -1) * 2;
        }
      });
    }
    for (const o of sim.obstacles) {
      const minD = o.radius + u.radius;
      const d2 = dist2(o.pos, u.pos);
      if (d2 < minD * minD && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const n = norm(sub(u.pos, o.pos));
        u.pos.x += n.x * (minD - d);
        u.pos.y += n.y * (minD - d);
      }
    }
    // temporary walls (Fissure / Ice Wall) block everyone, SPEC §2
    for (const z of sim.zones) {
      if (!z.wall || z.shape !== 'line' || !z.a || !z.b) continue;
      const minD = z.width / 2 + u.radius;
      const d = pointSegDist(u.pos, z.a, z.b);
      if (d < minD) {
        const cp = closestOnSeg(u.pos, z.a, z.b);
        let n = sub(u.pos, cp);
        if (n.x * n.x + n.y * n.y < 1e-6) n = fromAngle(u.facing + Math.PI / 2);
        n = norm(n);
        u.pos.x += n.x * (minD - d + 0.5);
        u.pos.y += n.y * (minD - d + 0.5);
      }
    }
  }
  u.pos.x = clamp(u.pos.x, u.radius, sim.bounds.w - u.radius);
  u.pos.y = clamp(u.pos.y, u.radius, sim.bounds.h - u.radius);
}

/** Integrate knockbacks / pulls / forced pushes. Returns true while a forced move is active. */
export function integrateForcedMoves(sim: Sim, u: Unit, dt: number): boolean {
  if (u.forced.length === 0) return false;
  const now = sim.time;
  let any = false;
  u.forced = u.forced.filter((f) => {
    if (now >= f.until) return false;
    let dir = f.dir;
    if (f.kind === 'pull' && f.pullToUid !== undefined) {
      const to = sim.unit(f.pullToUid);
      if (!to || !to.alive) return false;
      const d = dist(u.pos, to.pos);
      const stop = f.stopAtDist ?? 60;
      if (d <= stop) return false;
      dir = norm(sub(to.pos, u.pos));
      f.dir = dir;
    }
    u.pos.x += dir.x * f.speed * dt;
    u.pos.y += dir.y * f.speed * dt;
    any = true;
    return true;
  });
  if (any) {
    // forced movement cancels windup and channels (the Hook drag)
    u.windupUntil = -1;
    resolveCollisions(sim, u, true);
  }
  return any;
}
