import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { setupMacroSim } from '../core/macro';
import { thinkGambit, evalCondition } from '../core/controllers';
import { enemyCastSeen, incomingDisable, chooseUtilityOrder } from '../core/utility';
import type { GambitRule, MacroHeroSetup, StatusId } from '../core/types';
import type { Unit } from '../core/unit';

// ============================================================
// AI_OVERHAUL A2: reactive grammar (enemy-cast-seen, self-disabled,
// incoming-disable) and item-active consider functions.
// ============================================================

beforeAll(() => registerAllContent());

function macro(teamA: MacroHeroSetup[], teamB: MacroHeroSetup[], seed = 4242) {
  const sim = setupMacroSim({ seed, teamA, teamB, maxSec: 30 });
  return sim;
}

function ultSlot(u: Unit): number {
  return u.abilities.findIndex((a) => a.def.ult);
}

function controlSlot(u: Unit): number {
  const hard = new Set<StatusId>(['stun', 'root', 'hex', 'fear', 'sleep', 'frozen', 'cyclone']);
  return u.abilities.findIndex((a) =>
    (a.def.effects ?? []).some((e) => e.kind === 'status' && hard.has(e.status))
  );
}

describe('reactive reads', () => {
  it('enemy-cast-seen detects an enemy ult in progress', () => {
    const sim = macro([{ heroId: 'sniper', level: 18 }], [{ heroId: 'lich', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0)!;
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;
    hero.pos = { x: 2000, y: 2000 };
    enemy.pos = { x: 2400, y: 2000 };
    sim.rebuildSpatial();

    const slot = ultSlot(enemy);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(enemyCastSeen(sim, hero, 'ult')).toBe(false); // not casting yet

    enemy.cast = { source: 'ability', slot, fireAt: sim.time + 0.5 };
    expect(enemyCastSeen(sim, hero, 'ult')).toBe(true);
    expect(enemyCastSeen(sim, hero, 'any')).toBe(true);
    expect(enemyCastSeen(sim, hero, 'blink')).toBe(false);
  });

  it('incoming-disable detects an enemy mid-cast of a hard disable aimed at the unit', () => {
    const sim = macro([{ heroId: 'sniper', level: 18 }], [{ heroId: 'crystal-maiden', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0)!;
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;
    hero.pos = { x: 2000, y: 2000 };
    enemy.pos = { x: 2300, y: 2000 };
    sim.rebuildSpatial();

    const slot = controlSlot(enemy);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(incomingDisable(sim, hero)).toBe(false);

    enemy.cast = { source: 'ability', slot, fireAt: sim.time + 0.4, targetUid: hero.uid };
    expect(incomingDisable(sim, hero)).toBe(true);
  });

  it('incoming-disable ignores targeted hard disables cast at somebody else', () => {
    const sim = macro([{ heroId: 'sniper', level: 18 }, { heroId: 'sven', level: 18 }], [{ heroId: 'crystal-maiden', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'sniper')!;
    const ally = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'sven')!;
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;
    hero.pos = { x: 2000, y: 2000 };
    ally.pos = { x: 2100, y: 2000 };
    enemy.pos = { x: 2300, y: 2000 };
    sim.rebuildSpatial();

    const slot = controlSlot(enemy);
    expect(slot).toBeGreaterThanOrEqual(0);
    enemy.cast = { source: 'ability', slot, fireAt: sim.time + 0.4, targetUid: ally.uid };

    expect(incomingDisable(sim, hero)).toBe(false);
    expect(incomingDisable(sim, ally)).toBe(true);
  });

  it('the self-disabled condition fires its rule only while disabled', () => {
    const rules: GambitRule[] = [
      { if: [{ k: 'self-disabled' }], then: { k: 'hold' } },
      { if: [{ k: 'always' }], then: { k: 'attack-focus' } }
    ];
    const sim = macro([{ heroId: 'sniper', level: 18, gambits: rules }], [{ heroId: 'sven', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0)!;
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;
    hero.ctrl.focusUid = enemy.uid;

    thinkGambit(sim, hero);
    expect(hero.order.kind).toBe('attack-unit'); // healthy: engage

    hero.addStatus({ status: 'stun', tag: 'test', sourceUid: enemy.uid, sourceTeam: enemy.team, until: sim.time + 2, isDebuff: true });
    hero.refresh(sim.time);
    thinkGambit(sim, hero);
    expect(hero.order.kind).toBe('hold'); // disabled: the reaction fires
  });

  // SWAP_COMBAT_OVERHAUL §3.5/§8.7: the reactive grammar points at the Tag Gauge
  // and the live combo state so an ally can route the chain.
  it('tag-in-ready reads the mirrored Tag Gauge on the unit', () => {
    const sim = macro([{ heroId: 'sniper', level: 18 }], [{ heroId: 'sven', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0)!;

    hero.tagGaugeReadyAt = undefined; // a fielded raid hero with no gauge stamp reads ready
    expect(evalCondition(sim, hero, { k: 'tag-in-ready' }, undefined)).toBe(true);

    hero.tagGaugeReadyAt = sim.time + 5; // gauge on cooldown → not ready
    expect(evalCondition(sim, hero, { k: 'tag-in-ready' }, undefined)).toBe(false);

    hero.tagGaugeReadyAt = sim.time - 0.1; // re-armed
    expect(evalCondition(sim, hero, { k: 'tag-in-ready' }, undefined)).toBe(true);
  });

  it('combo-setup-active sees a setup state (CC, slow, or soak) on the focus', () => {
    const sim = macro([{ heroId: 'lina', level: 18 }], [{ heroId: 'sven', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0)!;
    const focus = sim.unitsArr.find((u) => u.team === 1)!;

    // a clean focus has no setup
    expect(evalCondition(sim, hero, { k: 'combo-setup-active' }, focus)).toBe(false);
    expect(evalCondition(sim, hero, { k: 'combo-setup-active' }, undefined)).toBe(false);

    // a Lockdown setup (root) lights it up
    focus.addStatus({ status: 'root', tag: 'setup', sourceUid: hero.uid, sourceTeam: hero.team, until: sim.time + 1.5, isDebuff: true });
    focus.refresh(sim.time);
    expect(evalCondition(sim, hero, { k: 'combo-setup-active' }, focus)).toBe(true);

    // a lingering element aura (a Soak) also counts, even with no CC
    focus.removeStatusWhere(() => true);
    focus.refresh(sim.time);
    expect(evalCondition(sim, hero, { k: 'combo-setup-active' }, focus)).toBe(false);
    focus.elementAuras.hydro = { gauge: 1, until: sim.time + 3, sourceUid: hero.uid };
    expect(evalCondition(sim, hero, { k: 'combo-setup-active' }, focus)).toBe(true);
  });
});

describe('item-active considers', () => {
  it('glimmer-cape saves a wounded ally under fire', () => {
    const teamA: MacroHeroSetup[] = [
      { heroId: 'crystal-maiden', level: 18, items: ['glimmer-cape'] },
      { heroId: 'sven', level: 18 }
    ];
    const sim = macro(teamA, [{ heroId: 'lich', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'crystal-maiden')!;
    const ally = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'sven')!;
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;

    hero.pos = { x: 2000, y: 2000 };
    ally.pos = { x: 2200, y: 2000 };
    enemy.pos = { x: 3200, y: 2000 }; // low-value, far
    ally.hp = ally.stats.maxHp * 0.15;
    ally.lastEnemyDamageAt = sim.time; // actively under fire
    sim.rebuildSpatial();

    const order = chooseUtilityOrder(sim, hero, enemy);
    expect(order?.kind).toBe('item');
    if (order?.kind === 'item') {
      expect(order.uid).toBe(ally.uid);
      expect(hero.items[order.invSlot]?.defId).toBe('glimmer-cape');
    }
  });

  it('mekansm fires when several allies are wounded', () => {
    const teamA: MacroHeroSetup[] = [
      { heroId: 'crystal-maiden', level: 18, items: ['mekansm'] },
      { heroId: 'sven', level: 18 },
      { heroId: 'juggernaut', level: 18 }
    ];
    const sim = macro(teamA, [{ heroId: 'lich', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'crystal-maiden')!;
    const a1 = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'sven')!;
    const a2 = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'juggernaut')!;
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;

    hero.pos = { x: 2000, y: 2000 };
    a1.pos = { x: 2120, y: 2000 };
    a2.pos = { x: 2000, y: 2120 };
    enemy.pos = { x: 5400, y: 2000 }; // nothing to nuke
    a1.hp = a1.stats.maxHp * 0.55;
    a2.hp = a2.stats.maxHp * 0.55;
    sim.rebuildSpatial();

    const order = chooseUtilityOrder(sim, hero, enemy);
    expect(order?.kind).toBe('item');
    if (order?.kind === 'item') expect(hero.items[order.invSlot]?.defId).toBe('mekansm');
  });

  it('boss-controlled units use survival item actives deliberately', () => {
    const sim = macro([{ heroId: 'sniper', level: 18, items: ['black-king-bar'] }], [{ heroId: 'lich', level: 18 }]);
    const hero = sim.unitsArr.find((u) => u.team === 0)!;
    hero.ctrl = { kind: 'boss', threat: {} };
    hero.abilities.forEach((a) => (a.level = 0)); // isolate item desire from ability scoring
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;
    enemy.pos = { x: hero.pos.x + 200, y: hero.pos.y };
    enemy.cast = { source: 'ability', slot: ultSlot(enemy), fireAt: sim.time + 0.5 };
    sim.rebuildSpatial();

    const order = chooseUtilityOrder(sim, hero, enemy);
    expect(order?.kind).toBe('item');
    if (order?.kind === 'item') expect(hero.items[order.invSlot]?.defId).toBe('black-king-bar');
  });

  it('uses representative non-whitelisted item actives via intent fallback', () => {
    const cases = [
      { itemId: 'rod-of-atos', target: 'enemy', pressured: false },
      { itemId: 'diffusal-blade', target: 'enemy', pressured: false },
      { itemId: 'scythe-of-vyse', target: 'enemy', pressured: false },
      { itemId: 'blink-dagger', target: 'point', pressured: true }
    ] as const;

    for (const c of cases) {
      const sim = macro([{ heroId: 'crystal-maiden', level: 18, items: [c.itemId] }], [{ heroId: 'sniper', level: 18 }], 9000 + c.itemId.length);
      const hero = sim.unitsArr.find((u) => u.team === 0)!;
      const enemy = sim.unitsArr.find((u) => u.team === 1)!;
      hero.abilities.forEach((a) => (a.level = 0)); // isolate item scoring
      hero.mana = hero.stats.maxMana;
      hero.pos = { x: 2000, y: 2000 };
      enemy.pos = c.pressured ? { x: 2200, y: 2000 } : { x: 2500, y: 2000 };
      if (c.pressured) hero.hp = hero.stats.maxHp * 0.2;
      sim.rebuildSpatial();

      const order = chooseUtilityOrder(sim, hero, enemy);
      expect(order?.kind, c.itemId).toBe('item');
      if (order?.kind === 'item') {
        expect(hero.items[order.invSlot]?.defId).toBe(c.itemId);
        if (c.target === 'enemy') expect(order.uid).toBe(enemy.uid);
        else expect(order.point).toBeDefined();
      }
    }
  });
});
