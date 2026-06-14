import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { xpForLevel } from '../core/stats';
import { freshEchoProgress } from '../core/echo';
import { REG } from '../core/registry';
import { LiveRaid } from '../systems/raid-session';
import { ALL_RAIDS } from '../data/raids';
import { Game, newGameSave } from '../systems/game';
import type { GameSave, MacroHeroSetup } from '../core/types';

// ============================================================
// COMBAT_OVERHAUL §3.4 (C4): the combat-readability snapshot the HUD turns into
// cast bars, a boss aggro/threat marker, the shared-focus indicator, and the
// "ult ready → seize" prompt. Pure read over the active sim.
// ============================================================

beforeAll(() => registerAllContent());

const PARTY: MacroHeroSetup[] = [
  { heroId: 'juggernaut', level: 30, items: ['battlefury', 'butterfly'] },
  { heroId: 'sven', level: 30, items: ['black-king-bar', 'assault-cuirass'] },
  { heroId: 'lich', level: 30, items: ['mekansm', 'glimmer-cape'] },
  { heroId: 'crystal-maiden', level: 30, items: ['glimmer-cape', 'arcane-boots'] },
  { heroId: 'sniper', level: 30, items: ['maelstrom', 'dragon-lance'] }
];

function soloSave(): GameSave {
  const save = newGameSave('juggernaut');
  save.party = ['juggernaut'];
  save.recruited = ['juggernaut'];
  save.roster = [{
    heroId: 'juggernaut', level: 20, xp: xpForLevel(20),
    items: [null, null, null, null, null, null], neutralSlot: null,
    talentPicks: [0, 0, 0, 0], gambits: [], echo: freshEchoProgress(),
    facetIdx: 0, hpPct: 1, manaPct: 1, abilityCooldowns: [0, 0, 0, 0], tagGaugeReadyAt: 0
  }];
  save.badges = [...REG.gyms.values()].map((g) => g.badgeId);
  return save;
}

describe('combatReadout — overworld pieces', () => {
  it('surfaces a cast bar for a unit mid-cast with a sane progress fraction', () => {
    const g = Game.headless(soloSave());
    const hero = g.activeUnit()!;
    const def = hero.abilities[0].def;
    hero.cast = { source: 'ability', slot: 0, fireAt: g.sim.time + 0.5 };
    const r = g.combatReadout();
    const bar = r.castBars.find((b) => b.uid === hero.uid);
    expect(bar).toBeTruthy();
    expect(bar!.ability).toBe(def.name);
    expect(bar!.pct).toBeGreaterThanOrEqual(0);
    expect(bar!.pct).toBeLessThanOrEqual(1);
    expect(bar!.enemy).toBe(false);
  });

  it('lists an ult-ready hero for the seize prompt', () => {
    const g = Game.headless(soloSave());
    const hero = g.activeUnit()!;
    // ensure the ult is learned and off cooldown
    hero.abilities[3].level = Math.max(1, hero.abilities[3].level);
    hero.abilities[3].cooldownUntil = 0;
    hero.mana = hero.stats.maxMana;
    const r = g.combatReadout();
    expect(r.ultReady.some((u) => u.uid === hero.uid)).toBe(true);
  });
});

describe('combatReadout — live raid overlay (C4)', () => {
  it('reports a live overlay with a boss threat marker', () => {
    const g = Game.headless(soloSave());
    g.liveRaid = new LiveRaid(ALL_RAIDS[0], PARTY, 'normal', 24680);
    // step into the fight so the boss engages a target
    let sawBossTarget = false;
    let sawCastBar = false;
    for (let i = 0; i < 200 && !(sawBossTarget && sawCastBar); i++) {
      g.liveRaid.step(1 / 30);
      const r = g.combatReadout();
      expect(r.live).toBe(true);
      if (r.bossThreat) {
        expect(r.bossThreat.bossName.length).toBeGreaterThan(0);
        if (r.bossThreat.targetName) sawBossTarget = true;
      }
      if (r.castBars.length > 0) sawCastBar = true;
    }
    expect(sawBossTarget, 'boss should acquire a visible target').toBe(true);
    expect(sawCastBar, 'a cast bar should appear during the fight').toBe(true);
  });
});
