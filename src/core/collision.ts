import { clamp, closestOnSeg, dist, dist2, fromAngle, pointSegDist } from './math2d';
import type {
  CollisionBody,
  CollisionObstacle,
  CollisionObstacleInput,
  ResolvedUnitBodies,
  RoomCollisionBody,
  UnitKind,
  Vec2
} from './types';

export const HIT_BODY_RADIUS_FACTOR = 0.5;
export const PROJECTILE_UNIT_HIT_RADIUS_FACTOR = 1;
export const DEFAULT_PICK_PADDING = 18;

export interface UnitBodySource {
  radius: number;
  kind?: UnitKind;
  hitRadius?: number;
  targetRadius?: number;
  pickRadius?: number;
  visualFootprintRadius?: number;
  footprintDecoupled?: boolean;
}

interface ZoneLike {
  shape: 'circle' | 'line';
  pos?: Vec2;
  radius?: number;
  a?: Vec2;
  b?: Vec2;
  width: number;
}

export function circleBody(radius: number, overrides: Partial<CollisionBody> = {}): CollisionBody {
  return {
    layer: 'static',
    shape: { kind: 'circle', radius },
    blocksMovement: false,
    ...overrides
  };
}

export function capsuleBody(halfLength: number, radius: number, overrides: Partial<CollisionBody> = {}): CollisionBody {
  return {
    layer: 'static',
    shape: { kind: 'capsule', halfLength, radius, angle: 0 },
    blocksMovement: false,
    ...overrides
  };
}

export function rectBody(width: number, depth: number, overrides: Partial<CollisionBody> = {}): CollisionBody {
  return {
    layer: 'static',
    shape: { kind: 'rect', width, depth, angle: 0 },
    blocksMovement: false,
    ...overrides
  };
}

export function collisionShapeBoundingRadius(shape: CollisionBody['shape']): number {
  switch (shape.kind) {
    case 'circle':
      return shape.radius;
    case 'capsule':
      return shape.halfLength + shape.radius;
    case 'rect':
      return Math.hypot(shape.width, shape.depth) / 2;
  }
}

export function collisionBodyBoundingRadius(body: CollisionBody): number {
  return collisionShapeBoundingRadius(body.shape);
}

export interface CollisionPush {
  normal: Vec2;
  penetration: number;
  contact: Vec2;
}

function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function capsuleEnds(pos: Vec2, halfLength: number, angle = 0): { a: Vec2; b: Vec2 } {
  const axis = fromAngle(angle, halfLength);
  return {
    a: { x: pos.x - axis.x, y: pos.y - axis.y },
    b: { x: pos.x + axis.x, y: pos.y + axis.y }
  };
}

function fallbackNormal(angle: number): Vec2 {
  const n = fromAngle(angle);
  return n.x === 0 && n.y === 0 ? { x: 1, y: 0 } : n;
}

function circlePushFromCenter(center: Vec2, radius: number, point: Vec2, circleRadius: number, fallbackAngle: number): CollisionPush | null {
  const minD = radius + circleRadius;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return null;
  const d = Math.sqrt(d2);
  const normal = d > 1e-6 ? { x: dx / d, y: dy / d } : fallbackNormal(fallbackAngle);
  return {
    normal,
    penetration: minD - d,
    contact: { x: center.x + normal.x * radius, y: center.y + normal.y * radius }
  };
}

export function collisionBodyPushOut(pos: Vec2, body: CollisionBody, point: Vec2, circleRadius: number, fallbackAngle = 0): CollisionPush | null {
  const radius = Math.max(0, circleRadius);
  switch (body.shape.kind) {
    case 'circle':
      return circlePushFromCenter(pos, body.shape.radius, point, radius, fallbackAngle);
    case 'capsule': {
      const { a, b } = capsuleEnds(pos, body.shape.halfLength, body.shape.angle);
      const center = closestOnSeg(point, a, b);
      return circlePushFromCenter(center, body.shape.radius, point, radius, fallbackAngle);
    }
    case 'rect': {
      const angle = body.shape.angle ?? 0;
      const local = rotate({ x: point.x - pos.x, y: point.y - pos.y }, -angle);
      const hx = Math.max(0, body.shape.width / 2);
      const hy = Math.max(0, body.shape.depth / 2);
      const closest = { x: clamp(local.x, -hx, hx), y: clamp(local.y, -hy, hy) };
      const outsideX = local.x < -hx || local.x > hx;
      const outsideY = local.y < -hy || local.y > hy;
      if (outsideX || outsideY) {
        const dx = local.x - closest.x;
        const dy = local.y - closest.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) return null;
        const d = Math.sqrt(d2);
        const localNormal = d > 1e-6 ? { x: dx / d, y: dy / d } : fallbackNormal(fallbackAngle - angle);
        const normal = rotate(localNormal, angle);
        const worldContact = rotate(closest, angle);
        return {
          normal,
          penetration: radius - d,
          contact: { x: pos.x + worldContact.x, y: pos.y + worldContact.y }
        };
      }

      const toLeft = local.x + hx;
      const toRight = hx - local.x;
      const toBottom = local.y + hy;
      const toTop = hy - local.y;
      const nearest = Math.min(toLeft, toRight, toBottom, toTop);
      let localNormal: Vec2;
      let localContact: Vec2;
      if (nearest === toLeft) {
        localNormal = { x: -1, y: 0 };
        localContact = { x: -hx, y: local.y };
      } else if (nearest === toRight) {
        localNormal = { x: 1, y: 0 };
        localContact = { x: hx, y: local.y };
      } else if (nearest === toBottom) {
        localNormal = { x: 0, y: -1 };
        localContact = { x: local.x, y: -hy };
      } else {
        localNormal = { x: 0, y: 1 };
        localContact = { x: local.x, y: hy };
      }
      const normal = rotate(localNormal, angle);
      const worldContact = rotate(localContact, angle);
      return {
        normal,
        penetration: radius + nearest,
        contact: { x: pos.x + worldContact.x, y: pos.y + worldContact.y }
      };
    }
  }
}

export function nearestPointOutsideCollisionBody(pos: Vec2, body: CollisionBody, point: Vec2, padding = 0, fallbackAngle = 0): Vec2 {
  const push = collisionBodyPushOut(pos, body, point, padding, fallbackAngle);
  if (!push) return { ...point };
  return {
    x: point.x + push.normal.x * (push.penetration + 0.5),
    y: point.y + push.normal.y * (push.penetration + 0.5)
  };
}

export function resolveUnitBodies(unit: UnitBodySource): ResolvedUnitBodies {
  const radius = Math.max(0, unit.radius);
  const visualRadius = Math.max(0, unit.visualFootprintRadius ?? 0);
  const hitRadius = Math.max(radius, unit.hitRadius ?? 0, unit.footprintDecoupled ? visualRadius : 0);
  const targetRadius = Math.max(radius, unit.targetRadius ?? 0, unit.footprintDecoupled ? visualRadius : 0);
  const pickRadius = Math.max(hitRadius, targetRadius, unit.pickRadius ?? 0, unit.footprintDecoupled ? visualRadius : 0);
  const pickPadding = Math.max(DEFAULT_PICK_PADDING, pickRadius * 0.12);
  const targetable = unit.kind !== 'npc';
  return {
    movement: circleBody(radius, {
      layer: 'unit',
      blocksMovement: true,
      feedback: { stopSound: 'flesh', impactVfx: 'dust', label: 'Unit body' }
    }),
    target: circleBody(targetRadius, {
      layer: 'unit',
      targetable,
      feedback: { impactVfx: 'blood', label: 'Target body' }
    }),
    hit: circleBody(hitRadius, {
      layer: 'unit',
      targetable,
      feedback: { impactVfx: 'blood', label: 'Hit body' }
    }),
    pick: circleBody(pickRadius, {
      layer: 'unit',
      targetable,
      interactable: unit.kind === 'npc',
      pickPadding,
      feedback: { label: 'Pick body' }
    })
  };
}

export function unitHitRadius(unit: UnitBodySource): number {
  const shape = resolveUnitBodies(unit).hit.shape;
  return shape.kind === 'circle' ? shape.radius : unit.radius;
}

export function unitTargetRadius(unit: UnitBodySource): number {
  const shape = resolveUnitBodies(unit).target.shape;
  return shape.kind === 'circle' ? shape.radius : unit.radius;
}

export function unitPickRadius(unit: UnitBodySource): number {
  const pick = resolveUnitBodies(unit).pick;
  const shapeRadius = pick.shape.kind === 'circle' ? pick.shape.radius : unit.radius;
  return shapeRadius + (pick.pickPadding ?? 0);
}

export function radiusContainsUnit(center: Vec2, radius: number, unit: UnitBodySource & { pos: Vec2 }): boolean {
  const effectiveRadius = radius + unitHitRadius(unit) * HIT_BODY_RADIUS_FACTOR;
  return dist2(unit.pos, center) <= effectiveRadius * effectiveRadius;
}

export function lineContainsUnit(a: Vec2, b: Vec2, width: number, unit: UnitBodySource & { pos: Vec2 }): boolean {
  return pointSegDist(unit.pos, a, b) <= width / 2 + unitHitRadius(unit) * HIT_BODY_RADIUS_FACTOR;
}

export function projectileSegmentHitsUnit(from: Vec2, to: Vec2, width: number, unit: UnitBodySource & { pos: Vec2 }): boolean {
  return pointSegDist(unit.pos, from, to) <= width / 2 + unitHitRadius(unit) * PROJECTILE_UNIT_HIT_RADIUS_FACTOR;
}

export function homingProjectileHitRadius(unit: UnitBodySource, baseRadius: number): number {
  return baseRadius + unitTargetRadius(unit) * HIT_BODY_RADIUS_FACTOR;
}

export function zoneContainsUnit(zone: ZoneLike, unit: UnitBodySource & { pos: Vec2 }): boolean {
  if (zone.shape === 'circle') {
    if (!zone.pos) return false;
    return radiusContainsUnit(zone.pos, zone.radius ?? 0, unit);
  }
  return zone.a !== undefined && zone.b !== undefined && lineContainsUnit(zone.a, zone.b, zone.width, unit);
}

export function normalizeCollisionObstacle(input: CollisionObstacleInput): CollisionObstacle {
  const body = input.body ?? circleBody(input.radius, {
    layer: 'static',
    blocksMovement: true,
    blocksProjectiles: false,
    feedback: { stopSound: 'wood', impactVfx: 'dust', label: input.id ?? 'Static blocker' }
  });
  return {
    ...input,
    radius: Math.max(input.radius, collisionBodyBoundingRadius(body)),
    body
  };
}

export function obstacleBlocksMovement(obstacle: { body?: CollisionBody }): boolean {
  return obstacle.body?.blocksMovement !== false && obstacle.body?.layer !== 'decor';
}

export function obstacleBlocksProjectiles(obstacle: { body?: CollisionBody }): boolean {
  return obstacle.body?.blocksProjectiles === true && obstacle.body?.layer !== 'decor';
}

export function obstacleBlocksVision(obstacle: { body?: CollisionBody }): boolean {
  return obstacle.body?.blocksVision === true && obstacle.body?.layer !== 'decor';
}

export interface SegmentCircleHit {
  t: number;
  pos: Vec2;
  distance: number;
}

export function segmentCircleFirstHit(from: Vec2, to: Vec2, center: Vec2, radius: number): SegmentCircleHit | null {
  if (radius <= 0) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fx = from.x - center.x;
  const fy = from.y - center.y;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return dist2(from, center) <= radius * radius ? { t: 0, pos: { ...from }, distance: 0 } : null;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return { t: 0, pos: { ...from }, distance: 0 };
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t = (-b - root) / (2 * a);
  if (t < 0 || t > 1) return null;
  return {
    t,
    pos: { x: from.x + dx * t, y: from.y + dy * t },
    distance: Math.sqrt(a) * t
  };
}

function segmentHitsCollisionBody(
  from: Vec2,
  to: Vec2,
  width: number,
  obstacle: CollisionObstacle
): SegmentCircleHit | null {
  const sweepRadius = Math.max(0, width) / 2;
  if (obstacle.body.shape.kind === 'circle') {
    return segmentCircleFirstHit(from, to, obstacle.pos, obstacle.body.shape.radius + sweepRadius);
  }

  const length = dist(from, to);
  if (length < 1e-9) {
    return collisionBodyPushOut(obstacle.pos, obstacle.body, from, sweepRadius) ? { t: 0, pos: { ...from }, distance: 0 } : null;
  }
  const broad = Math.max(16, collisionBodyBoundingRadius(obstacle.body) + sweepRadius);
  const steps = Math.min(160, Math.max(8, Math.ceil(length / broad)));
  let lo = 0;
  let hi = 0;
  let found = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (collisionBodyPushOut(obstacle.pos, obstacle.body, p, sweepRadius)) {
      hi = t;
      lo = Math.max(0, (i - 1) / steps);
      found = true;
      break;
    }
  }
  if (!found) return null;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const p = { x: from.x + (to.x - from.x) * mid, y: from.y + (to.y - from.y) * mid };
    if (collisionBodyPushOut(obstacle.pos, obstacle.body, p, sweepRadius)) hi = mid;
    else lo = mid;
  }
  const pos = { x: from.x + (to.x - from.x) * hi, y: from.y + (to.y - from.y) * hi };
  return { t: hi, pos, distance: length * hi };
}

export function projectileSegmentHitsObstacle(
  from: Vec2,
  to: Vec2,
  width: number,
  obstacle: CollisionObstacle
): SegmentCircleHit | null {
  if (!obstacleBlocksProjectiles(obstacle)) return null;
  return segmentHitsCollisionBody(from, to, width, obstacle);
}

export function visionSegmentHitsObstacle(
  from: Vec2,
  to: Vec2,
  obstacle: CollisionObstacle
): SegmentCircleHit | null {
  if (!obstacleBlocksVision(obstacle)) return null;
  return segmentHitsCollisionBody(from, to, 0, obstacle);
}

export function firstVisionBlocker(from: Vec2, to: Vec2, obstacles: readonly CollisionObstacle[]): (SegmentCircleHit & { obstacle: CollisionObstacle }) | null {
  let first: (SegmentCircleHit & { obstacle: CollisionObstacle }) | null = null;
  for (const obstacle of obstacles) {
    const hit = visionSegmentHitsObstacle(from, to, obstacle);
    if (hit && hit.distance < (first?.distance ?? Infinity)) first = { ...hit, obstacle };
  }
  return first;
}

export function staticCircleObstacle(args: {
  pos: Vec2;
  radius: number;
  id?: string;
  source?: string;
  layer?: CollisionBody['layer'];
  blocksMovement?: boolean;
  blocksProjectiles?: boolean;
  blocksVision?: boolean;
  targetable?: boolean;
  interactable?: boolean;
  pickPadding?: number;
  feedbackLabel?: string;
}): CollisionObstacleInput {
  const blocksMovement = args.blocksMovement ?? true;
  return {
    pos: args.pos,
    radius: args.radius,
    id: args.id,
    source: args.source,
    body: circleBody(args.radius, {
      layer: args.layer ?? 'static',
      blocksMovement,
      blocksProjectiles: args.blocksProjectiles ?? false,
      blocksVision: args.blocksVision ?? false,
      targetable: args.targetable,
      interactable: args.interactable,
      pickPadding: args.pickPadding,
      feedback: { stopSound: 'stone', impactVfx: 'dust', label: args.feedbackLabel ?? args.id }
    })
  };
}

export function contactCircleObstacle(args: {
  pos: Vec2;
  radius: number;
  id: string;
  source: string;
  layer: CollisionBody['layer'];
  mode: 'solid' | 'soft' | 'decor';
  blocksProjectiles?: boolean;
  blocksVision?: boolean;
  interactable?: boolean;
  targetable?: boolean;
  pickPadding?: number;
  feedbackLabel?: string;
}): CollisionObstacleInput {
  const solid = args.mode === 'solid';
  return staticCircleObstacle({
    pos: args.pos,
    radius: Math.max(0, args.radius),
    id: args.id,
    source: args.source,
    layer: args.mode === 'decor' ? 'decor' : args.layer,
    blocksMovement: solid,
    blocksProjectiles: args.blocksProjectiles ?? false,
    blocksVision: args.blocksVision ?? solid,
    interactable: args.interactable ?? args.mode === 'soft',
    targetable: args.targetable,
    pickPadding: args.pickPadding,
    feedbackLabel: args.feedbackLabel
  });
}

export function roomCollisionObstacle(body: RoomCollisionBody): CollisionObstacleInput {
  const radius = collisionBodyBoundingRadius(body.body);
  return {
    id: body.id,
    pos: body.pos,
    radius,
    source: body.source,
    body: body.body
  };
}
