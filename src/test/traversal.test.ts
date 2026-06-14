import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { xpForLevel } from '../core/stats';
import { freshEchoProgress } from '../core/echo';
import { REG } from '../core/registry';
import { TUNING } from '../data/tuning';
import { Game, newGameSave } from '../systems/game';
import type { GameSave } from '../core/types';

// ============================================================
// GAMEPLAY_OVERHAUL §3.3 (Pillar P1, G3): verticality & traversal.
// Climb/glide are scripted connectors between elevation tiers; swim is a
// slowed, stamina-draining state with a deep-water washback. All systems-side.
// ============================================================

beforeAll(() => registerAllContent());

function icewrackSave(): GameSave {
  const save = newGameSave('juggernaut');
  save.regionId = 'icewrack';
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

const CLIMB = { id: 'iw-climb-escarpment', pos: { x: 9000, y: 3000 } };       // tier 0 -> 1
const CLIMB2 = { id: 'iw-climb-highledge', pos: { x: 9620, y: 2440 } };       // tier 1 -> 2
const GLIDE = { id: 'iw-glide-ravine', pos: { x: 9780, y: 2260 } };           // tier 2 launch
const LAKE = { x: 3500, y: 8600 }; // inside iw-frozen-lake (deep)

function climbTo(g: Game, point: { pos: { x: number; y: number } }): void {
  g.activeUnit()!.pos = { ...point.pos };
  g.stamina = g.staminaMax();
  g.tryClimb();
  for (let i = 0; i < 80 && g.locomotionState() === 'climb'; i++) g.update(1 / 30);
}

describe('climb (G3)', () => {
  it('ascends a tier over time, draining stamina', () => {
    const g = Game.headless(icewrackSave());
    const hero = g.activeUnit()!;
    hero.pos = { ...CLIMB.pos };
    expect(g.elevationTier()).toBe(0);
    const staminaBefore = g.stamina;
    expect(g.tryClimb()).toBe(true);
    expect(g.locomotionState()).toBe('climb');
    // step through the scripted ascent
    for (let i = 0; i < 80 && g.locomotionState() === 'climb'; i++) g.update(1 / 30);
    expect(g.elevationTier()).toBe(1);
    expect(g.locomotionState()).toBe('ground');
    expect(g.stamina).toBeLessThan(staminaBefore);
  });

  it('refuses to climb away from a connector', () => {
    const g = Game.headless(icewrackSave());
    g.activeUnit()!.pos = { x: 6200, y: 6200 };
    expect(g.tryClimb()).toBe(false);
  });

  it('slides back down when stamina runs out mid-climb', () => {
    const g = Game.headless(icewrackSave());
    g.activeUnit()!.pos = { ...CLIMB.pos };
    g.stamina = TUNING.traversal.climbDrainPerSec * 0.2; // barely any
    expect(g.tryClimb()).toBe(true);
    for (let i = 0; i < 80 && g.locomotionState() === 'climb'; i++) g.update(1 / 30);
    expect(g.elevationTier()).toBe(0); // never made it up
  });
});

describe('glide (G3)', () => {
  it('descends a tier from height for free', () => {
    const g = Game.headless(icewrackSave());
    const hero = g.activeUnit()!;
    // climb the escarpment, then the high ledge, to reach the tier-2 glide launch
    climbTo(g, CLIMB);
    climbTo(g, CLIMB2);
    expect(g.elevationTier()).toBe(2);

    hero.pos = { ...GLIDE.pos };
    g.stamina = 0; // gliding is free, so an empty bar is fine
    expect(g.tryGlide()).toBe(true);
    expect(g.locomotionState()).toBe('glide');
    for (let i = 0; i < 120 && g.locomotionState() === 'glide'; i++) g.update(1 / 30);
    expect(g.elevationTier()).toBe(1);
  });
});

describe('swim (G3)', () => {
  it('slows movement and drains stamina inside a water zone', () => {
    const g = Game.headless(icewrackSave());
    const hero = g.activeUnit()!;
    const drySpeed = hero.stats.moveSpeed;
    hero.pos = { ...LAKE };
    g.update(1 / 30);
    expect(g.locomotionState()).toBe('swim');
    expect(hero.stats.moveSpeed).toBeLessThan(drySpeed);
    const staminaAfterEnter = g.stamina;
    g.update(1 / 30);
    expect(g.stamina).toBeLessThan(staminaAfterEnter);
  });

  it('washes a stranded swimmer back to dry land at zero stamina (soft fail)', () => {
    const g = Game.headless(icewrackSave());
    const hero = g.activeUnit()!;
    // establish dry footing, then wade into the deep lake with an empty bar
    hero.pos = { x: 5000, y: 6000 };
    g.update(1 / 30);
    hero.pos = { ...LAKE };
    g.stamina = 0;
    g.update(1 / 30);
    expect(g.locomotionState()).toBe('ground'); // washed back out of the water
    const inLake = pointInLake(hero.pos);
    expect(inLake).toBe(false);
  });
});

function pointInLake(p: { x: number; y: number }): boolean {
  return p.x >= 2800 && p.x <= 4300 && p.y >= 8000 && p.y <= 9300;
}
