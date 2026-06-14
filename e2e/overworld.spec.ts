import { test, expect } from '@playwright/test';
import { boot, clearCinematics, state, watchPageErrors, expectNoPageErrors } from './helpers';

// Real-world overworld scenarios. The recent collision-hitbox work (props now
// carry movement/projectile bodies) and the loot rehaul (drops land on the
// ground and are walked over, not auto-banked) had unit coverage at the
// resolveCollisions / pickupGroundItem seams, but no in-browser proof that the
// LIVE game loop honours them while a player issues orders. These specs drive
// the headless harness through the situations a player actually hits:
//
//   - bumping into solid scenery and being routed around it
//   - clicking a move order onto a rock and being walked to its edge
//   - trying to walk off the edge of the world
//   - looting a fallen creep's drop off the ground
//   - finding the bags full when a drop is walked over
//   - a loot filter salvaging junk underfoot into essence
//   - leaving a region and abandoning the loot left on the ground
//
// The headless scene ships no terrain obstacles, so the collision specs inject
// a normalized obstacle straight into the live sim (the same shape
// normalizeCollisionObstacle produces) and then drive movement through it.

// A solid, movement-blocking circle obstacle in the live sim's own shape.
const INJECT_BLOCKER = `(function (sim, x, y, radius, id, blocksProjectiles) {
  const o = {
    pos: { x: x, y: y },
    radius: radius,
    id: id,
    source: 'overworld.spec',
    body: {
      layer: 'static',
      shape: { kind: 'circle', radius: radius },
      blocksMovement: true,
      blocksProjectiles: !!blocksProjectiles,
      blocksVision: false,
      feedback: { stopSound: 'stone', impactVfx: 'dust', label: id }
    }
  };
  sim.obstacles.push(o);
  return o;
})`;

test.describe('overworld — collision & navigation', () => {
  test('a solid boulder stops the hero and never lets them clip through it', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 61 });
    await clearCinematics(page);

    const result = await page.evaluate((injectSrc) => {
      const inject = eval(injectSrc) as (sim: any, x: number, y: number, r: number, id: string, bp?: boolean) => any;
      const t = (window as any).__test;
      const g = (window as any).__game;
      const u = g.controlledUnit();
      const start = { x: 4000, y: 4000 };
      t.teleportActive(start.x, start.y);

      const radius = 120;
      const boulder = { x: start.x + 320, y: start.y };
      inject(g.sim, boulder.x, boulder.y, radius, 'spec-boulder');

      // Order a move to the far side, straight through the boulder.
      g.orderMove({ x: start.x + 640, y: start.y });

      const heroR = u.radius;
      const clearance = radius + heroR;
      let minDist = Infinity;
      let penetrations = 0;
      for (let i = 0; i < 160; i++) {
        t.step(33);
        const p = g.controlledUnit().pos;
        const d = Math.hypot(p.x - boulder.x, p.y - boulder.y);
        if (d < minDist) minDist = d;
        if (d < clearance - 1.5) penetrations++;
      }
      const end = g.controlledUnit().pos;
      return {
        clearance,
        minDist,
        penetrations,
        movedFromStart: Math.hypot(end.x - start.x, end.y - start.y),
        alive: g.controlledUnit().alive,
        finite: Number.isFinite(end.x) && Number.isFinite(end.y)
      };
    }, INJECT_BLOCKER);

    expect(result.finite).toBe(true);
    expect(result.alive).toBe(true);
    // The hero pressed up against the boulder but never clipped inside it.
    expect(result.penetrations).toBe(0);
    expect(result.minDist).toBeGreaterThan(0);
    // It tried to move (didn't just freeze at the spawn point).
    expect(result.movedFromStart).toBeGreaterThan(40);
    expectNoPageErrors(errors);
  });

  test('a move clicked onto a rock is snapped to its walkable rim', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'sniper', seed: 62 });
    await clearCinematics(page);

    const result = await page.evaluate((injectSrc) => {
      const inject = eval(injectSrc) as (sim: any, x: number, y: number, r: number, id: string, bp?: boolean) => any;
      const g = (window as any).__game;
      const u = g.controlledUnit();
      const start = { x: 4000, y: 4000 };
      (window as any).__test.teleportActive(start.x, start.y);

      const radius = 140;
      const rock = { x: start.x + 360, y: start.y };
      inject(g.sim, rock.x, rock.y, radius, 'spec-rock');

      // Click the move order directly onto the centre of the rock.
      g.orderMove({ x: rock.x, y: rock.y });
      const order = g.controlledUnit().order;
      const orderPoint = order.kind === 'move' ? order.point : null;
      const orderDist = orderPoint ? Math.hypot(orderPoint.x - rock.x, orderPoint.y - rock.y) : 0;

      // Let the hero walk to wherever the order settled.
      for (let i = 0; i < 200; i++) (window as any).__test.step(33);
      const p = g.controlledUnit().pos;
      return {
        heroR: u.radius,
        radius,
        orderKind: order.kind,
        orderDist,
        finalDist: Math.hypot(p.x - rock.x, p.y - rock.y)
      };
    }, INJECT_BLOCKER);

    // The order point itself was pushed outside the rock body, not left at its centre.
    expect(result.orderKind).toBe('move');
    expect(result.orderDist).toBeGreaterThanOrEqual(result.radius - 1);
    // And the hero ends up resting against the rim, never inside the rock.
    expect(result.finalDist).toBeGreaterThanOrEqual(result.radius + result.heroR - 4);
    expectNoPageErrors(errors);
  });

  test('the hero cannot be ordered off the edge of the world', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 63 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const u = g.controlledUnit();
      const bounds = g.sim.bounds;
      // Slam an order far past the south-east corner of the map.
      g.orderMove({ x: bounds.w + 50_000, y: bounds.h + 50_000 });
      const order = g.controlledUnit().order;
      const orderPoint = order.kind === 'move' ? order.point : null;
      for (let i = 0; i < 240; i++) t.step(33);
      const p = g.controlledUnit().pos;
      return {
        bounds,
        heroR: u.radius,
        orderPoint,
        pos: p,
        finite: Number.isFinite(p.x) && Number.isFinite(p.y)
      };
    });

    expect(result.finite).toBe(true);
    // The order point was clamped inside the playable bounds.
    expect(result.orderPoint!.x).toBeLessThanOrEqual(result.bounds.w);
    expect(result.orderPoint!.y).toBeLessThanOrEqual(result.bounds.h);
    // The hero stayed on the map.
    expect(result.pos.x).toBeGreaterThanOrEqual(0);
    expect(result.pos.y).toBeGreaterThanOrEqual(0);
    expect(result.pos.x).toBeLessThanOrEqual(result.bounds.w);
    expect(result.pos.y).toBeLessThanOrEqual(result.bounds.h);
    expectNoPageErrors(errors);
  });
});

test.describe('overworld — loot off the ground', () => {
  test("a fallen creep's drop is looted off the ground into the active hero", async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 64 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const u = g.activeUnit();
      const before = u.items.filter((it: any) => it).length;
      const dropPos = { x: u.pos.x + 90, y: u.pos.y + 30 };

      // Loot the wilds leave behind lands on the ground (loot rehaul), not in a bag.
      const [drop] = g.spawnGroundItems([{ id: 'broadsword' }], dropPos, { source: 'creep' });
      const onGroundBefore = g.visibleGroundItemDrops().length;
      const codexBefore = g.codexUnlocks.has('item:broadsword');

      const picked = g.pickupGroundItem(drop.uid);
      const after = u.items.filter((it: any) => it).length;
      return {
        onGroundBefore,
        picked,
        before,
        after,
        onGroundAfter: g.visibleGroundItemDrops().length,
        hasItem: u.items.some((it: any) => it && it.defId === 'broadsword'),
        codexBefore,
        codexAfter: g.codexUnlocks.has('item:broadsword')
      };
    });

    expect(result.onGroundBefore).toBe(1);
    expect(result.picked).toBe(true);
    expect(result.after).toBe(result.before + 1);
    expect(result.hasItem).toBe(true);
    expect(result.onGroundAfter).toBe(0);
    // First time the player holds a broadsword it unlocks its codex entry.
    expect(result.codexBefore).toBe(false);
    expect(result.codexAfter).toBe(true);
    expectNoPageErrors(errors);
  });

  test('a full inventory leaves a walked-over drop on the ground', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 65 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const t = (window as any).__test;
      t.addGold(100_000);
      t.addXp(120_000); // max level so no item level-gate blocks a purchase
      const u = g.activeUnit();
      // Fill all six slots from whatever this region's shop actually stocks.
      for (const id of g.region.shopInventory) {
        if (u.items.filter((it: any) => it).length >= 6) break;
        if (g.shopSells(id)) g.buyItem(id);
      }
      const filled = u.items.filter((it: any) => it).length;

      const [drop] = g.spawnGroundItems([{ id: 'mithril-hammer' }], u.pos, { source: 'creep' });
      const picked = g.pickupGroundItem(drop.uid);
      return {
        filled,
        picked,
        stillOnGround: g.visibleGroundItemDrops().some((d: any) => d.uid === drop.uid),
        gotHammer: u.items.some((it: any) => it && it.defId === 'mithril-hammer')
      };
    });

    expect(result.filled).toBe(6);
    expect(result.picked).toBe(false); // bags full
    expect(result.stillOnGround).toBe(true);
    expect(result.gotHammer).toBe(false);
    expectNoPageErrors(errors);
  });

  test('a loot filter salvages junk underfoot into essence instead of bagging it', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 66 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const u = g.activeUnit();
      // Auto-salvage anything below arcana: a plain component is junk underfoot.
      g.setLootFilter({ autoDisenchantBelowRarity: 'arcana' });

      const essenceBefore = g.essence;
      const bagBefore = u.items.filter((it: any) => it).length;
      const [drop] = g.spawnGroundItems([{ id: 'broadsword' }], u.pos, { source: 'creep' });

      const picked = g.pickupGroundItem(drop.uid);
      return {
        picked,
        essenceBefore,
        essenceAfter: g.essence,
        bagBefore,
        bagAfter: u.items.filter((it: any) => it).length,
        onGround: g.visibleGroundItemDrops().length,
        bagged: u.items.some((it: any) => it && it.defId === 'broadsword')
      };
    });

    // pickupGroundItem reports true because the drop was consumed (salvaged).
    expect(result.picked).toBe(true);
    expect(result.essenceAfter).toBeGreaterThan(result.essenceBefore);
    expect(result.bagAfter).toBe(result.bagBefore); // nothing entered the bags
    expect(result.bagged).toBe(false);
    expect(result.onGround).toBe(0); // it left the ground either way
    expectNoPageErrors(errors);
  });
});

test.describe('overworld — leaving a region', () => {
  test('travelling out of a region abandons loose ground loot but keeps the party and gold', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 67 });
    await clearCinematics(page);

    const before = await page.evaluate(() => {
      const g = (window as any).__game;
      const t = (window as any).__test;
      t.addGold(5000);
      // A progressed player: a full recruited party and the region's badges, so
      // the onward route gate is open.
      t.fillParty({ level: 20 });
      const u = g.activeUnit();
      // Leave a drop on the ground that the player never bothered to grab.
      g.spawnGroundItems([{ id: 'broadsword' }], { x: u.pos.x + 200, y: u.pos.y }, { source: 'creep' });

      // Take the first authored route gate, satisfying whatever it asks for.
      const region = g.region;
      const gate = (region.gates ?? [])[0] ?? null;
      let traveled = false;
      let targetRegion: string | null = null;
      if (gate) {
        if (gate.requiredBadge) g.badges.add(gate.requiredBadge);
        t.teleportActive(gate.pos.x, gate.pos.y);
        targetRegion = gate.toRegionId;
        traveled = g.tryTravel();
      }
      return {
        regionId: g.region.id,
        gold: Math.round(g.gold),
        partyLen: g.party.length,
        heroId: g.party[0].heroId,
        groundBefore: g.groundItemDrops.length,
        hasGate: Boolean(gate),
        traveled,
        targetRegion
      };
    });

    // Some regions might not author a gate; only assert the journey when one exists.
    test.skip(!before.hasGate, 'region has no route gate to travel through');
    expect(before.groundBefore).toBeGreaterThan(0);
    expect(before.traveled).toBe(true);

    // tryTravel dispatches a load event that rebuilds the game in the new region.
    await page.waitForFunction(
      (want) => {
        const g = (window as any).__game;
        return Boolean(g) && g.region?.id === want;
      },
      before.targetRegion,
      { timeout: 30_000 }
    );

    const after = await state(page);
    const detail = await page.evaluate(() => {
      const g = (window as any).__game;
      return { ground: g.groundItemDrops.length, gold: Math.round(g.gold), heroId: g.party[0].heroId };
    });

    expect(after.regionId).toBe(before.targetRegion);
    // The loot left on the old region's ground is gone.
    expect(detail.ground).toBe(0);
    // The party and the gold came along.
    expect(after.party.length).toBe(before.partyLen);
    expect(detail.heroId).toBe(before.heroId);
    expect(detail.gold).toBeGreaterThanOrEqual(before.gold);
    expectNoPageErrors(errors);
  });
});
