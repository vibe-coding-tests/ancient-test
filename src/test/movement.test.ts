import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import { resolveCollisions, steerToward } from '../core/movement';
import { dist, pointSegDist } from '../core/math2d';
import { obstacleBlocksProjectiles, projectileSegmentHitsObstacle, projectileSegmentHitsUnit, resolveUnitBodies, staticCircleObstacle, zoneContainsUnit } from '../core/collision';

beforeAll(() => registerAllContent());

describe('movement and collision', () => {
  it('steers toward an order point', () => {
    const sim = new Sim({ seed: 21, bounds: { w: 2000, h: 2000 } });
    const unit = sim.spawnHero(REG.hero('juggernaut'), {
      team: 0,
      pos: { x: 300, y: 300 },
      level: 1,
      ctrl: { kind: 'none' }
    });
    unit.facing = 0;

    const arrived = steerToward(sim, unit, { x: 500, y: 300 }, 0.25, 12);

    expect(arrived).toBe(false);
    expect(unit.pos.x).toBeGreaterThan(300);
    expect(Math.abs(unit.pos.y - 300)).toBeLessThan(1);
  });

  it('separates overlapping unit circles deterministically', () => {
    const sim = new Sim({ seed: 22, bounds: { w: 2000, h: 2000 } });
    const a = sim.spawnHero(REG.hero('juggernaut'), {
      team: 0,
      pos: { x: 500, y: 500 },
      level: 1,
      ctrl: { kind: 'none' }
    });
    const b = sim.spawnHero(REG.hero('axe'), {
      team: 1,
      pos: { x: 506, y: 500 },
      level: 1,
      ctrl: { kind: 'none' }
    });

    const before = dist(a.pos, b.pos);
    sim.rebuildSpatial();
    resolveCollisions(sim, a);

    expect(dist(a.pos, b.pos)).toBeGreaterThan(before);
  });

  it('pushes units out of temporary wall zones', () => {
    const sim = new Sim({ seed: 23, bounds: { w: 2000, h: 2000 } });
    const caster = sim.spawnHero(REG.hero('earthshaker'), {
      team: 0,
      pos: { x: 400, y: 500 },
      level: 10,
      ctrl: { kind: 'none' }
    });
    const unit = sim.spawnHero(REG.hero('pudge'), {
      team: 1,
      pos: { x: 540, y: 500 },
      level: 10,
      ctrl: { kind: 'none' }
    });
    const a = { x: 500, y: 300 };
    const b = { x: 500, y: 700 };
    sim.addZone({
      caster,
      ctx: { defId: 'test-wall', level: 1, vfx: { archetype: 'wall', color: '#aa8866' } },
      spec: { shape: 'line', width: 120, length: 400, duration: 5, wall: true },
      duration: 5,
      a,
      b,
      width: 120
    });

    resolveCollisions(sim, unit, true);

    expect(pointSegDist(unit.pos, a, b)).toBeGreaterThanOrEqual(60 + unit.radius - 0.1);
  });

  it('settles orders clicked against obstacle rims', () => {
    const sim = new Sim({
      seed: 24,
      bounds: { w: 2000, h: 2000 },
      obstacles: [{ pos: { x: 600, y: 500 }, radius: 80 }]
    });
    const unit = sim.spawnHero(REG.hero('juggernaut'), {
      team: 0,
      pos: { x: 420, y: 500 },
      level: 1,
      ctrl: { kind: 'none' }
    });
    unit.facing = 0;

    const clickedRim = { x: 704, y: 500 };
    let arrived = false;
    for (let i = 0; i < 300 && !arrived; i++) {
      arrived = steerToward(sim, unit, clickedRim, sim.dt, Math.max(12, unit.radius * 0.5));
    }

    expect(arrived).toBe(true);
    expect(dist(unit.pos, sim.obstacles[0].pos)).toBeGreaterThanOrEqual(sim.obstacles[0].radius + unit.radius - 0.1);
  });

  it('resolves the default unit body contract from a unit radius', () => {
    const sim = new Sim({ seed: 25, bounds: { w: 2000, h: 2000 } });
    const unit = sim.spawnHero(REG.hero('juggernaut'), {
      team: 0,
      pos: { x: 500, y: 500 },
      level: 1,
      ctrl: { kind: 'none' }
    });

    const bodies = resolveUnitBodies(unit);

    expect(bodies.movement.shape).toEqual({ kind: 'circle', radius: unit.radius });
    expect(bodies.movement.blocksMovement).toBe(true);
    expect(bodies.target.targetable).toBe(true);
    expect(bodies.hit.shape).toEqual({ kind: 'circle', radius: unit.radius });
    expect(bodies.pick.pickPadding).toBeGreaterThan(0);
  });

  it('widens hit and pick bodies for footprint-decoupled units', () => {
    const bodies = resolveUnitBodies({
      radius: 48,
      kind: 'hero',
      footprintDecoupled: true,
      visualFootprintRadius: 180
    });

    expect(bodies.movement.shape).toEqual({ kind: 'circle', radius: 48 });
    expect(bodies.hit.shape).toEqual({ kind: 'circle', radius: 180 });
    expect(bodies.target.shape).toEqual({ kind: 'circle', radius: 180 });
    expect(bodies.pick.shape).toEqual({ kind: 'circle', radius: 180 });
    expect(bodies.pick.pickPadding).toBeGreaterThan(18);
  });

  it('keeps named hit helpers in parity with current circle math', () => {
    const target = { pos: { x: 180, y: 0 }, radius: 80, kind: 'creep' as const };
    expect(zoneContainsUnit({ shape: 'circle', pos: { x: 100, y: 0 }, radius: 40, width: 0 }, target)).toBe(true);
    expect(projectileSegmentHitsUnit({ x: 0, y: 91 }, { x: 240, y: 91 }, 20, target)).toBe(false);
    expect(projectileSegmentHitsUnit({ x: 0, y: 80 }, { x: 240, y: 80 }, 20, target)).toBe(true);
  });

  it('normalizes authored static circle obstacles for movement collision', () => {
    const obstacle = staticCircleObstacle({
      pos: { x: 600, y: 500 },
      radius: 80,
      id: 'test-pillar',
      source: 'movement.test',
      feedbackLabel: 'Test pillar'
    });
    const sim = new Sim({ seed: 26, bounds: { w: 2000, h: 2000 }, obstacles: [obstacle] });
    const unit = sim.spawnHero(REG.hero('juggernaut'), {
      team: 0,
      pos: { x: 620, y: 500 },
      level: 1,
      ctrl: { kind: 'none' }
    });

    resolveCollisions(sim, unit, true);

    expect(sim.obstacles[0].body.shape).toEqual({ kind: 'circle', radius: 80 });
    expect(sim.obstacles[0].body.blocksMovement).toBe(true);
    expect(dist(unit.pos, sim.obstacles[0].pos)).toBeGreaterThanOrEqual(sim.obstacles[0].radius + unit.radius - 0.1);
  });

  it('detects projectile-blocking obstacle contacts along a swept segment', () => {
    const input = staticCircleObstacle({
      pos: { x: 180, y: 0 },
      radius: 40,
      id: 'blocking-pillar',
      blocksProjectiles: true
    });
    const sim = new Sim({ seed: 27, bounds: { w: 1000, h: 1000 }, obstacles: [input] });
    const obstacle = sim.obstacles[0];
    const hit = projectileSegmentHitsObstacle({ x: 0, y: 0 }, { x: 400, y: 0 }, 20, obstacle);

    expect(obstacleBlocksProjectiles(obstacle)).toBe(true);
    expect(hit).not.toBeNull();
    expect(hit?.pos.x).toBeCloseTo(130, 4);
  });

  it('blocks linear projectiles on the first projectile-blocking obstacle', () => {
    const sim = new Sim({
      seed: 28,
      bounds: { w: 1200, h: 800 },
      obstacles: [staticCircleObstacle({ pos: { x: 260, y: 400 }, radius: 45, id: 'test-pillar', blocksProjectiles: true })]
    });
    sim.events.captureAll = true;
    const caster = sim.spawnHero(REG.hero('lina'), { team: 0, pos: { x: 120, y: 400 }, level: 1, ctrl: { kind: 'none' } });
    const target = sim.spawnHero(REG.hero('axe'), { team: 1, pos: { x: 520, y: 400 }, level: 1, ctrl: { kind: 'none' } });
    sim.spawnProjectile(caster, { defId: 'test-linear', level: 1, vfx: { archetype: 'projectile', color: '#fff' } }, {
      model: 'linear',
      speed: 1200,
      width: 40,
      range: 900,
      onHit: [{ kind: 'damage', dtype: 'magical', amount: 10, target: 'target' }]
    }, { toPoint: target.pos });

    sim.run(0.2);

    expect(sim.events.history.some((e) => e.t === 'projectile-block' && e.obstacleId === 'test-pillar')).toBe(true);
    expect(sim.events.history.some((e) => e.t === 'projectile-hit')).toBe(false);
  });

  it('lets non-projectile-blocking obstacles pass linear projectiles through', () => {
    const sim = new Sim({
      seed: 29,
      bounds: { w: 1200, h: 800 },
      obstacles: [staticCircleObstacle({ pos: { x: 260, y: 400 }, radius: 45, id: 'tree', blocksProjectiles: false })]
    });
    sim.events.captureAll = true;
    const caster = sim.spawnHero(REG.hero('lina'), { team: 0, pos: { x: 120, y: 400 }, level: 1, ctrl: { kind: 'none' } });
    const target = sim.spawnHero(REG.hero('axe'), { team: 1, pos: { x: 360, y: 400 }, level: 1, ctrl: { kind: 'none' } });
    sim.spawnProjectile(caster, { defId: 'test-linear-pass', level: 1, vfx: { archetype: 'projectile', color: '#fff' } }, {
      model: 'linear',
      speed: 1200,
      width: 40,
      range: 900,
      onHit: [{ kind: 'damage', dtype: 'magical', amount: 10, target: 'target' }]
    }, { toPoint: target.pos });

    sim.run(0.25);

    expect(sim.events.history.some((e) => e.t === 'projectile-block')).toBe(false);
    expect(sim.events.history.some((e) => e.t === 'projectile-hit' && e.targetUid === target.uid)).toBe(true);
  });
});
