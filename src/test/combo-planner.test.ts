import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { setupMacroSim } from '../core/macro';
import { planTeamCombos, planUnitCombo } from '../core/combo-planner';
import { chooseUtilityOrder } from '../core/utility';
import type { AbilityDef, MacroHeroSetup } from '../core/types';
import type { Unit } from '../core/unit';

beforeAll(() => registerAllContent());

const TEST_PAYOFF_ULT: AbilityDef = {
  id: 'test-payoff-ult',
  name: 'Payoff Ult',
  targeting: 'ground-aoe',
  ult: true,
  castRange: 350,
  castPoint: 0,
  manaCost: [100],
  cooldown: [40],
  values: { damage: [320], radius: [360] },
  effects: [{ kind: 'damage', dtype: 'magical', amount: 'damage', target: 'enemies-in-radius', radius: 'radius' }],
  vfx: { archetype: 'ground-aoe', color: '#ff8a3a', scale: 1 },
  anim: 'staff-cast',
  sound: 'fire'
};

function installAbilities(u: Unit, defs: AbilityDef[]): void {
  u.abilities = defs.map((def) => ({
    def,
    level: 1,
    cooldownUntil: 0,
    charges: -1,
    nextChargeAt: 0,
    toggled: false,
    nextToggleTickAt: 0
  }));
}

function simWith(teamA: MacroHeroSetup[], teamB: MacroHeroSetup[] = [{ heroId: 'sven', level: 18 }]) {
  const sim = setupMacroSim({ seed: 5150, teamA, teamB, maxSec: 30 });
  const hero = sim.unitsArr.find((u) => u.team === 0 && u.kind === 'hero')!;
  const focus = sim.unitsArr.find((u) => u.team === 1 && u.kind === 'hero')!;
  hero.pos = { x: 2000, y: 2000 };
  focus.pos = { x: 2800, y: 2000 };
  sim.rebuildSpatial();
  return { sim, hero, focus };
}

describe('single-unit combo planner', () => {
  it('uses Blink as the setup step when it unlocks a ready payoff', () => {
    const { sim, hero, focus } = simWith([{ heroId: 'earthshaker', level: 18, items: ['blink-dagger', 'black-king-bar'] }]);
    installAbilities(hero, [TEST_PAYOFF_ULT]);
    hero.mana = hero.stats.maxMana;

    const plan = planUnitCombo(sim, hero, focus);
    expect(plan?.nextStep).toMatchObject({ kind: 'item', slot: 0, role: 'enabler' });
    expect(plan?.steps.at(-1)).toMatchObject({ kind: 'cast', slot: 0, role: 'payoff' });
    expect(chooseUtilityOrder(sim, hero, focus)).toMatchObject({ kind: 'item', invSlot: 0 });
  });

  it('does not spend BKB when the Blink plan has already died', () => {
    const { sim, hero, focus } = simWith([{ heroId: 'earthshaker', level: 18, items: ['blink-dagger', 'black-king-bar'] }]);
    installAbilities(hero, [TEST_PAYOFF_ULT]);
    focus.alive = false;

    expect(planUnitCombo(sim, hero, focus)).toBeNull();
    expect(chooseUtilityOrder(sim, hero, focus)).not.toMatchObject({ kind: 'item', invSlot: 1 });
  });

  it('casts Veil before Dagon and holds the nuke until setup lands', () => {
    const { sim, hero, focus } = simWith([{ heroId: 'zeus', level: 18, items: ['dagon', 'veil-of-discord'] }]);
    installAbilities(hero, []);
    focus.pos = { x: 2450, y: 2000 };
    focus.externalMods.magicResistPct = 100;
    focus.markStatsDirty();
    focus.refresh(sim.time);
    sim.rebuildSpatial();

    const plan = planUnitCombo(sim, hero, focus);
    expect(plan?.nextStep).toMatchObject({ kind: 'item', slot: 1, role: 'amplifier' });
    expect(chooseUtilityOrder(sim, hero, focus)).toMatchObject({ kind: 'item', invSlot: 1 });
  });

  it('aborts when the target leaves payoff range and no opener can bridge it', () => {
    const { sim, hero, focus } = simWith([{ heroId: 'zeus', level: 18, items: ['veil-of-discord', 'dagon'] }]);
    installAbilities(hero, []);
    focus.pos = { x: 5200, y: 2000 };
    sim.rebuildSpatial();

    expect(planUnitCombo(sim, hero, focus)).toBeNull();
  });

  it('replays identical plans for identical seeds and state', () => {
    const build = () => {
      const ctx = simWith([{ heroId: 'zeus', level: 18, items: ['dagon', 'veil-of-discord'] }]);
      installAbilities(ctx.hero, []);
      ctx.focus.pos = { x: 2450, y: 2000 };
      ctx.sim.rebuildSpatial();
      return ctx;
    };
    const a = build();
    const b = build();

    expect(planUnitCombo(a.sim, a.hero, a.focus)).toEqual(planUnitCombo(b.sim, b.hero, b.focus));
    expect(chooseUtilityOrder(a.sim, a.hero, a.focus)).toEqual(chooseUtilityOrder(b.sim, b.hero, b.focus));
  });
});

describe('team combo planner', () => {
  it('assigns one save holder so two supports do not double-save', () => {
    const sim = setupMacroSim({
      seed: 6100,
      teamA: [
        { heroId: 'lich', level: 18, items: ['glimmer-cape'] },
        { heroId: 'crystal-maiden', level: 18, items: ['glimmer-cape'] },
        { heroId: 'sven', level: 18 }
      ],
      teamB: [{ heroId: 'axe', level: 18 }],
      maxSec: 30
    });
    const supports = sim.unitsArr.filter((u) => u.team === 0 && (u.heroId === 'lich' || u.heroId === 'crystal-maiden'));
    const ally = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'sven')!;
    const enemy = sim.unitsArr.find((u) => u.team === 1)!;
    for (const support of supports) {
      installAbilities(support, []);
      support.pos = { x: 2000, y: 2000 + support.uid * 20 };
    }
    ally.pos = { x: 2120, y: 2000 };
    ally.hp = ally.stats.maxHp * 0.3;
    ally.lastEnemyDamageAt = sim.time;
    enemy.pos = { x: 2300, y: 2000 };
    sim.rebuildSpatial();

    const tm = sim.teamMind(0);
    expect(tm.saveHolderUid).not.toBeNull();
    const orders = supports.map((support) => ({ support, order: chooseUtilityOrder(sim, support, enemy) }));
    const saveOrders = orders.filter(({ order }) => order?.kind === 'item');
    expect(saveOrders).toHaveLength(1);
    expect(saveOrders[0].support.uid).toBe(tm.saveHolderUid);
  });

  it('sequences a disabler lockdown before a nuker payoff on the shared focus', () => {
    const sim = setupMacroSim({
      seed: 6200,
      teamA: [
        { heroId: 'lion', level: 18, items: ['rod-of-atos'] },
        { heroId: 'zeus', level: 18, items: ['dagon'] }
      ],
      teamB: [{ heroId: 'sven', level: 18 }],
      maxSec: 30
    });
    const disabler = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'lion')!;
    const nuker = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'zeus')!;
    const focus = sim.unitsArr.find((u) => u.team === 1)!;
    installAbilities(disabler, []);
    installAbilities(nuker, []);
    disabler.pos = { x: 2000, y: 2000 };
    nuker.pos = { x: 2000, y: 2060 };
    focus.pos = { x: 2450, y: 2000 };
    sim.rebuildSpatial();

    const teamPlan = planTeamCombos(sim, 0, focus);
    expect(teamPlan.lockdownUid).toBe(disabler.uid);
    expect(teamPlan.chains[0]?.nextStep).toMatchObject({ unitUid: disabler.uid, role: 'enabler' });
    expect(chooseUtilityOrder(sim, disabler, focus)).toMatchObject({ kind: 'item', invSlot: 0 });
    expect(chooseUtilityOrder(sim, nuker, focus)).not.toMatchObject({ kind: 'item', invSlot: 0 });

    focus.addStatus({ status: 'root', tag: 'test-root', sourceUid: disabler.uid, sourceTeam: disabler.team, until: sim.time + 2, isDebuff: true });
    focus.refresh(sim.time);
    expect(chooseUtilityOrder(sim, nuker, focus)).toMatchObject({ kind: 'item', invSlot: 0 });
  });

  it('keeps team combo planning deterministic', () => {
    const build = () => {
      const sim = setupMacroSim({
        seed: 6300,
        teamA: [
          { heroId: 'lion', level: 18, items: ['rod-of-atos'] },
          { heroId: 'zeus', level: 18, items: ['dagon'] }
        ],
        teamB: [{ heroId: 'sven', level: 18 }],
        maxSec: 30
      });
      const disabler = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'lion')!;
      const nuker = sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'zeus')!;
      const focus = sim.unitsArr.find((u) => u.team === 1)!;
      installAbilities(disabler, []);
      installAbilities(nuker, []);
      disabler.pos = { x: 2000, y: 2000 };
      nuker.pos = { x: 2000, y: 2060 };
      focus.pos = { x: 2450, y: 2000 };
      sim.rebuildSpatial();
      return { sim, focus };
    };
    const a = build();
    const b = build();
    expect(planTeamCombos(a.sim, 0, a.focus)).toEqual(planTeamCombos(b.sim, 0, b.focus));
  });
});
