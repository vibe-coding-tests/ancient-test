import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import { applyDamage } from '../core/combat';
import { mergeCreeps, validateEntourage, canStartCapture } from '../core/capture';
import { TUNING } from '../data/tuning';
import type { CreepInstanceSave } from '../core/types';

beforeAll(() => registerAllContent());

// ============================================================
// Capture + merge unit tests (SPEC §9 P1).
// ============================================================

describe('capture', () => {
  function captureScenario(hpPct: number, interrupt: 'none' | 'damage' | 'walk' = 'none') {
    const sim = new Sim({ seed: 7, bounds: { w: 4000, h: 4000 } });
    sim.events.captureAll = true;
    const hero = sim.spawnHero(REG.hero('juggernaut'), { team: 0, pos: { x: 1000, y: 1000 }, level: 5, ctrl: { kind: 'player' } });
    const kobold = sim.spawnCreep(REG.creep('kobold'), { team: 1, pos: { x: 1150, y: 1000 }, wild: true });
    kobold.ctrl = { kind: 'none' }; // hold still for the lab test
    kobold.hp = kobold.stats.maxHp * hpPct;
    sim.order(hero.uid, { kind: 'capture', uid: kobold.uid });
    return { sim, hero, kobold, interrupt };
  }

  it('captures a weakened kobold after the full channel', () => {
    const { sim, kobold } = captureScenario(0.25);
    sim.run(TUNING.capture.small.channelSec + 0.5);
    const done = sim.events.history.find((e) => e.t === 'capture-complete');
    expect(done).toBeDefined();
    expect((done as { creepId: string }).creepId).toBe('kobold');
    expect(sim.unit(kobold.uid)).toBeUndefined(); // removed from world
  });

  it('refuses to start above the HP threshold (deterministic, no RNG)', () => {
    expect(canStartCapture('small', 31, 100)).toBe(false);
    expect(canStartCapture('small', 29, 100)).toBe(true);
    const { sim } = captureScenario(0.8);
    sim.run(1);
    expect(sim.events.history.find((e) => e.t === 'capture-start')).toBeUndefined();
  });

  it('damage to the channeler interrupts the bind', () => {
    const { sim, hero } = captureScenario(0.25);
    sim.run(0.6); // channel underway
    expect(sim.events.history.find((e) => e.t === 'capture-start')).toBeDefined();
    // smack the channeler through the real damage pipeline
    const enemy = sim.spawnHero(REG.hero('sniper'), { team: 1, pos: { x: 1300, y: 1000 }, level: 10, ctrl: { kind: 'none' } });
    applyDamage(sim, enemy, hero, 50, 'physical');
    sim.run(TUNING.capture.small.channelSec + 1);
    expect(sim.events.history.find((e) => e.t === 'capture-interrupt')).toBeDefined();
    expect(sim.events.history.find((e) => e.t === 'capture-complete')).toBeUndefined();
  });

  it('higher tiers need lower HP and a longer channel', () => {
    expect(TUNING.capture.ancient.hpPct).toBeLessThan(TUNING.capture.small.hpPct);
    expect(TUNING.capture.ancient.channelSec).toBeGreaterThan(TUNING.capture.small.channelSec);
  });
});

describe('merge (3 copies -> star upgrade)', () => {
  const inst = (id: string, creepId: string, star: 1 | 2 | 3 = 1): CreepInstanceSave => ({ uid: id, creepId, star });

  it('merges three 1-stars into a 2-star', () => {
    const { list, merges } = mergeCreeps([inst('a', 'kobold'), inst('b', 'kobold'), inst('c', 'kobold')]);
    expect(list.length).toBe(1);
    expect(list[0].star).toBe(2);
    expect(merges).toEqual([{ creepId: 'kobold', toStar: 2 }]);
  });

  it('does not merge different creeps or different stars', () => {
    const { list, merges } = mergeCreeps([
      inst('a', 'kobold'), inst('b', 'kobold'), inst('c', 'hill-troll'),
      inst('d', 'kobold', 2)
    ]);
    expect(list.length).toBe(4);
    expect(merges.length).toBe(0);
  });

  it('cascades: nine 1-stars -> one 3-star', () => {
    const nine = Array.from({ length: 9 }, (_, i) => inst(`k${i}`, 'kobold'));
    const { list } = mergeCreeps(nine);
    expect(list.length).toBe(1);
    expect(list[0].star).toBe(3);
  });

  it('caps at 3 stars', () => {
    const { list } = mergeCreeps([inst('a', 'kobold', 3), inst('b', 'kobold', 3), inst('c', 'kobold', 3)]);
    expect(list.length).toBe(3);
  });

  it('star creeps hit harder in the sim', () => {
    const sim = new Sim({ seed: 3, bounds: { w: 2000, h: 2000 } });
    const one = sim.spawnCreep(REG.creep('kobold'), { team: 0, pos: { x: 500, y: 500 }, star: 1 });
    const three = sim.spawnCreep(REG.creep('kobold'), { team: 0, pos: { x: 700, y: 500 }, star: 3 });
    expect(three.stats.maxHp).toBeGreaterThan(one.stats.maxHp * 2.5);
    expect(three.stats.damage).toBeGreaterThan(one.stats.damage * 2);
  });
});

describe('entourage rules', () => {
  const tierOf = (creepId: string) => REG.creep(creepId).tier;
  const storage: CreepInstanceSave[] = [
    { uid: 'a', creepId: 'kobold', star: 1 },
    { uid: 'b', creepId: 'hellbear', star: 1 },
    { uid: 'c', creepId: 'granite-golem', star: 1 },
    { uid: 'd', creepId: 'granite-golem', star: 1 },
    { uid: 'e', creepId: 'kobold', star: 1, faintedFor: 30 }
  ];

  it('allows up to 3 with at most one ancient', () => {
    expect(validateEntourage(['a', 'b', 'c'], storage, tierOf).ok).toBe(true);
    expect(validateEntourage(['a', 'b', 'c', 'd'], storage, tierOf).ok).toBe(false);
    expect(validateEntourage(['c', 'd'], storage, tierOf).ok).toBe(false);
  });

  it('rejects fainted creeps', () => {
    expect(validateEntourage(['e'], storage, tierOf).ok).toBe(false);
  });
});
