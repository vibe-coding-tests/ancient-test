import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { runDomainEncounter } from '../core/macro';
import { xpForLevel } from '../core/stats';
import { freshEchoProgress } from '../core/echo';
import { TUNING } from '../data/tuning';
import { REG } from '../core/registry';
import { Game, newGameSave } from '../systems/game';
import type { GambitRule, GameSave, MacroHeroSetup, RaidBossSetup } from '../core/types';

// ============================================================
// GAMEPLAY_OVERHAUL §3.5 (Pillar P5): domains + ley lines + resin.
// Domains run on the raid runner with a run-wide disorder rule and an
// element entry/clear gate; ley-line outcrops pay a resin-gated bump.
// ============================================================

beforeAll(() => registerAllContent());

const AGGRO: GambitRule[] = [
  { if: [{ k: 'ability-ready', slot: 3 }, { k: 'fight-time-gt', sec: 2 }], then: { k: 'cast', slot: 3, targetMode: 'most-clustered' } },
  { if: [{ k: 'ability-ready', slot: 0 }], then: { k: 'cast', slot: 0, targetMode: 'focus' } },
  { if: [{ k: 'ability-ready', slot: 1 }, { k: 'enemies-within', radius: 700, count: 1 }], then: { k: 'cast', slot: 1, targetMode: 'most-clustered' } },
  { if: [{ k: 'ability-ready', slot: 2 }], then: { k: 'cast', slot: 2, targetMode: 'focus' } },
  { if: [{ k: 'always' }], then: { k: 'attack-focus' } }
];

const STRONG_PARTY: MacroHeroSetup[] = [
  { heroId: 'juggernaut', level: 30, items: ['battlefury', 'butterfly', 'black-king-bar'] },
  { heroId: 'sven', level: 30, items: ['black-king-bar', 'assault-cuirass'] },
  { heroId: 'lich', level: 30, items: ['mekansm', 'glimmer-cape'] },
  { heroId: 'crystal-maiden', level: 30, items: ['glimmer-cape', 'arcane-boots'] },
  { heroId: 'sniper', level: 30, items: ['maelstrom', 'dragon-lance'] }
];

const WEAK_BOSS: RaidBossSetup = { heroId: 'sven', level: 24, items: ['assault-cuirass'], hpScale: 0.6, damageScale: 0.2, enrageSec: 90 };
const TANKY_BOSS: RaidBossSetup = { heroId: 'sven', level: 30, items: ['assault-cuirass'], hpScale: 6, damageScale: 0.2, enrageSec: 120 };

describe('runDomainEncounter (core)', () => {
  it("clears on 'defeat' when the party wins and counts reactions", () => {
    const r = runDomainEncounter({
      seed: 13, party: STRONG_PARTY, boss: WEAK_BOSS,
      disorder: { tick: { element: 'pyro', interval: 4 } },
      clear: { kind: 'defeat' }
    });
    expect(r.winner).toBe(0);
    expect(r.cleared).toBe(true);
    expect(r.reactions).toBeGreaterThanOrEqual(0);
  });

  it('applies the disorder statmod aura to the party for the run', () => {
    const base = runDomainEncounter({ seed: 21, party: STRONG_PARTY, boss: WEAK_BOSS, clear: { kind: 'defeat' } });
    const slowed = runDomainEncounter({ seed: 21, party: STRONG_PARTY, boss: WEAK_BOSS, disorder: { mods: { moveSpeedPct: -40 } }, clear: { kind: 'defeat' } });
    const jugBase = base.sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'juggernaut')!;
    const jugSlow = slowed.sim.unitsArr.find((u) => u.team === 0 && u.heroId === 'juggernaut')!;
    expect(jugBase.externalMods['moveSpeedPct'] ?? 0).toBe(0);
    expect(jugSlow.externalMods['moveSpeedPct'] ?? 0).toBeLessThanOrEqual(-40);
  });

  it("enforces 'time-limit' and 'reaction-count' clear conditions", () => {
    const slow = runDomainEncounter({ seed: 7, party: STRONG_PARTY, boss: TANKY_BOSS, maxSec: 60, clear: { kind: 'time-limit', param: 1 } });
    expect(slow.winner).toBe(0);          // party still wins the fight
    expect(slow.cleared).toBe(false);     // but not under the 1s clear bar

    const fast = runDomainEncounter({ seed: 7, party: STRONG_PARTY, boss: TANKY_BOSS, maxSec: 60, clear: { kind: 'time-limit', param: 999 } });
    expect(fast.cleared).toBe(true);

    const tooFew = runDomainEncounter({ seed: 7, party: STRONG_PARTY, boss: WEAK_BOSS, clear: { kind: 'reaction-count', param: 99999 } });
    expect(tooFew.winner).toBe(0);
    expect(tooFew.cleared).toBe(false);

    const any = runDomainEncounter({ seed: 7, party: STRONG_PARTY, boss: WEAK_BOSS, clear: { kind: 'reaction-count', param: 0 } });
    expect(any.cleared).toBe(true);
  });
});

// --- headless Game scaffolding (mirrors raids.test.ts) ---
function rosterItems(ids: string[]): GameSave['roster'][number]['items'] {
  const slots: GameSave['roster'][number]['items'] = [null, null, null, null, null, null];
  ids.slice(0, 6).forEach((id, i) => (slots[i] = { id }));
  return slots;
}

function fullPartySave(): GameSave {
  const heroes = STRONG_PARTY;
  const save = newGameSave(heroes[0].heroId);
  save.regionId = 'tranquil-vale';
  save.party = heroes.map((t) => t.heroId);
  save.recruited = heroes.map((t) => t.heroId);
  save.roster = heroes.map((t) => ({
    heroId: t.heroId,
    level: 30,
    xp: xpForLevel(30),
    items: rosterItems(t.items ?? []),
    neutralSlot: null,
    talentPicks: [0, 0, 0, 0],
    gambits: AGGRO,
    echo: freshEchoProgress(),
    facetIdx: 0,
    hpPct: 1,
    manaPct: 1,
    abilityCooldowns: [0, 0, 0, 0],
    tagGaugeReadyAt: 0
  }));
  save.badges = [...REG.gyms.values()].map((g) => g.badgeId);
  return save;
}

describe('Game.runDomain', () => {
  afterEach(() => { TUNING.resin.enabled = false; });

  it('clears the authored Emberfall Rift domain and drops curated loot', () => {
    const g = Game.headless(fullPartySave());
    const goldBefore = g.gold;
    const r = g.runDomain('emberfall-rift');
    expect(r.cleared).toBe(true);
    expect(r.won).toBe(true);
    // resin disabled by default → full loot path (ground items, not dry gold)
    expect(g.gold).toBe(goldBefore);
    expect(g.groundItemDrops.length).toBeGreaterThan(0);
  });

  it('enforces an element entry gate', () => {
    REG.registerDomain({
      id: 'test-dendro-gate', name: 'Dendro Gate', title: 'Test', regionId: 'tranquil-vale', element: 'dendro',
      disorder: { note: 'test' }, entry: { requiresElementHero: 'dendro' },
      clear: { kind: 'defeat' }, encounter: WEAK_BOSS, resinCost: 10,
      loot: { guaranteed: ['ultimate-orb'], assembledPool: [], dropPct: { normal: 0.1, nightmare: 0.2, hell: 0.3 }, pity: 8 },
      dialogue: ['a', 'b']
    });
    const g = Game.headless(fullPartySave());
    const r = g.runDomain('test-dendro-gate');
    expect(r.won).toBe(false);
    expect(r.cleared).toBe(false);
    expect(g.availableDomains().find((d) => d.def.id === 'test-dendro-gate')?.ready).toBe(false);
  });

  it('soft-paces with resin: a zero-resin clear still completes but pays dry gold', () => {
    TUNING.resin.enabled = true;
    const g = Game.headless(fullPartySave());
    g.resin = 0;
    const goldBefore = g.gold;
    const r = g.runDomain('emberfall-rift');
    expect(r.cleared).toBe(true);
    expect(g.gold).toBeGreaterThan(goldBefore); // curated loot converted to dry gold
  });
});

describe('ley-line outcrop', () => {
  afterEach(() => { TUNING.resin.enabled = false; });

  it('pays a gold/XP bump when a ley-line camp is cleared', () => {
    const g = Game.headless(fullPartySave());
    const camps = (g as unknown as { camps: Map<string, { uids: number[]; respawnAt: number }> }).camps;
    const st = camps.get('tv-leyline-dawnmote')!;
    expect(st.uids.length).toBeGreaterThan(0);
    const goldBefore = g.gold;
    for (const uid of st.uids) {
      const u = g.sim.unit(uid);
      if (u) g.sim.killUnit(u, null, true);
    }
    g.update(1 / 30);
    expect(g.gold).toBeGreaterThan(goldBefore);
  });

  it('pays reduced dry gold when resin is short', () => {
    TUNING.resin.enabled = true;
    const g = Game.headless(fullPartySave());
    g.resin = 0;
    const camps = (g as unknown as { camps: Map<string, { uids: number[]; respawnAt: number }> }).camps;
    const st = camps.get('tv-leyline-dawnmote')!;
    const goldBefore = g.gold;
    for (const uid of st.uids) {
      const u = g.sim.unit(uid);
      if (u) g.sim.killUnit(u, null, true);
    }
    g.update(1 / 30);
    // dry payout = 240 * dryLootGoldPct (0.25) = 60
    expect(g.gold - goldBefore).toBe(Math.round(240 * TUNING.resin.dryLootGoldPct));
  });
});
