import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { REG } from '../core/registry';
import { masteryNodeIndex } from '../core/mastery';
import { xpForLevel } from '../core/stats';
import { Game, newGameSave } from '../systems/game';
import type { Toast } from '../systems/game';
import type { GameSave } from '../core/types';

// ============================================================
// FEEDBACK CONTRACTS — the "it changed but the player never knew"
// class of bug.
//
// The escaped progression bugs (silent Tome level-ups, silent
// ley-line / recruit-ceiling catch-up, dead Talent modal that
// spent nothing) all shared a shape the old suite never asserted:
// the *state* moved correctly, but the *player-facing signal*
// (level-up toast, a real spend) was missing. Those tests checked
// values; they never checked that the affordance talks back.
//
// This file pins the contract directly: every XP funnel that
// crosses a level boundary MUST surface a level-up toast, and
// every reachable point-spend MUST either do something or say why
// it can't — it may never be a silent no-op.
// ============================================================

beforeAll(() => registerAllContent());

const leveledToast = (t: Toast): boolean => t.kind === 'good' && /reached level/i.test(t.text);

/** A solo hero pinned at level 1 with a fat wallet, so any sizeable XP crosses a boundary. */
function level1Solo(gold = 0): GameSave {
  const save = newGameSave('juggernaut');
  save.roster[0].level = 1;
  save.roster[0].xp = 0;
  save.gold = gold;
  return save;
}

// ------------------------------------------------------------
// 1. EVERY XP FUNNEL ANNOUNCES A LEVEL-UP
// ------------------------------------------------------------
describe('every XP source that crosses a level boundary surfaces a level-up toast', () => {
  it('the shared grantHeroXp funnel emits the toast (the contract everything else must route through)', () => {
    const g = Game.headless(level1Solo());
    const rec = g.party[0];
    (g as unknown as { grantHeroXp(r: typeof rec, amount: number, cap: number): void }).grantHeroXp(
      rec,
      xpForLevel(4),
      g.recruitLevelCap()
    );
    expect(g.activeUnit()!.level).toBeGreaterThan(1);
    expect(g.toasts.some(leveledToast)).toBe(true);
  });

  it('buyTome (gold -> XP sink) announces the level it crosses', () => {
    const g = Game.headless(level1Solo(10000));
    expect(g.buyTome(0)).toBe(true);
    expect(g.activeUnit()!.level).toBeGreaterThan(1);
    expect(g.toasts.some(leveledToast)).toBe(true);
  });

  it('awardPartyXp (ley-line outcrop payout) announces per-hero level-ups', () => {
    const g = Game.headless(level1Solo());
    (g as unknown as { awardPartyXp(xp: number): void }).awardPartyXp(xpForLevel(5));
    expect(g.activeUnit()!.level).toBeGreaterThan(1);
    expect(g.toasts.some(leveledToast)).toBe(true);
  });

  it('a raised recruit ceiling lets banked XP catch up — and says so', () => {
    // Bank XP for level 25 but hold the unit at the 0-badge ceiling (18).
    const save = newGameSave('juggernaut');
    save.roster[0].level = 18;
    save.roster[0].xp = xpForLevel(25);
    const g = Game.headless(save);
    expect(g.activeUnit()!.level).toBe(18); // capped by the 0-badge ceiling

    // Earn a badge -> ceiling rises to 25 -> banked XP catches up.
    const badgeId = [...REG.gyms.values()][0].badgeId;
    (g as unknown as { badges: Set<string> }).badges.add(badgeId);
    const before = g.toasts.length;
    (g as unknown as { applyRecruitCeiling(): void }).applyRecruitCeiling();

    expect(g.activeUnit()!.level).toBe(25);
    expect(g.toasts.slice(before).some(leveledToast)).toBe(true);
  });

  it('a party-scope quest XP reward that levels a hero announces it', () => {
    const g = Game.headless(level1Solo());
    (g as unknown as { grantQuestReward(r: unknown): void }).grantQuestReward({
      kind: 'xp',
      amount: xpForLevel(4),
      scope: 'party'
    });
    expect(g.activeUnit()!.level).toBeGreaterThan(1);
    expect(g.toasts.some(leveledToast)).toBe(true);
  });
});

// ------------------------------------------------------------
// 2. POINT-SPEND AFFORDANCES ARE LIVE (anti dead-modal)
// ------------------------------------------------------------
describe('reachable point-spends do something — never a silent no-op', () => {
  it('a freshly leveled hero can actually spend an ability point', () => {
    const save = newGameSave('juggernaut');
    save.roster[0].level = 6;
    save.roster[0].xp = xpForLevel(6);
    const g = Game.headless(save);
    const rec = g.party[0];

    const pendingBefore = g.pendingAbilityPoints(rec);
    expect(pendingBefore).toBeGreaterThan(0);

    const slot = [0, 1, 2, 3].find((s) => g.canLevelAbility(0, s));
    expect(slot, 'at least one ability rank is learnable with points in hand').toBeDefined();
    const rankBefore = rec.unit!.abilities[slot!].level;

    expect(g.levelAbility(0, slot!)).toBe(true);
    expect(rec.unit!.abilities[slot!].level).toBe(rankBefore + 1);
    expect(g.pendingAbilityPoints(rec)).toBe(pendingBefore - 1);
  });

  it('a freshly leveled hero can actually spend a mastery point', () => {
    const save = newGameSave('juggernaut');
    save.roster[0].level = 2;
    save.roster[0].xp = xpForLevel(2);
    save.roster[0].abilityLevels = [1, 0, 0, 0];
    const g = Game.headless(save);
    const rec = g.party[0];

    expect(g.pendingMasteryPoints(rec)).toBeGreaterThan(0);
    expect(g.buyMasteryNode(0, masteryNodeIndex(0, 1))).toBe(true);
    expect(g.pendingMasteryPoints(rec)).toBe(0);
  });

  it('spending with no points left fails AND tells the player why (no silent click)', () => {
    const save = newGameSave('juggernaut');
    save.roster[0].level = 1;
    save.roster[0].xp = xpForLevel(1);
    save.roster[0].abilityLevels = [1, 0, 0, 0]; // the one level-1 point already spent
    const g = Game.headless(save);
    expect(g.pendingAbilityPoints(g.party[0])).toBe(0);

    const before = g.toasts.length;
    expect(g.levelAbility(0, 1)).toBe(false);
    const fresh = g.toasts.slice(before);
    expect(fresh.length, 'a rejected spend must surface a message').toBeGreaterThan(0);
    expect(fresh.some((t) => t.kind === 'bad')).toBe(true);
  });

  it('a locked mastery node refuses with a message instead of silently consuming a point', () => {
    const save = newGameSave('juggernaut');
    save.roster[0].level = 4;
    save.roster[0].xp = xpForLevel(4);
    save.roster[0].abilityLevels = [2, 1, 1, 0];
    const g = Game.headless(save);

    // Tier 2 is gated behind tier 1; buying it directly must be refused + announced.
    const before = g.toasts.length;
    expect(g.buyMasteryNode(0, masteryNodeIndex(0, 2))).toBe(false);
    expect(g.toasts.slice(before).some((t) => t.kind === 'bad')).toBe(true);
  });
});

// ------------------------------------------------------------
// 3. GOLD TRANSACTIONS MOVE GOLD *AND* SAY SO
// ------------------------------------------------------------
function soloTown(level = 20, gold = 0): GameSave {
  const save = newGameSave('juggernaut');
  save.roster[0].level = level;
  save.roster[0].xp = xpForLevel(level);
  save.gold = gold;
  return save;
}

describe('gold transactions are never silent', () => {
  it('a shop buy debits gold and confirms the purchase', () => {
    const g = Game.headless(soloTown(20, 5000));
    g.activeUnit()!.pos = { ...g.region.town.pos };
    const goldBefore = g.gold;
    const slotsBefore = g.activeUnit()!.items.filter(Boolean).length;
    const before = g.toasts.length;

    g.buyItem('boots-of-speed');

    expect(g.activeUnit()!.items.filter(Boolean).length).toBe(slotsBefore + 1);
    expect(g.gold).toBeLessThan(goldBefore);
    expect(g.toasts.slice(before).some((t) => t.kind === 'good' && /bought/i.test(t.text))).toBe(true);
  });

  it('a buy the player cannot afford fails loudly and leaves gold untouched', () => {
    const g = Game.headless(soloTown(20, 0));
    g.activeUnit()!.pos = { ...g.region.town.pos };
    const before = g.toasts.length;

    g.buyItem('boots-of-speed');

    expect(g.gold).toBe(0);
    expect(g.activeUnit()!.items.some((it) => it?.defId === 'boots-of-speed')).toBe(false);
    expect(g.toasts.slice(before).some((t) => t.kind === 'bad')).toBe(true);
  });

  it('selling a liquid item credits gold', () => {
    const save = soloTown(20, 0);
    save.roster[0].items[0] = { id: 'broadsword' };
    const g = Game.headless(save);
    const slot = g.activeUnit()!.items.findIndex((it) => it?.defId === 'broadsword');
    const goldBefore = g.gold;

    g.sellItem(slot);

    expect(g.gold).toBeGreaterThan(goldBefore);
    expect(g.activeUnit()!.items.some((it) => it?.defId === 'broadsword')).toBe(false);
  });
});
