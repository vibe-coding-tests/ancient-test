import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { TUNING } from '../data/tuning';
import { bossFightSetupFromDef, creepCombatTier } from '../core/phase3';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import { makeItemState } from '../core/items';
import { runRaidBattle } from '../core/macro';
import { abilityVal } from '../core/values';
import { worldLevel, worldLevelForEncounter, worldLevelScale, worldLevelShieldFraction } from '../core/progression';
import { spawnHeroEchoUnit } from '../core/echo-unit';

function attackOnlyCreepTtk(opts: {
  heroId: string;
  level: number;
  items?: string[];
  creepId: string;
  regionId?: string;
  combatTier?: 'normal' | 'nightmare' | 'hell';
  maxSec?: number;
}): number {
  const sim = new Sim({ seed: 2026, bounds: { w: 3000, h: 3000 } });
  const hero = sim.spawnHero(REG.hero(opts.heroId), { team: 0, pos: { x: 1000, y: 1000 }, level: opts.level, ctrl: { kind: 'none' } });
  (opts.items ?? []).forEach((id, i) => {
    hero.items[i] = makeItemState(REG.item(id));
  });
  hero.markStatsDirty();
  hero.refresh(sim.time);
  hero.hp = hero.stats.maxHp;
  hero.mana = hero.stats.maxMana;

  const creep = sim.spawnCreep(REG.creep(opts.creepId), {
    team: 1,
    pos: { x: 1120, y: 1000 },
    wild: true,
    regionId: opts.regionId,
    combatTier: opts.combatTier
  });
  creep.ctrl = { kind: 'none' };
  hero.order = { kind: 'attack-unit', uid: creep.uid };

  const maxSec = opts.maxSec ?? 60;
  const ticks = Math.ceil(maxSec / TUNING.dt);
  for (let i = 0; i < ticks; i++) {
    sim.tick();
    if (!creep.alive) return sim.time;
  }
  return maxSec;
}

beforeAll(() => registerAllContent());

describe('Gameplay 2.0 combat scaling', () => {
  it('maps region depth to overworld creep combat tier', () => {
    expect(creepCombatTier('tranquil-vale')).toBe('normal');
    expect(creepCombatTier('shadeshore')).toBe('nightmare');
    expect(creepCombatTier('mad-moon-crater')).toBe('hell');
  });

  it('scales wild creep durability and damage by region and tier', () => {
    const def = REG.creep('hellbear');
    const baseSim = new Sim({ seed: 1, bounds: { w: 3000, h: 3000 } });
    const lateSim = new Sim({ seed: 1, bounds: { w: 3000, h: 3000 } });

    const base = baseSim.spawnCreep(def, { team: 1, pos: { x: 500, y: 500 }, wild: true });
    const late = lateSim.spawnCreep(def, {
      team: 1,
      pos: { x: 500, y: 500 },
      wild: true,
      regionId: 'mad-moon-crater',
      combatTier: 'hell'
    });

    // COMBAT_DEPTH_OVERHAUL P4: late-game creeps stay much tankier/deadlier than base, but the
    // tier sponge was trimmed (hell 2.1->1.85), so the HP floor relaxes from 8x to 7x.
    expect(late.stats.maxHp).toBeGreaterThan(base.stats.maxHp * 7);
    expect(late.stats.damage).toBeGreaterThan(base.stats.damage * 4);
    expect(late.stats.maxHp).toBeCloseTo(base.stats.maxHp * TUNING.creepCombatScale.hpByRegion['mad-moon-crater'] * TUNING.creepCombatScale.tier.hell, 0);
  });

  it('scales offensive creep ability values by region and tier without changing geometry', () => {
    const def = REG.creep('hellbear');
    const baseSim = new Sim({ seed: 2, bounds: { w: 3000, h: 3000 } });
    const lateSim = new Sim({ seed: 2, bounds: { w: 3000, h: 3000 } });
    const base = baseSim.spawnCreep(def, { team: 1, pos: { x: 500, y: 500 }, wild: true });
    const late = lateSim.spawnCreep(def, {
      team: 1,
      pos: { x: 500, y: 500 },
      wild: true,
      regionId: 'mad-moon-crater',
      combatTier: 'hell'
    });
    const baseAbility = base.abilities[0];
    const lateAbility = late.abilities[0];
    const expected = TUNING.creepCombatScale.damageByRegion['mad-moon-crater'] * TUNING.creepCombatScale.tier.hell;

    expect(abilityVal(lateAbility.def, 'damage', lateAbility.level)).toBeCloseTo(abilityVal(baseAbility.def, 'damage', baseAbility.level) * expected, 4);
    expect(abilityVal(lateAbility.def, 'radius', lateAbility.level)).toBe(abilityVal(baseAbility.def, 'radius', baseAbility.level));
  });

  it('keeps representative attack-only creep TTK in broad farming bands', () => {
    const trash = attackOnlyCreepTtk({ heroId: 'juggernaut', level: 10, creepId: 'kobold', maxSec: 8 });
    const ancient = attackOnlyCreepTtk({
      heroId: 'juggernaut',
      level: 30,
      items: ['butterfly', 'daedalus', 'monkey-king-bar', 'mjollnir', 'assault-cuirass', 'divine-rapier'],
      creepId: 'ancient-thunderhide',
      regionId: 'mad-moon-crater',
      combatTier: 'hell',
      maxSec: 30
    });

    expect(trash).toBeGreaterThan(0);
    expect(trash).toBeLessThanOrEqual(4);
    expect(ancient).toBeGreaterThanOrEqual(4);
    expect(ancient).toBeLessThanOrEqual(18);
  });

  it('computes World Level from fielded level + badges, clamped to the cap', () => {
    expect(worldLevel(0, 0)).toBe(0);
    expect(worldLevel(30, 0)).toBe(5);
    expect(worldLevel(30, 3)).toBe(8);
    expect(worldLevel(30, 8)).toBe(TUNING.worldLevel.cap);
    // monotonic in both inputs
    for (let lvl = 0; lvl <= 30; lvl++) {
      expect(worldLevel(lvl + 1, 0)).toBeGreaterThanOrEqual(worldLevel(lvl, 0));
    }
  });

  it('keeps World Level scale monotonic with texture as the primary term', () => {
    for (let wl = 0; wl < TUNING.worldLevel.cap; wl++) {
      const lo = worldLevelScale(wl);
      const hi = worldLevelScale(wl + 1);
      expect(hi.hp).toBeGreaterThan(lo.hp);
      expect(hi.damage).toBeGreaterThan(lo.damage);
      expect(hi.texture).toBeGreaterThan(lo.texture);
    }
    // §9 balance guard: texture is the PRIMARY lever and must outpace both the HP
    // and damage growth terms, so World Level demands the reaction combo instead of
    // sliding into a damage sponge. HP stays ahead of (or equal to) the damage term.
    expect(TUNING.worldLevel.texturePerLevel).toBeGreaterThan(TUNING.worldLevel.hpPerLevel);
    expect(TUNING.worldLevel.texturePerLevel).toBeGreaterThan(TUNING.worldLevel.damagePerLevel);
    expect(TUNING.worldLevel.hpPerLevel).toBeGreaterThanOrEqual(TUNING.worldLevel.damagePerLevel);
    // and at the cap the texture term genuinely exceeds the HP multiplier's growth
    expect(worldLevelScale(TUNING.worldLevel.cap).texture).toBeGreaterThan(worldLevelScale(TUNING.worldLevel.cap).hp - 1);
    expect(worldLevelScale(0)).toEqual({ hp: 1, damage: 1, texture: 0 });
  });

  it('feeds the texture term into the elite shield fraction, not a flat shield knob', () => {
    expect(worldLevelShieldFraction(0)).toBeCloseTo(TUNING.worldLevel.shieldBasePct, 6);
    for (let wl = 0; wl < TUNING.worldLevel.cap; wl++) {
      expect(worldLevelShieldFraction(wl + 1)).toBeGreaterThan(worldLevelShieldFraction(wl));
    }
    const cap = TUNING.worldLevel.cap;
    const expected = TUNING.worldLevel.shieldBasePct + worldLevelScale(cap).texture * TUNING.worldLevel.shieldTextureMult;
    expect(worldLevelShieldFraction(cap)).toBeCloseTo(expected, 6);
    expect(worldLevelShieldFraction(cap) - worldLevelShieldFraction(0)).toBeCloseTo(worldLevelScale(cap).texture * TUNING.worldLevel.shieldTextureMult, 6);
    expect(worldLevelShieldFraction(cap)).toBeGreaterThan(worldLevelShieldFraction(0));
  });

  it('applies full WL to featured encounters and caps ordinary trash', () => {
    const wl = 8;
    // featured: bosses, raids, echoes, ley lines, and champion/rare/large/ancient packs
    expect(worldLevelForEncounter(wl, { source: 'boss' })).toBe(wl);
    expect(worldLevelForEncounter(wl, { source: 'raid' })).toBe(wl);
    expect(worldLevelForEncounter(wl, { source: 'overworld-camp', creepTier: 'ancient' })).toBe(wl);
    expect(worldLevelForEncounter(wl, { source: 'overworld-camp', creepTier: 'small', packRarity: 'champion' })).toBe(wl);
    // ordinary small/medium trash is capped so a capped hero can outgrow it
    expect(worldLevelForEncounter(wl, { source: 'overworld-camp', creepTier: 'small', packRarity: 'normal' })).toBe(TUNING.worldLevel.trashCap);
    expect(worldLevelForEncounter(wl, { source: 'overworld-camp', creepTier: 'medium', packRarity: 'normal' })).toBe(TUNING.worldLevel.trashCap);
  });

  it('matches the pre-change baseline when World Level is 0 (reversibility)', () => {
    const def = REG.creep('hellbear');
    const baseSim = new Sim({ seed: 9, bounds: { w: 3000, h: 3000 } });
    const wlSim = new Sim({ seed: 9, bounds: { w: 3000, h: 3000 } });
    const base = baseSim.spawnCreep(def, { team: 1, pos: { x: 500, y: 500 }, wild: true, regionId: 'icewrack', combatTier: 'nightmare' });
    const wl0 = wlSim.spawnCreep(def, { team: 1, pos: { x: 500, y: 500 }, wild: true, regionId: 'icewrack', combatTier: 'nightmare', worldLevel: 0 });
    expect(wl0.stats.maxHp).toBeCloseTo(base.stats.maxHp, 6);
    expect(wl0.stats.damage).toBeCloseTo(base.stats.damage, 6);
  });

  it('makes a WL-N featured pack non-trivial without flattening capped trash', () => {
    const def = REG.creep('hellbear');
    const flatSim = new Sim({ seed: 11, bounds: { w: 3000, h: 3000 } });
    const wlSim = new Sim({ seed: 11, bounds: { w: 3000, h: 3000 } });
    const flat = flatSim.spawnCreep(def, { team: 1, pos: { x: 500, y: 500 }, wild: true, regionId: 'mad-moon-crater', combatTier: 'hell' });
    const featured = wlSim.spawnCreep(def, { team: 1, pos: { x: 500, y: 500 }, wild: true, regionId: 'mad-moon-crater', combatTier: 'hell', worldLevel: 8 });
    const scale = worldLevelScale(8);
    expect(featured.stats.maxHp).toBeCloseTo(flat.stats.maxHp * scale.hp, 0);
    expect(featured.stats.damage).toBeCloseTo(flat.stats.damage * scale.damage, 0);
    expect(featured.stats.maxHp).toBeGreaterThan(flat.stats.maxHp);
  });

  it('scales a featured echo above its taxed baseline at World Level (§2.5)', () => {
    const baseSim = new Sim({ seed: 21, bounds: { w: 3000, h: 3000 } });
    const wlSim = new Sim({ seed: 21, bounds: { w: 3000, h: 3000 } });
    const flat = spawnHeroEchoUnit(baseSim, { heroId: 'juggernaut', team: 1, pos: { x: 1000, y: 1000 }, level: 20 });
    const featured = spawnHeroEchoUnit(wlSim, { heroId: 'juggernaut', team: 1, pos: { x: 1000, y: 1000 }, level: 20, worldLevel: 6 });
    // WL scaling rides *on top of* the survivability tax, so a featured echo is tougher.
    expect(featured.stats.maxHp).toBeGreaterThan(flat.stats.maxHp);
    expect(featured.stats.maxHp).toBeCloseTo(flat.stats.maxHp * worldLevelScale(6).hp, 0);
    // WL 0 leaves the echo exactly at its taxed baseline (reversibility).
    const wl0Sim = new Sim({ seed: 21, bounds: { w: 3000, h: 3000 } });
    const wl0 = spawnHeroEchoUnit(wl0Sim, { heroId: 'juggernaut', team: 1, pos: { x: 1000, y: 1000 }, level: 20, worldLevel: 0 });
    expect(wl0.stats.maxHp).toBeCloseTo(flat.stats.maxHp, 6);
  });

  it('keeps a geared party regional boss kill in the intended fight-length range', () => {
    const party = ['juggernaut', 'sven', 'sniper', 'crystal-maiden', 'omniknight'].map((heroId) => ({
      heroId,
      level: 18,
      items: ['black-king-bar']
    }));
    const result = runRaidBattle(bossFightSetupFromDef(REG.boss('boss-phantom-assassin'), party, 'normal', 7001));

    expect(result.winner).toBe(0);
    expect(result.timeSec).toBeGreaterThanOrEqual(30);
    expect(result.timeSec).toBeLessThanOrEqual(140);
  });
});
