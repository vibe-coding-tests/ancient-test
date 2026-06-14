import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { REG } from '../core/registry';
import { runMacroBattle } from '../core/macro';
import type { GambitRule, MacroHeroSetup } from '../core/types';

// ============================================================
// AI_OVERHAUL A3: a default five (new role-true defaults + scorer)
// should beat the old defaults on a fixed-seed mirror sweep.
// COMBAT_OVERHAUL.md C2: "A default five built by buildDefaultGambit
// beats a baseline opponent more often than the old defaults."
// ============================================================

beforeAll(() => registerAllContent());

// The pre-A3 defaults, captured verbatim as the baseline opponent: ability use
// by fixed slot index, ending in an unconditional focus-fire that suppressed any
// scorer fallback.
function oldDefaultGambit(roles: string[]): GambitRule[] {
  const rules: GambitRule[] = [];
  const isSupport = roles.includes('support');
  rules.push({ if: [{ k: 'standing-in-zone' }], then: { k: 'dodge-zones' } });
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
  rules.push({ if: [{ k: 'always' }], then: { k: 'focus-fire' } });
  return rules;
}

const ROSTER = ['sven', 'sniper', 'crystal-maiden', 'juggernaut', 'lich'];

// gambits omitted => setupMacroSim uses the live (new) buildDefaultGambit.
function newTeam(): MacroHeroSetup[] {
  return ROSTER.map((heroId) => ({ heroId, level: 16 }));
}
function oldTeam(): MacroHeroSetup[] {
  return ROSTER.map((heroId) => ({ heroId, level: 16, gambits: oldDefaultGambit(REG.hero(heroId).roles) }));
}

describe('role-true default gambit sweep', () => {
  it('the new defaults out-win the old defaults across a seed sweep', () => {
    let newWins = 0;
    let oldWins = 0;
    let draws = 0;
    const N = 16;
    for (let seed = 1; seed <= N; seed++) {
      // same seed, brains swapped between sides, to cancel positional bias.
      const r1 = runMacroBattle({ seed, teamA: newTeam(), teamB: oldTeam(), maxSec: 60 });
      if (r1.winner === 0) newWins++; else if (r1.winner === 1) oldWins++; else draws++;

      const r2 = runMacroBattle({ seed, teamA: oldTeam(), teamB: newTeam(), maxSec: 60 });
      if (r2.winner === 1) newWins++; else if (r2.winner === 0) oldWins++; else draws++;
    }
    // 24 matches: the upgraded brain should take a clear majority of decisive games
    // (observed 16-8). A margin gate makes this a real regression guard, not a coin flip.
    expect(newWins + oldWins + draws).toBe(2 * N);
    expect(newWins).toBeGreaterThan(oldWins);
    expect(newWins - oldWins).toBeGreaterThanOrEqual(4);
  });

  it('a mirror battle is deterministic (run-twice agreement)', () => {
    const a = runMacroBattle({ seed: 7, teamA: newTeam(), teamB: oldTeam(), maxSec: 60 });
    const b = runMacroBattle({ seed: 7, teamA: newTeam(), teamB: oldTeam(), maxSec: 60 });
    expect(b.hash).toBe(a.hash);
    expect(b.winner).toBe(a.winner);
  });
});
