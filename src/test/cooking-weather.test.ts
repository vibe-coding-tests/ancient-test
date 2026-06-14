import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { xpForLevel } from '../core/stats';
import { freshEchoProgress } from '../core/echo';
import { REG } from '../core/registry';
import { Game, newGameSave } from '../systems/game';
import type { GameSave } from '../core/types';

// ============================================================
// GAMEPLAY_OVERHAUL §3.7 (Pillar P7): cooking + elemental weather.
// Dishes are cooked at a town/shrine for an out-of-combat heal, a one-shot
// revive, or a timed exploration buff (rides the statmod path). Weather
// applies an element outdoors through the field path, gated by day/night.
// ============================================================

beforeAll(() => registerAllContent());

function partySave(regionId: string, heroIds: string[]): GameSave {
  const save = newGameSave(heroIds[0]);
  save.regionId = regionId;
  save.party = [...heroIds];
  save.recruited = [...heroIds];
  save.roster = heroIds.map((heroId) => ({
    heroId,
    level: 20,
    xp: xpForLevel(20),
    items: [null, null, null, null, null, null],
    neutralSlot: null,
    talentPicks: [0, 0, 0, 0],
    gambits: [],
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

/** Park the active hero on the region shrine so cooking is allowed. */
function standAtShrine(g: Game): void {
  const u = g.activeUnit()!;
  u.pos = { ...g.region.shrine.pos };
}

describe('cooking (GAMEPLAY_OVERHAUL §3.7)', () => {
  it('a heal dish restores the whole party out of combat', () => {
    const g = Game.headless(partySave('tranquil-vale', ['juggernaut', 'lich']));
    standAtShrine(g);
    g.gold = 1000;
    const hero = g.activeUnit()!;
    hero.hp = 1;
    expect(g.cookDish('hearty-stew')).toBe(true);
    expect(hero.hp).toBe(hero.stats.maxHp);
    expect(g.gold).toBe(1000 - REG.dish('hearty-stew').cost);
  });

  it('a buff dish applies a timed exploration buff through the statmod path', () => {
    const g = Game.headless(partySave('tranquil-vale', ['juggernaut', 'lich']));
    standAtShrine(g);
    g.gold = 1000;
    const hero = g.activeUnit()!;
    const speedBefore = hero.stats.moveSpeed;
    expect(g.cookDish('travelers-rations')).toBe(true);
    expect(hero.statuses.some((s) => s.tag === 'dish:travelers-rations')).toBe(true);
    expect(hero.stats.moveSpeed).toBeGreaterThan(speedBefore);
  });

  it('a revive dish stands a fallen hero back up', () => {
    const g = Game.headless(partySave('tranquil-vale', ['juggernaut', 'lich']));
    standAtShrine(g);
    g.gold = 1000;
    // simulate the second hero having fallen
    const fallen = (g as unknown as { party: { respawnAt: number; unit: unknown; hpPct: number }[] }).party[1];
    fallen.respawnAt = g.sim.time + 100;
    fallen.unit = null;
    fallen.hpPct = 0;
    expect(g.cookDish('phoenix-roast')).toBe(true);
    expect(fallen.respawnAt).toBeLessThanOrEqual(g.sim.time);
  });

  it('refuses to revive when no hero has fallen (and charges nothing)', () => {
    const g = Game.headless(partySave('tranquil-vale', ['juggernaut', 'lich']));
    standAtShrine(g);
    g.gold = 1000;
    expect(g.cookDish('phoenix-roast')).toBe(false);
    expect(g.gold).toBe(1000);
  });

  it('cannot cook away from a town or shrine', () => {
    const g = Game.headless(partySave('tranquil-vale', ['juggernaut', 'lich']));
    g.gold = 1000;
    const u = g.activeUnit()!;
    u.pos = { x: g.region.shrine.pos.x + 5000, y: g.region.shrine.pos.y + 5000 };
    expect(g.canCook().ok).toBe(false);
    expect(g.cookDish('hearty-stew')).toBe(false);
    expect(g.gold).toBe(1000);
  });

  it('cannot cook during combat', () => {
    const g = Game.headless(partySave('tranquil-vale', ['juggernaut', 'lich']));
    standAtShrine(g);
    g.gold = 1000;
    g.activeUnit()!.lastDealtDamageAt = g.sim.time; // recent combat
    expect(g.canCook().ok).toBe(false);
    expect(g.cookDish('hearty-stew')).toBe(false);
  });
});

describe('elemental weather (GAMEPLAY_OVERHAUL §3.7)', () => {
  it('Icewrack night frost applies ambient cryo through the field path', () => {
    const g = Game.headless(partySave('icewrack', ['juggernaut', 'lich']));
    g.setResonanceEnabled(true);
    g.dayTime = 0.7; // night (>= 0.5)
    const hero = g.activeUnit()!;
    delete hero.elementAuras.cryo;
    g.update(1 / 30);
    expect(hero.elementAuras.cryo).toBeTruthy();
  });

  it('is gated by the day/night clock: no frost by day', () => {
    const g = Game.headless(partySave('icewrack', ['juggernaut', 'lich']));
    g.setResonanceEnabled(true);
    g.dayTime = 0.2; // day (< 0.5)
    const hero = g.activeUnit()!;
    delete hero.elementAuras.cryo;
    g.update(1 / 30);
    expect(hero.elementAuras.cryo).toBeFalsy();
  });
});
