import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { REG } from '../core/registry';
import { Game, newGameSave } from '../systems/game';
import { xpForLevel } from '../core/stats';
import type { CollisionObstacle, GameSave, Vec2 } from '../core/types';

beforeAll(() => registerAllContent());

// Real-world overworld journeys exercised through the FULL live Game.update loop
// (orders -> steering -> resolveCollisions -> pickups), not the isolated helpers.
// movement.test.ts proves resolveCollisions/projectile math in isolation and
// economy.test.ts proves a single ground pickup; these prove the situations a
// player actually creates while playing: bumping scenery, threading a gap,
// marching at the map edge, and hoovering up scattered loot until the bags fill.
//
// The headless scene ships no terrain obstacles, so the collision journeys inject
// a normalized blocker straight into the live sim — the exact shape
// normalizeCollisionObstacle emits for an authored prop.

function soloSave(heroId = 'juggernaut', level = 20): GameSave {
  const save = newGameSave(heroId);
  save.roster[0].level = level;
  save.roster[0].xp = xpForLevel(level);
  return save;
}

function headless(save: GameSave): Game {
  const g = Game.headless(save);
  // Headless cutscenes are off, but make sure nothing is mid-beat so update() steps.
  let guard = 0;
  while (g.cinematic.active && guard++ < 200) g.cinematicSkip();
  g.cinematic.clear();
  return g;
}

function blocker(x: number, y: number, radius: number, id: string, blocksProjectiles = false): CollisionObstacle {
  return {
    pos: { x, y },
    radius,
    id,
    source: 'overworld-scenarios.test',
    body: {
      layer: 'static',
      shape: { kind: 'circle', radius },
      blocksMovement: true,
      blocksProjectiles,
      blocksVision: false,
      feedback: { stopSound: 'stone', impactVfx: 'dust', label: id }
    }
  } as CollisionObstacle;
}

/** March the controlled hero toward `target`, returning the closest it ever came
 *  to each tracked obstacle centre and where it ended up. */
function marchToward(g: Game, target: Vec2, obstacles: CollisionObstacle[], ticks = 400): { minDist: number[]; end: Vec2 } {
  g.orderMove(target);
  const minDist = obstacles.map(() => Infinity);
  for (let i = 0; i < ticks; i++) {
    g.update(0.033);
    const p = g.controlledUnit()!.pos;
    obstacles.forEach((o, idx) => {
      const d = Math.hypot(p.x - o.pos.x, p.y - o.pos.y);
      if (d < minDist[idx]) minDist[idx] = d;
    });
    if (g.controlledUnit()!.order.kind === 'stop') break; // arrived
  }
  return { minDist, end: { ...g.controlledUnit()!.pos } };
}

describe('overworld collision in the live loop', () => {
  it('routes a hero ordered straight through a solid prop around it without clipping', () => {
    const g = headless(soloSave());
    const u = g.controlledUnit()!;
    const start = { x: 4000, y: 4000 };
    u.pos = { ...start };
    u.prevPos = { ...start };

    const radius = 130;
    const rock = blocker(start.x + 340, start.y, radius, 'live-rock');
    g.sim.obstacles.push(rock);

    const { minDist, end } = marchToward(g, { x: start.x + 700, y: start.y }, [rock]);
    const clearance = radius + u.radius;

    // Never clipped inside the rock at any tick...
    expect(minDist[0]).toBeGreaterThanOrEqual(clearance - 2);
    // ...and still made it around to the far side of the rock.
    expect(end.x).toBeGreaterThan(rock.pos.x + radius);
  });

  it('threads a hero past a wall of blockers with a gap and clips neither', () => {
    const g = headless(soloSave());
    const u = g.controlledUnit()!;
    const start = { x: 4000, y: 4000 };
    u.pos = { ...start };
    u.prevPos = { ...start };

    const radius = 110;
    const wallX = start.x + 360;
    // A gap-bearing wall straddling the straight path forward.
    const top = blocker(wallX, start.y - (radius + u.radius + 90), radius, 'wall-top');
    const bot = blocker(wallX, start.y + (radius + u.radius + 90), radius, 'wall-bot');
    g.sim.obstacles.push(top, bot);

    const { minDist, end } = marchToward(g, { x: start.x + 760, y: start.y }, [top, bot]);

    expect(minDist[0]).toBeGreaterThanOrEqual(radius + u.radius - 2);
    expect(minDist[1]).toBeGreaterThanOrEqual(radius + u.radius - 2);
    // Cleared the wall line entirely.
    expect(end.x).toBeGreaterThan(wallX + radius);
  });

  it('never lets a march walk a hero off the edge of the map', () => {
    const g = headless(soloSave());
    const u = g.controlledUnit()!;
    const bounds = g.sim.bounds;
    u.pos = { x: bounds.w - 200, y: bounds.h - 200 };
    u.prevPos = { ...u.pos };

    g.orderMove({ x: bounds.w + 9999, y: bounds.h + 9999 });
    const order = g.controlledUnit()!.order;
    expect(order.kind).toBe('move');
    if (order.kind === 'move') {
      expect(order.point.x).toBeLessThanOrEqual(bounds.w);
      expect(order.point.y).toBeLessThanOrEqual(bounds.h);
    }

    for (let i = 0; i < 200; i++) g.update(0.033);
    const p = g.controlledUnit()!.pos;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(bounds.w);
    expect(p.y).toBeLessThanOrEqual(bounds.h);
  });
});

describe('walking loot off the ground', () => {
  it("vacuums a creep's scattered drops into the bags until they are full, leaving the rest", () => {
    const g = headless(soloSave('sniper', 20));
    const u = g.activeUnit()!;
    // Clear the bags so the free-slot math is predictable, then scatter eight drops.
    for (let i = 0; i < u.items.length; i++) u.items[i] = null;
    const free = u.items.length;
    expect(free).toBe(6);

    const ids = ['broadsword', 'blades-of-attack', 'gauntlets-of-strength', 'boots-of-speed', 'belt-of-strength', 'robe-of-the-magi', 'ring-of-protection', 'quarterstaff'];
    const drops = g.spawnGroundItems(ids.map((id) => ({ id })), u.pos, { source: 'creep' });
    expect(g.groundItemDrops.length).toBe(ids.length);

    let pickedUp = 0;
    for (const drop of drops) {
      if (g.pickupGroundItem(drop.uid)) pickedUp++;
    }

    expect(pickedUp).toBe(free); // grabbed exactly a bagful
    expect(u.items.filter((it) => it).length).toBe(free); // bags full
    // The overflow the player couldn't carry is still lying on the ground.
    expect(g.groundItemDrops.length).toBe(ids.length - free);
  });

  it('salvages sub-threshold drops into essence as they are walked over', () => {
    const g = headless(soloSave('juggernaut', 20));
    const u = g.activeUnit()!;
    for (let i = 0; i < u.items.length; i++) u.items[i] = null;

    // Auto-salvage anything below arcana: a plain component is junk underfoot.
    g.setLootFilter({ autoDisenchantBelowRarity: 'arcana' });
    const essenceBefore = g.essence;

    const [drop] = g.spawnGroundItems([{ id: 'broadsword' }], u.pos, { source: 'creep' });
    const picked = g.pickupGroundItem(drop.uid);

    expect(picked).toBe(true); // the drop was consumed...
    expect(g.essence).toBeGreaterThan(essenceBefore); // ...into essence
    expect(u.items.filter((it) => it).length).toBe(0); // nothing entered the bags
    expect(g.groundItemDrops.length).toBe(0);
    // Salvaging is tracked as a gold-sink salvage.
    expect(g.goldSinks.salvages).toBeGreaterThan(0);
  });
});
