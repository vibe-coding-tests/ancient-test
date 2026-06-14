import { TUNING } from '../data/tuning';
import { firstVisionBlocker, projectileSegmentHitsObstacle, unitTargetRadius } from './collision';
import { dist, norm, sub, v2 } from './math2d';
import { cannotCast } from './status';
import type { Sim } from './sim';
import type { Unit } from './unit';
import type { AbilityDef, EffectNode, ProjectileSpec, ValueRef, Vec2, ZoneSpec } from './types';
import { resolveVal } from './values';

export type CastInvalidReason =
  | 'no-target'
  | 'invalid-target'
  | 'wrong-target'
  | 'untargetable'
  | 'not-visible'
  | 'immune'
  | 'out-of-range'
  | 'no-line'
  | 'cannot-cast';

export type CastPreviewShape =
  | { kind: 'circle'; pos: Vec2; radius: number; source: string }
  | { kind: 'line'; a: Vec2; b: Vec2; width: number; source: string; blockedAt?: Vec2 }
  | { kind: 'projectile'; from: Vec2; to: Vec2; width: number; source: string; blockedAt?: Vec2 };

export interface CastPreview {
  ok: boolean;
  reason?: CastInvalidReason;
  castRange: number;
  aim?: Vec2;
  target?: Unit;
  targetUid?: number;
  shapes: CastPreviewShape[];
  lineBlockedAt?: Vec2;
}

export interface CastPreviewInput {
  uid?: number;
  point?: Vec2;
}

function V(def: AbilityDef, level: number, ref: ValueRef | undefined, fallback = 0): number {
  return resolveVal(ref, def.values, Math.max(1, level), fallback);
}

export function abilityCastRange(def: AbilityDef, level: number, caster: Unit): number {
  return (V(def, level, def.castRange, 600) + caster.stats.castRangeBonus) * TUNING.rangeScale;
}

function targetAllowed(def: AbilityDef, caster: Unit, target: Unit): boolean {
  if (def.affects === 'enemy') return target.team !== caster.team;
  if (def.affects === 'ally') return target.team === caster.team;
  return true;
}

function centerFor(nodeAt: 'point' | 'self' | 'target' | 'line-to-point' | undefined, caster: Unit, aim: Vec2, target?: Unit): Vec2 {
  if (nodeAt === 'self') return caster.pos;
  if (nodeAt === 'target' && target) return target.pos;
  return aim;
}

function firstProjectileBlock(from: Vec2, to: Vec2, width: number, sim: Sim): Vec2 | undefined {
  let best: { distance: number; pos: Vec2 } | null = null;
  for (const obstacle of sim.obstacles) {
    const hit = projectileSegmentHitsObstacle(from, to, width, obstacle);
    if (hit && hit.distance < (best?.distance ?? Infinity)) best = hit;
  }
  return best?.pos;
}

function projectilePreview(def: AbilityDef, level: number, caster: Unit, spec: ProjectileSpec, to: Vec2, sim: Sim, source: string): CastPreviewShape {
  const width = V(def, level, spec.width, spec.model === 'linear' ? 80 : TUNING.projectileHitRadius * 2);
  if (spec.model === 'linear') {
    const dir = norm(sub(to, caster.pos));
    const range = V(def, level, spec.range, 900);
    const end = v2(caster.pos.x + dir.x * range, caster.pos.y + dir.y * range);
    return { kind: 'projectile', from: { ...caster.pos }, to: end, width, source, blockedAt: firstProjectileBlock(caster.pos, end, width, sim) };
  }
  return { kind: 'projectile', from: { ...caster.pos }, to: { ...to }, width, source, blockedAt: firstProjectileBlock(caster.pos, to, width, sim) };
}

function zonePreview(def: AbilityDef, level: number, caster: Unit, spec: ZoneSpec, aim: Vec2, target: Unit | undefined, sim: Sim, source: string): CastPreviewShape {
  if (spec.shape === 'line') {
    const dir = norm(sub(aim, caster.pos));
    const length = V(def, level, spec.length, 800);
    const width = V(def, level, spec.width, 100);
    const a = v2(caster.pos.x + dir.x * (caster.radius + 40), caster.pos.y + dir.y * (caster.radius + 40));
    const b = v2(a.x + dir.x * length, a.y + dir.y * length);
    return { kind: 'line', a, b, width, source, blockedAt: firstProjectileBlock(a, b, width, sim) };
  }
  void target;
  return { kind: 'circle', pos: { ...aim }, radius: V(def, level, spec.radius, 300), source };
}

function visitPreviewEffects(def: AbilityDef, level: number, caster: Unit, effects: readonly EffectNode[] | undefined, aim: Vec2, target: Unit | undefined, sim: Sim, out: CastPreviewShape[], prefix = def.id): void {
  for (const node of effects ?? []) {
    const source = `${prefix}:${node.kind}`;
    if ('radius' in node && node.radius !== undefined && node.kind !== 'repeat') {
      out.push({ kind: 'circle', pos: centerFor(undefined, caster, aim, target), radius: V(def, level, node.radius, 0), source });
    }
    if (node.kind === 'zone') {
      const zoneAim = centerFor(node.at, caster, aim, target);
      out.push(zonePreview(def, level, caster, node.zone, zoneAim, target, sim, source));
      visitPreviewEffects(def, level, caster, node.zone.tick?.effects, zoneAim, target, sim, out, `${source}:tick`);
      visitPreviewEffects(def, level, caster, node.zone.onEnter?.effects, zoneAim, target, sim, out, `${source}:enter`);
    } else if (node.kind === 'projectile') {
      const to = node.to === 'target' ? (target?.pos ?? aim) : aim;
      out.push(projectilePreview(def, level, caster, node.proj, to, sim, source));
    } else if (node.kind === 'repeat') {
      visitPreviewEffects(def, level, caster, node.effects, aim, target, sim, out, source);
    }
  }
}

export function resolveCastPreview(sim: Sim, caster: Unit | undefined, def: AbilityDef, level: number, input: CastPreviewInput = {}): CastPreview {
  if (!caster || !caster.alive || cannotCast(caster.summary)) {
    return { ok: false, reason: 'cannot-cast', castRange: 0, shapes: [] };
  }

  const castRange = abilityCastRange(def, level, caster);
  const target = input.uid !== undefined ? sim.unit(input.uid) : undefined;
  const aim = target?.pos ?? input.point ?? caster.pos;
  const shapes: CastPreviewShape[] = [];
  visitPreviewEffects(def, level, caster, def.effects, aim, target, sim, shapes);

  let reason: CastInvalidReason | undefined;
  if (def.targeting === 'unit-target') {
    if (!target || !target.alive) reason = 'no-target';
    else if (!targetAllowed(def, caster, target)) reason = 'wrong-target';
    else if (target.summary.untargetable) reason = 'untargetable';
    else if (!target.isVisibleTo(caster.team, sim.time)) reason = 'not-visible';
    else if (target.team !== caster.team && target.summary.magicImmune && !def.piercesImmunity) reason = 'immune';
  }

  const lineBlock = target ? firstVisionBlocker(caster.pos, target.pos, sim.obstacles) : null;
  if (!reason && lineBlock) reason = 'no-line';
  if (!reason && def.targeting !== 'no-target' && def.targeting !== 'toggle' && def.targeting !== 'passive' && def.targeting !== 'aura' && def.targeting !== 'attack-modifier') {
    const targetPad = target ? unitTargetRadius(target) : 0;
    if (dist(caster.pos, aim) - targetPad > castRange) reason = 'out-of-range';
  }

  return {
    ok: reason === undefined,
    reason,
    castRange,
    aim: { ...aim },
    target,
    targetUid: target?.uid,
    shapes,
    lineBlockedAt: lineBlock?.pos
  };
}

export function castInvalidReasonLabel(reason: CastInvalidReason): string {
  switch (reason) {
    case 'no-target': return 'No target';
    case 'invalid-target': return 'Invalid target';
    case 'wrong-target': return 'Wrong target';
    case 'untargetable': return 'Untargetable';
    case 'not-visible': return 'Not visible';
    case 'immune': return 'Magic immune';
    case 'out-of-range': return 'Out of range';
    case 'no-line': return 'No line';
    case 'cannot-cast': return 'Cannot cast';
  }
}
