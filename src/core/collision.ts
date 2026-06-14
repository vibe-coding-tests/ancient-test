import { dist2, pointSegDist } from './math2d';
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
    body
  };
}

export function obstacleBlocksMovement(obstacle: { body?: CollisionBody }): boolean {
  return obstacle.body?.blocksMovement !== false && obstacle.body?.layer !== 'decor';
}

export function obstacleBlocksProjectiles(obstacle: { body?: CollisionBody }): boolean {
  return obstacle.body?.blocksProjectiles === true && obstacle.body?.layer !== 'decor';
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

export function projectileSegmentHitsObstacle(
  from: Vec2,
  to: Vec2,
  width: number,
  obstacle: CollisionObstacle
): SegmentCircleHit | null {
  if (!obstacleBlocksProjectiles(obstacle)) return null;
  if (obstacle.body.shape.kind !== 'circle') return null;
  return segmentCircleFirstHit(from, to, obstacle.pos, obstacle.body.shape.radius + Math.max(0, width) / 2);
}

export function staticCircleObstacle(args: {
  pos: Vec2;
  radius: number;
  id?: string;
  source?: string;
  layer?: CollisionBody['layer'];
  blocksProjectiles?: boolean;
  feedbackLabel?: string;
}): CollisionObstacleInput {
  return {
    pos: args.pos,
    radius: args.radius,
    id: args.id,
    source: args.source,
    body: circleBody(args.radius, {
      layer: args.layer ?? 'static',
      blocksMovement: true,
      blocksProjectiles: args.blocksProjectiles ?? false,
      feedback: { stopSound: 'stone', impactVfx: 'dust', label: args.feedbackLabel ?? args.id }
    })
  };
}

export function roomCollisionObstacle(body: RoomCollisionBody): CollisionObstacleInput {
  const radius = body.body.shape.kind === 'circle' ? body.body.shape.radius : 0;
  return {
    id: body.id,
    pos: body.pos,
    radius,
    source: body.source,
    body: body.body
  };
}
