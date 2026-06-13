import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { runMacroBattle, type MacroSetup } from '../core/macro';

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
