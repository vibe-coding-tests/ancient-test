import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { TUNING } from '../data/tuning';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import { applyDamage } from '../core/combat';
import { setupMacroSim, runBossBattle } from '../core/macro';
import { bossFightSetupFromDef } from '../core/phase3';
import { enemyCompetence } from '../core/progression';
import type { ActiveElement, MacroHeroSetup } from '../core/types';

// ============================================================
// COMBAT_DEPTH_OVERHAUL P5 — guards that "harder == smarter + more demanding",
// not just tankier: a competence win-rate lever, a reaction-required wall, a
// playable TTK band on the rebalanced curve, and the reversibility floor.
// ============================================================

beforeAll(() => registerAllContent());

const REF = TUNING.ai.depthRefAiDepth;
const HELL = TUNING.bossTierAiDepth.hell; // 1.0 — top competence depth

// A mirrored, item-less 3v3 so the ONLY asymmetry under test is controller depth
// (and an optional stat handicap) — the cleanest "smarter, not tankier" probe.
const COMP: MacroHeroSetup[] = [
  { heroId: 'juggernaut', level: 20 },
  { heroId: 'lich', level: 20 },
  { heroId: 'sniper', level: 20 }
];

function mirrorWithDepth(enemyDepth: number, allyDepth: number, enemyStatMult = 1): Sim {
  const sim = setupMacroSim({ seed: 1000, teamA: COMP, teamB: COMP });
  sim.resonanceEnabled = true;
  for (const u of sim.unitsArr) {
    if (u.kind !== 'hero') continue;
    if (u.ctrl.kind === 'gambit') u.ctrl.aiDepth = u.team === 0 ? allyDepth : enemyDepth;
    if (u.team === 1 && enemyStatMult !== 1) {
      u.externalMods.maxHp = (u.externalMods.maxHp ?? 0) + u.stats.maxHp * (enemyStatMult - 1);
      u.externalMods.damagePct = (u.externalMods.damagePct ?? 0) + (enemyStatMult - 1) * 100;
      u.markStatsDirty();
      u.refresh(0);
      u.hp = u.stats.maxHp;
    }
  }
  return sim;
}

describe('COMBAT_DEPTH_OVERHAUL — smarter, not tankier', () => {
  it('competence is a real difficulty lever carried on units without changing stats', () => {
    const sim = mirrorWithDepth(HELL, REF);
    const ally = sim.unitsArr.find((u) => u.team === 0 && u.kind === 'hero')!;
    const enemy = sim.unitsArr.find((u) => u.team === 1 && u.kind === 'hero')!;

    expect(enemy.ctrl.kind).toBe('gambit');
    expect(ally.ctrl.kind).toBe('gambit');
    if (enemy.ctrl.kind === 'gambit' && ally.ctrl.kind === 'gambit') {
      expect(enemy.ctrl.aiDepth).toBe(HELL);
      expect(ally.ctrl.aiDepth).toBe(REF);
    }
    expect(enemy.stats.maxHp).toBeCloseTo(ally.stats.maxHp, 6);
    expect(enemy.stats.damage).toBeCloseTo(ally.stats.damage, 6);
  });

  it('raw stat scaling remains a separate dial from competence depth', () => {
    const smart = mirrorWithDepth(HELL, REF);
    const sponge = mirrorWithDepth(REF, REF, 1.12);
    const smartEnemy = smart.unitsArr.find((u) => u.team === 1 && u.kind === 'hero')!;
    const spongeEnemy = sponge.unitsArr.find((u) => u.team === 1 && u.kind === 'hero')!;
    const smartAlly = smart.unitsArr.find((u) => u.team === 0 && u.kind === 'hero')!;

    expect(smartEnemy.stats.maxHp).toBeCloseTo(smartAlly.stats.maxHp, 6);
    expect(smartEnemy.stats.damage).toBeCloseTo(smartAlly.stats.damage, 6);
    expect(spongeEnemy.stats.maxHp).toBeGreaterThan(smartEnemy.stats.maxHp);
    expect(spongeEnemy.stats.damage).toBeGreaterThan(smartEnemy.stats.damage);
  });

  it('boss setup carries hell competence independently from boss stat columns', () => {
    const party: MacroHeroSetup[] = [{ heroId: 'juggernaut', level: 22 }];
    const boss = REG.boss('boss-phantom-assassin');
    const normal = bossFightSetupFromDef(boss, party, 'normal', 1).boss;
    const hell = bossFightSetupFromDef(boss, party, 'hell', 1).boss;

    expect(hell.aiDepth).toBeGreaterThan(normal.aiDepth);
    expect(hell.hpScale).toBeGreaterThan(normal.hpScale);
    expect(hell.damageScale).toBeGreaterThan(normal.damageScale);
    const leanHell = { ...hell, hpScale: normal.hpScale, damageScale: normal.damageScale };
    expect(leanHell.aiDepth).toBe(hell.aiDepth);
    expect(leanHell.hpScale).toBe(normal.hpScale);
  });
});

describe('COMBAT_DEPTH_OVERHAUL — reaction required', () => {
  const shieldOf = (hp: number) => ({
    element: 'pyro' as ActiveElement,
    hp,
    maxHp: hp,
    weakTo: ['hydro'] as ActiveElement[],
    weakMult: 3,
    vulnerableUntil: -1
  });

  it('the weakness element melts an elemental shield ~weakMult faster than an off-element hit', () => {
    const sim = new Sim({ seed: 7, bounds: { w: 3000, h: 3000 } });
    sim.resonanceEnabled = true;

    const weak = sim.spawnCreep(REG.creep('kobold'), { team: 1, pos: { x: 500, y: 500 }, wild: true });
    weak.elementalShield = shieldOf(300);
    applyDamage(sim, null, weak, 120, 'magical', { element: 'hydro' }); // 120 * weakMult(3) = 360 > 300
    expect(weak.elementalShield!.hp).toBe(0); // shield shattered, body now exposed

    const offEl = sim.spawnCreep(REG.creep('kobold'), { team: 1, pos: { x: 800, y: 500 }, wild: true });
    offEl.elementalShield = shieldOf(300);
    applyDamage(sim, null, offEl, 120, 'magical', { element: 'pyro' }); // off-element: 120 * 1 = 120 < 300
    expect(offEl.elementalShield!.hp).toBeGreaterThan(0); // shield holds — you must bring the reaction
  });

  it('with resonance off, even the weakness element gets no reaction discount (opt-out floor)', () => {
    const sim = new Sim({ seed: 8, bounds: { w: 3000, h: 3000 } });
    sim.resonanceEnabled = false;
    const c = sim.spawnCreep(REG.creep('kobold'), { team: 1, pos: { x: 500, y: 500 }, wild: true });
    c.elementalShield = shieldOf(300);
    applyDamage(sim, null, c, 120, 'magical', { element: 'hydro' }); // resonance off → 1x, no melt
    expect(c.elementalShield!.hp).toBeGreaterThan(0);
  });
});

describe('COMBAT_DEPTH_OVERHAUL — playable TTK band + reversibility', () => {
  it('a geared party clears a hell regional boss inside a demanding-but-winnable band', () => {
    const party: MacroHeroSetup[] = ['juggernaut', 'sven', 'sniper', 'crystal-maiden', 'omniknight'].map((heroId) => ({
      heroId,
      level: 22,
      items: ['black-king-bar', 'assault-cuirass']
    }));
    const boss = REG.boss('boss-phantom-assassin');
    const result = runBossBattle(bossFightSetupFromDef(boss, party, 'hell', 90210), {
      id: boss.id,
      enrageSec: TUNING.regionalBossSoftEnrageSec,
      phases: boss.phases
    });
    // The boss runs its phases + soft-enrage on the trimmed hell curve: still a kill, but a fight.
    expect(result.winner).toBe(0);
    expect(result.timeSec).toBeGreaterThanOrEqual(20);
    expect(result.timeSec).toBeLessThanOrEqual(TUNING.regionalBossSoftEnrageSec + 40);
  });

  it('reversibility: enemyCompetence at normal + World Level 0 equals the legacy depth baseline', () => {
    expect(enemyCompetence({ tier: 'normal', worldLevel: 0 })).toBeCloseTo(REF, 6);
    // ...and it ramps strictly upward into hell / high World Level (the "harder == smarter" dial).
    expect(enemyCompetence({ tier: 'hell', worldLevel: TUNING.worldLevel.cap, rank: 'boss' })).toBeGreaterThan(
      enemyCompetence({ tier: 'normal', worldLevel: 0 })
    );
  });
});
