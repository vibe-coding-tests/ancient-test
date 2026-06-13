import { TUNING } from '../data/tuning';
import { dist, v2 } from './math2d';
import { nearestEnemy } from './actions';
import type { Unit } from './unit';
import type { GambitAction, GambitCondition, GambitRule, GambitTargetMode, Vec2 } from './types';
import type { Sim } from './sim';

// -----------------------------------------------------------------
// Controllers are swappable per unit (SPEC §1.1):
//   player — orders come from outside (input / Captain Call)
//   creep  — wild camps, summons, entourage
//   gambit — macro battles + AI party members in raids
// -----------------------------------------------------------------

export function thinkUnit(sim: Sim, u: Unit): void {
  if (!u.alive) return;
  const c = u.ctrl;
  if (c.kind === 'player' || c.kind === 'ward' || c.kind === 'none') return;
  const cadence = c.kind === 'creep' ? 8 : 9; // ticks between thinks
  if ((sim.tickCount + u.uid) % cadence !== 0) return;
  if (c.kind === 'creep') thinkCreep(sim, u);
  else if (c.kind === 'gambit') thinkGambit(sim, u);
}

// ---------- creep AI ----------

function thinkCreep(sim: Sim, u: Unit): void {
  const c = u.ctrl;

  // owned units (entourage / summons): guard the owner
  if (u.ownerUid !== undefined && c.followOwner) {
    const owner = sim.unit(u.ownerUid);
    if (!owner || !owner.alive) {
      u.order = { kind: 'stop' };
      return;
    }
    const enemy = nearestEnemyOf(sim, u, owner.pos, 800) ?? nearestEnemyOf(sim, u, u.pos, 500);
    if (enemy) {
      maybeCastCreepAbility(sim, u, enemy);
      if (u.order.kind !== 'cast') u.order = { kind: 'attack-unit', uid: enemy.uid };
    } else if (dist(u.pos, owner.pos) > 320) {
      u.order = { kind: 'follow', uid: owner.uid };
    } else if (u.order.kind === 'follow') {
      u.order = { kind: 'stop' };
    }
    return;
  }

  // wild creeps: home camp, aggro, leash
  const home = c.homePos ?? u.pos;
  const dHome = dist(u.pos, home);

  if (c.leashed) {
    if (dHome < 120) {
      c.leashed = false;
      u.hp = u.stats.maxHp; // leash reset heals to full (DECISIONS)
      u.order = { kind: 'stop' };
    } else {
      u.order = { kind: 'move', point: { ...home } };
    }
    return;
  }
  if (dHome > TUNING.creepLeashRadius) {
    c.leashed = true;
    u.order = { kind: 'move', point: { ...home } };
    return;
  }

  const aggroR = u.aggroRadius ?? TUNING.creepAggroRadius;
  const enemy = nearestEnemy(sim, u, aggroR);
  if (enemy) {
    maybeCastCreepAbility(sim, u, enemy);
    if (u.order.kind !== 'cast') u.order = { kind: 'attack-unit', uid: enemy.uid };
    return;
  }

  // idle wander around camp
  if (u.order.kind === 'stop') {
    if (c.nextThinkAt === undefined || sim.time >= c.nextThinkAt) {
      c.nextThinkAt = sim.time + 3 + (u.uid % 5);
      const ang = sim.rng.range(0, Math.PI * 2);
      const r = sim.rng.range(0, TUNING.creepWanderRadius);
      c.wanderTarget = v2(home.x + Math.cos(ang) * r, home.y + Math.sin(ang) * r);
      u.order = { kind: 'move', point: c.wanderTarget };
    }
  }
}

function nearestEnemyOf(sim: Sim, u: Unit, around: Vec2, radius: number): Unit | null {
  let best: Unit | null = null;
  let bestD = radius;
  for (const o of sim.unitsArr) {
    if (!o.alive || o.team === u.team || o.kind === 'npc') continue;
    if (o.summary.untargetable || !o.isVisibleTo(u.team, sim.time)) continue;
    const d = dist(o.pos, around);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function maybeCastCreepAbility(sim: Sim, u: Unit, enemy: Unit): void {
  for (let slot = 0; slot < u.abilities.length; slot++) {
    const a = u.abilities[slot];
    if (a.level <= 0) continue;
    const t = a.def.targeting;
    if (t === 'passive' || t === 'aura' || t === 'attack-modifier') continue;
    if (!u.abilityReady(slot, sim.time).ok) continue;
    if (t === 'toggle') {
      if (!a.toggled) u.order = { kind: 'cast', slot };
      return;
    }
    const range = typeof a.def.castRange === 'number' ? a.def.castRange : 500;
    if (dist(u.pos, enemy.pos) > range * 1.1) continue;
    if (t === 'unit-target') {
      const affects = a.def.affects ?? 'enemy';
      if (affects === 'ally') {
        // heal-type: lowest hp ally nearby
        let best: Unit | null = null;
        for (const o of sim.unitsArr) {
          if (!o.alive || o.team !== u.team) continue;
          if (dist(o.pos, u.pos) > range) continue;
          if (o.hp / o.stats.maxHp >= 0.8) continue;
          if (!best || o.hp / o.stats.maxHp < best.hp / best.stats.maxHp) best = o;
        }
        if (best) {
          u.order = { kind: 'cast', slot, uid: best.uid };
          return;
        }
        continue;
      }
      u.order = { kind: 'cast', slot, uid: enemy.uid };
      return;
    }
    if (t === 'point-target' || t === 'ground-aoe' || t === 'skillshot') {
      u.order = { kind: 'cast', slot, point: { ...enemy.pos } };
      return;
    }
    if (t === 'no-target') {
      u.order = { kind: 'cast', slot };
      return;
    }
  }
}

// ---------- gambit controller (SPEC §7) ----------

export function thinkGambit(sim: Sim, u: Unit): void {
  const c = u.ctrl;
  const rules = c.rules ?? [];

  // maintain focus target
  let focus = c.focusUid !== undefined ? sim.unit(c.focusUid) : undefined;
  if (!focus || !focus.alive || focus.summary.untargetable || !focus.isVisibleTo(u.team, sim.time)) {
    focus = pickFocus(sim, u) ?? undefined;
    c.focusUid = focus?.uid;
  }

  for (const rule of rules) {
    if (!rule.if.every((cond) => evalCondition(sim, u, cond, focus))) continue;
    if (applyAction(sim, u, rule.then, focus)) return;
  }
  // default: attack focus
  if (focus) u.order = { kind: 'attack-unit', uid: focus.uid };
  else u.order = { kind: 'stop' };
}

function pickFocus(sim: Sim, u: Unit): Unit | null {
  let best: Unit | null = null;
  let bestScore = Infinity;
  for (const o of sim.unitsArr) {
    if (!o.alive || o.team === u.team || o.kind === 'npc') continue;
    if (o.summary.untargetable || !o.isVisibleTo(u.team, sim.time)) continue;
    const hpScore = o.hp / o.stats.maxHp;
    const distScore = dist(o.pos, u.pos) / 4000;
    const heroBias = o.kind === 'hero' ? 0 : 0.5;
    const score = hpScore + distScore * 0.3 + heroBias;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

function evalCondition(sim: Sim, u: Unit, cond: GambitCondition, focus: Unit | undefined): boolean {
  switch (cond.k) {
    case 'always':
      return true;
    case 'self-hp-below':
      return u.hp / u.stats.maxHp < cond.pct / 100;
    case 'ally-hp-below':
      return sim.unitsArr.some((o) => o.alive && o.team === u.team && o !== u && o.hp / o.stats.maxHp < cond.pct / 100);
    case 'enemy-hp-below':
      return sim.unitsArr.some((o) => o.alive && o.team !== u.team && o.kind !== 'npc' && o.hp / o.stats.maxHp < cond.pct / 100);
    case 'self-mana-above':
      return u.stats.maxMana > 0 && u.mana / u.stats.maxMana > cond.pct / 100;
    case 'enemies-within':
      return sim.unitsInRadius(u.pos, cond.radius, (o) => o.team !== u.team && o.kind !== 'npc').length >= cond.count;
    case 'allies-alive':
      return sim.unitsArr.filter((o) => o.alive && o.team === u.team && o.kind === 'hero').length >= cond.count;
    case 'ability-ready':
      return u.abilityReady(cond.slot, sim.time).ok;
    case 'fight-time-gt':
      return sim.time > cond.sec;
    case 'distance-to-focus-gt':
      return focus ? dist(u.pos, focus.pos) > cond.dist : false;
    case 'distance-to-focus-lt':
      return focus ? dist(u.pos, focus.pos) < cond.dist : false;
  }
}

function resolveGambitTarget(sim: Sim, u: Unit, mode: GambitTargetMode, focus: Unit | undefined): { unit?: Unit; point?: Vec2 } {
  switch (mode) {
    case 'self':
      return { unit: u, point: { ...u.pos } };
    case 'focus':
      return focus ? { unit: focus, point: { ...focus.pos } } : {};
    case 'lowest-hp-enemy': {
      let best: Unit | undefined;
      for (const o of sim.unitsArr) {
        if (!o.alive || o.team === u.team || o.kind === 'npc' || o.summary.untargetable) continue;
        if (!o.isVisibleTo(u.team, sim.time)) continue;
        if (!best || o.hp / o.stats.maxHp < best.hp / best.stats.maxHp) best = o;
      }
      return best ? { unit: best, point: { ...best.pos } } : {};
    }
    case 'lowest-hp-ally': {
      let best: Unit | undefined;
      for (const o of sim.unitsArr) {
        if (!o.alive || o.team !== u.team) continue;
        if (!best || o.hp / o.stats.maxHp < best.hp / best.stats.maxHp) best = o;
      }
      return best ? { unit: best, point: { ...best.pos } } : {};
    }
    case 'most-clustered': {
      // evaluate cluster size at each enemy position
      let bestPoint: Vec2 | undefined;
      let bestCount = 0;
      let bestUnit: Unit | undefined;
      for (const o of sim.unitsArr) {
        if (!o.alive || o.team === u.team || o.kind === 'npc') continue;
        const count = sim.unitsInRadius(o.pos, 360, (x) => x.team !== u.team && x.kind !== 'npc').length;
        if (count > bestCount) {
          bestCount = count;
          bestPoint = { ...o.pos };
          bestUnit = o;
        }
      }
      return bestPoint ? { point: bestPoint, unit: bestUnit } : {};
    }
  }
}

function applyAction(sim: Sim, u: Unit, action: GambitAction, focus: Unit | undefined): boolean {
  switch (action.k) {
    case 'cast': {
      const a = u.abilities[action.slot];
      if (!a || !u.abilityReady(action.slot, sim.time).ok) return false;
      const t = a.def.targeting;
      if (t === 'passive' || t === 'aura' || t === 'attack-modifier') return false;
      const tgt = resolveGambitTarget(sim, u, action.targetMode, focus);
      if (t === 'no-target' || t === 'toggle') {
        u.order = { kind: 'cast', slot: action.slot };
        return true;
      }
      if (t === 'unit-target') {
        if (!tgt.unit) return false;
        const affects = a.def.affects ?? 'enemy';
        if (affects === 'enemy' && tgt.unit.team === u.team) return false;
        if (affects === 'ally' && tgt.unit.team !== u.team) return false;
        u.order = { kind: 'cast', slot: action.slot, uid: tgt.unit.uid };
        return true;
      }
      if (!tgt.point) return false;
      u.order = { kind: 'cast', slot: action.slot, point: tgt.point };
      return true;
    }
    case 'use-item': {
      const slot = u.items.findIndex((it) => it && it.defId === action.itemId);
      if (slot < 0) return false;
      const it = u.items[slot]!;
      if (sim.time < it.cooldownUntil || it.charges === 0) return false;
      const tgt = resolveGambitTarget(sim, u, action.targetMode, focus);
      u.order = { kind: 'item', invSlot: slot, uid: tgt.unit?.uid, point: tgt.point };
      return true;
    }
    case 'attack-focus': {
      if (!focus) return false;
      u.order = { kind: 'attack-unit', uid: focus.uid };
      return true;
    }
    case 'retreat': {
      const home = u.ctrl.homePos ?? u.pos;
      if (dist(u.pos, home) < 100) return false;
      u.order = { kind: 'move', point: { ...home } };
      return true;
    }
    case 'hold': {
      u.order = { kind: 'hold' };
      return true;
    }
  }
}

/** Sensible default gambits derived from role tags; the P2 editor replaces these per-hero. */
export function buildDefaultGambit(roles: string[]): GambitRule[] {
  const rules: GambitRule[] = [];
  const isSupport = roles.includes('support');
  if (isSupport) {
    rules.push({ if: [{ k: 'ally-hp-below', pct: 45 }, { k: 'ability-ready', slot: 3 }], then: { k: 'cast', slot: 3, targetMode: 'lowest-hp-ally' } });
  } else {
    rules.push({ if: [{ k: 'enemies-within', radius: 700, count: 2 }, { k: 'ability-ready', slot: 3 }], then: { k: 'cast', slot: 3, targetMode: 'most-clustered' } });
    rules.push({ if: [{ k: 'enemy-hp-below', pct: 99 }, { k: 'ability-ready', slot: 3 }, { k: 'fight-time-gt', sec: 8 }], then: { k: 'cast', slot: 3, targetMode: 'lowest-hp-enemy' } });
  }
  rules.push({ if: [{ k: 'ability-ready', slot: 0 }, { k: 'distance-to-focus-lt', dist: 900 }], then: { k: 'cast', slot: 0, targetMode: 'focus' } });
  rules.push({ if: [{ k: 'ability-ready', slot: 1 }, { k: 'enemies-within', radius: 600, count: 1 }], then: { k: 'cast', slot: 1, targetMode: isSupport ? 'lowest-hp-enemy' : 'most-clustered' } });
  rules.push({ if: [{ k: 'ability-ready', slot: 2 }, { k: 'enemies-within', radius: 500, count: 1 }], then: { k: 'cast', slot: 2, targetMode: 'focus' } });
  if (isSupport) {
    rules.push({ if: [{ k: 'self-hp-below', pct: 30 }], then: { k: 'retreat' } });
  }
  rules.push({ if: [{ k: 'always' }], then: { k: 'attack-focus' } });
  return rules;
}
