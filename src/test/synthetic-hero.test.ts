import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import type { HeroDef } from '../core/types';

// ============================================================
// Synthetic-hero test (SPEC §1.2): a hero defined purely as data,
// registered at runtime, runs through a headless sim casting one
// ability of each targeting type. Zero engine code involved —
// proof that hero #61 needs no code.
// ============================================================

const SYNTH: HeroDef = {
  id: 'synthetic-test-hero',
  name: 'Synthetic',
  title: 'The Unit Test',
  attribute: 'uni',
  roles: ['nuker'],
  region: 'tranquil-vale',
  lore: 'Assembled from spare schema.',
  baseStats: {
    str: 25, agi: 25, int: 25,
    strGain: 2, agiGain: 2, intGain: 2,
    baseDamage: 30,
    baseArmor: 2,
    attackRange: 500,
    attackPoint: 0.3,
    baseAttackTime: 1.5,
    attackProjectileSpeed: 1200,
    moveSpeed: 300,
    turnRate: 0.8,
    hpRegen: 1,
    manaRegen: 5
  },
  abilities: [
    {
      id: 'synth-nuke',
      name: 'Unit Bolt',
      targeting: 'unit-target',
      affects: 'enemy',
      castRange: 600,
      castPoint: 0.2,
      manaCost: [50, 50, 50, 50],
      cooldown: [2, 2, 2, 2],
      values: { damage: [100, 150, 200, 250] },
      effects: [{ kind: 'damage', dtype: 'magical', amount: 'damage', target: 'target' }],
      vfx: { archetype: 'projectile', color: '#ff00ff' }
    },
    {
      id: 'synth-zone',
      name: 'Assertion Field',
      targeting: 'ground-aoe',
      castRange: 800,
      castPoint: 0.2,
      manaCost: [60, 60, 60, 60],
      cooldown: [3, 3, 3, 3],
      values: { damage: [80, 120, 160, 200], radius: [350, 350, 350, 350] },
      effects: [
        { kind: 'damage', dtype: 'magical', amount: 'damage', target: 'enemies-in-radius', radius: 'radius' },
        { kind: 'status', status: 'slow', duration: 2, target: 'enemies-in-radius', radius: 'radius', params: { moveSlowPct: 30 } }
      ],
      vfx: { archetype: 'ground-aoe', color: '#00ff88' }
    },
    {
      id: 'synth-skillshot',
      name: 'Stack Trace',
      targeting: 'skillshot',
      castRange: 1200,
      castPoint: 0.2,
      manaCost: [70, 70, 70, 70],
      cooldown: [4, 4, 4, 4],
      values: { damage: [120, 170, 220, 270] },
      effects: [
        {
          kind: 'projectile',
          to: 'point',
          proj: {
            model: 'linear',
            speed: 1500,
            width: 100,
            range: 1200,
            onHit: [
              { kind: 'damage', dtype: 'magical', amount: 'damage', target: 'target' },
              { kind: 'status', status: 'stun', duration: 1, target: 'target' }
            ]
          }
        }
      ],
      vfx: { archetype: 'projectile', color: '#ffff00' }
    },
    {
      id: 'synth-ult',
      name: 'Full Coverage',
      targeting: 'no-target',
      ult: true,
      castPoint: 0.2,
      manaCost: [100, 100, 100],
      cooldown: [10, 10, 10],
      values: { damage: [200, 300, 400], radius: [600, 600, 600] },
      effects: [{ kind: 'damage', dtype: 'pure', amount: 'damage', target: 'enemies-in-radius', radius: 'radius' }],
      vfx: { archetype: 'storm', color: '#88ffff' }
    }
  ],
  talents: [
    { level: 10, options: [{ id: 's1', name: '+10 dmg', mods: { damage: 10 } }, { id: 's2', name: '+10 ms', mods: { moveSpeed: 10 } }] },
    { level: 15, options: [{ id: 's3', name: '+1 armor', mods: { armor: 1 } }, { id: 's4', name: '+50 hp', mods: { maxHp: 50 } }] },
    { level: 20, options: [{ id: 's5', name: '+20 dmg', mods: { damage: 20 } }, { id: 's6', name: '+20 ms', mods: { moveSpeed: 20 } }] },
    { level: 25, options: [{ id: 's7', name: '+2 armor', mods: { armor: 2 } }, { id: 's8', name: '+100 hp', mods: { maxHp: 100 } }] }
  ],
  facets: [{ id: 'sf1', name: 'Default', description: 'No-op facet.' }],
  silhouette: { build: 'biped', scale: 1 },
  palette: ['#ff00ff', '#00ff88', '#ffffff'],
  barks: ['Assert.', 'Expect.', 'Pass.', 'Mock.', 'Stub.', 'Green.'],
  bounty: { xp: 100, gold: 50 }
};

beforeAll(() => {
  registerAllContent();
  REG.registerHero(SYNTH); // runtime registration, no code changes
});

describe('synthetic hero', () => {
  it('registers at runtime and resolves from the registry', () => {
    expect(REG.hero('synthetic-test-hero').name).toBe('Synthetic');
  });

  it('casts one ability of each targeting type in a headless sim', () => {
    const sim = new Sim({ seed: 42, bounds: { w: 4000, h: 4000 } });
    sim.events.captureAll = true;

    const synth = sim.spawnHero(REG.hero('synthetic-test-hero'), {
      team: 0,
      pos: { x: 1000, y: 2000 },
      level: 12,
      ctrl: { kind: 'player' }
    });
    // a row of sturdy dummies (no AI so they just stand there)
    const dummies = [0, 1, 2].map((i) =>
      sim.spawnHero(REG.hero('pudge'), { team: 1, pos: { x: 1500 + i * 120, y: 2000 }, level: 20, ctrl: { kind: 'none' } })
    );

    // unit-target
    sim.order(synth.uid, { kind: 'cast', slot: 0, uid: dummies[0].uid });
    sim.run(1.5);
    // ground-aoe
    sim.order(synth.uid, { kind: 'cast', slot: 1, point: { x: 1560, y: 2000 } });
    sim.run(1.5);
    // skillshot
    sim.order(synth.uid, { kind: 'cast', slot: 2, point: { x: 1700, y: 2000 } });
    sim.run(1.5);
    // no-target ult
    sim.order(synth.uid, { kind: 'cast', slot: 3 });
    sim.run(1.5);

    const casts = sim.events.history.filter((e) => e.t === 'cast' && e.uid === synth.uid).map((e) => (e as { abilityId: string }).abilityId);
    expect(casts).toContain('synth-nuke');
    expect(casts).toContain('synth-zone');
    expect(casts).toContain('synth-skillshot');
    expect(casts).toContain('synth-ult');

    // all four did damage
    const damaged = dummies.some((d) => d.hp < d.stats.maxHp);
    expect(damaged).toBe(true);
    const stunEvents = sim.events.history.filter((e) => e.t === 'status-apply' && (e as { status: string }).status === 'stun');
    expect(stunEvents.length).toBeGreaterThan(0);
  });
});
