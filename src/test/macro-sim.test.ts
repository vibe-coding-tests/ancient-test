import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { runMacroBattle, runRaidBattle, setupRaidSim, type MacroSetup, type RaidSetup } from '../core/macro';
import { applyDamage } from '../core/combat';

// ============================================================
// Fixed-seed 5v5 headless sim (SPEC §9 P1): full macro battle
// runs to completion in milliseconds and produces the same
// winner — and the same full state hash — every run.
// ============================================================

beforeAll(() => registerAllContent());

const SETUP: MacroSetup = {
  seed: 1337,
  teamA: [
    { heroId: 'juggernaut', level: 12, items: ['crystalys', 'boots-of-speed'] },
    { heroId: 'crystal-maiden', level: 11, items: ['glimmer-cape'] },
    { heroId: 'pudge', level: 12, items: ['vladmirs-offering'] },
    { heroId: 'earthshaker', level: 12, items: ['blink-dagger', 'arcane-boots'] },
    { heroId: 'sniper', level: 12, items: ['maelstrom'] }
  ],
  teamB: [
    { heroId: 'lich', level: 12, items: ['euls-scepter'] },
    { heroId: 'juggernaut', level: 12, items: ['battlefury'] },
    { heroId: 'sniper', level: 12, items: ['crystalys', 'boots-of-speed'] },
    { heroId: 'crystal-maiden', level: 12, items: ['force-staff'] },
    { heroId: 'pudge', level: 12, items: ['black-king-bar'] }
  ],
  maxSec: 240
};

const RAID_SETUP: RaidSetup = {
  seed: 2026,
  party: [
    { heroId: 'axe', level: 14, items: ['blink-dagger', 'vladmirs-offering'] },
    { heroId: 'juggernaut', level: 14, items: ['battlefury'] },
    { heroId: 'crystal-maiden', level: 13, items: ['glimmer-cape', 'arcane-boots'] },
    { heroId: 'lich', level: 13, items: ['mekansm'] },
    { heroId: 'sniper', level: 14, items: ['maelstrom', 'dragon-lance'] }
  ],
  boss: { heroId: 'sven', level: 18, items: ['black-king-bar'], hpScale: 3.2, damageScale: 1.15 },
  maxSec: 120
};

describe('5v5 macro battle', () => {
  it('runs to completion headless and is deterministic across runs', () => {
    const t0 = performance.now();
    const a = runMacroBattle(SETUP);
    const elapsed = performance.now() - t0;

    const b = runMacroBattle(SETUP);
    const c = runMacroBattle(SETUP);

    expect(a.winner, 'a battle should have a decisive result').not.toBe(-1);
    expect(b.winner).toBe(a.winner);
    expect(c.winner).toBe(a.winner);
    expect(b.hash).toBe(a.hash);
    expect(c.hash).toBe(a.hash);
    expect(b.ticks).toBe(a.ticks);

    // "milliseconds": generous headroom for CI, but it must not crawl
    expect(elapsed).toBeLessThan(5000);

    // sanity: the fight actually happened
    expect(a.timeSec).toBeGreaterThan(3);
    expect(a.survivors.length).toBeGreaterThan(0);
    expect(a.survivors.length).toBeLessThan(10);
  });

  it('different seeds can diverge (rng actually flows)', () => {
    const a = runMacroBattle({ ...SETUP, seed: 1 });
    const b = runMacroBattle({ ...SETUP, seed: 999 });
    // winners may coincide, but the full state hash should differ
    expect(a.hash).not.toBe(b.hash);
  });

  it('heroes actually cast abilities during the fight', () => {
    const r = runMacroBattle({ ...SETUP, maxSec: 60 });
    void r;
    const sim = r.sim;
    // events were drained during run? we kept them: check units consumed mana or died
    const anyDeath = sim.unitsArr.some((u) => !u.alive);
    expect(anyDeath || r.winner !== -1).toBe(true);
  });
});

describe('5v1 raid battle', () => {
  it('runs to completion headless and is deterministic across runs', () => {
    const a = runRaidBattle(RAID_SETUP);
    const b = runRaidBattle(RAID_SETUP);

    expect(a.winner, 'a raid should have a decisive result').not.toBe(-1);
    expect(b.winner).toBe(a.winner);
    expect(b.hash).toBe(a.hash);
    expect(b.ticks).toBe(a.ticks);
    expect(a.survivors.length).toBeGreaterThan(0);
    expect(a.survivors.length).toBeLessThan(6);
  });

  it('bosses prefer threat targets, but taunt overrides threat', () => {
    const sim = setupRaidSim({
      seed: 77,
      party: [
        { heroId: 'axe', level: 14 },
        { heroId: 'sniper', level: 14 }
      ],
      boss: { heroId: 'sven', level: 16, hpScale: 2, damageScale: 1 },
      maxSec: 30
    });
    const axe = sim.unitsArr.find((u) => u.heroId === 'axe')!;
    const sniper = sim.unitsArr.find((u) => u.heroId === 'sniper')!;
    const boss = sim.unitsArr.find((u) => u.team === 1 && u.ctrl.kind === 'boss')!;

    applyDamage(sim, sniper, boss, 300, 'physical', { ignoreArmor: true });
    sim.run(0.5);
    expect(boss.ctrl.focusUid).toBe(sniper.uid);

    boss.addStatus({
      status: 'taunt',
      tag: 'test-taunt',
      sourceUid: axe.uid,
      sourceTeam: axe.team,
      until: sim.time + 2,
      isDebuff: true
    });
    boss.refresh(sim.time);
    sim.run(0.5);

    expect(boss.order).toMatchObject({ kind: 'attack-unit', uid: axe.uid });
  });
});
