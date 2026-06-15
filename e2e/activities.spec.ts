import { test, expect } from '@playwright/test';
import {
  attachElementScreenshot,
  boot,
  clearCinematics,
  expectNoPageErrors,
  state,
  waitForPlayableUi,
  watchPageErrors
} from './helpers';

// Common-player-activity coverage, layered on INTERACTION_VERIFICATION.md.
//
// That doc treats the deterministic sim + its SimEvent bus as the source of
// truth: a mechanic "works" when the right events fire after contact, and feel
// is the same event bus (a cast carries vfx + sound; an effect emits its
// declared event sequence; failures emit miss/immune-block). The interactions/*
// matrix proves this per effect KIND in isolation. These specs prove the same
// contract holds when a player actually plays — walking the overworld, wading
// into a creep camp, firing a kit, and watching the real renderer draw it —
// driven through the live Game + the ?test harness.
//
// The event bus only retains history when captureAll is on (it is off in normal
// play), so the combat/cast specs flip it on before acting and read
// g.sim.events.history, exactly like the headless interaction tests do.

test.describe('walking around the overworld', () => {
  test('a hero ordered across the map marches there and arrives', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 71 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const start = { x: 4000, y: 4000 };
      t.teleportActive(start.x, start.y);

      // Leg one: walk due east.
      const legOne = { x: start.x + 760, y: start.y };
      g.orderMove(legOne);
      let arrivedOne = false;
      for (let i = 0; i < 400 && !arrivedOne; i++) {
        t.step(33);
        const p = g.controlledUnit().pos;
        if (Math.hypot(p.x - legOne.x, p.y - legOne.y) < 60) arrivedOne = true;
      }
      const afterOne = { ...g.controlledUnit().pos };

      // Leg two: turn and walk south. A player wanders in legs like this.
      const legTwo = { x: afterOne.x, y: afterOne.y + 600 };
      g.orderMove(legTwo);
      let arrivedTwo = false;
      for (let i = 0; i < 400 && !arrivedTwo; i++) {
        t.step(33);
        const p = g.controlledUnit().pos;
        if (Math.hypot(p.x - legTwo.x, p.y - legTwo.y) < 60) arrivedTwo = true;
      }
      const end = { ...g.controlledUnit().pos };

      return {
        start,
        arrivedOne,
        arrivedTwo,
        traveled: Math.hypot(afterOne.x - start.x, afterOne.y - start.y) + Math.hypot(end.x - afterOne.x, end.y - afterOne.y),
        alive: g.controlledUnit().alive
      };
    });

    expect(result.alive).toBe(true);
    expect(result.arrivedOne).toBe(true);
    expect(result.arrivedTwo).toBe(true);
    // Covered real ground across the two legs.
    expect(result.traveled).toBeGreaterThan(1000);
    expectNoPageErrors(errors);
  });

  test('attack-moving into a wild pack auto-engages instead of walking past', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 72 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      t.addXp(120_000); // strong enough to actually trade blows
      const u = g.activeUnit();
      u.hp = u.stats.maxHp;
      g.sim.events.captureAll = true;
      const before = g.sim.events.history.length;

      // Drop a pack just ahead and attack-move *past* it: the order should pick
      // up the creeps en route rather than ignore them.
      const fight = t.spawnWildCreepNearActive({ count: 3 });
      const ahead = { x: u.pos.x + 900, y: u.pos.y };
      g.orderAttackMove(ahead);
      for (let i = 0; i < 240; i++) t.step(33);

      const fresh = g.sim.events.history.slice(before);
      const attackImpacts = fresh.filter((e: any) => e.t === 'attack-impact' && e.uid === u.uid).length;
      const damageDealt = fresh.filter((e: any) => e.t === 'damage' && e.from === u.uid).length;
      return {
        spawned: fight?.hostiles ?? 0,
        attackImpacts,
        damageDealt,
        alive: u.alive
      };
    });

    expect(result.spawned).toBeGreaterThan(0);
    // The hero swung at the pack rather than strolling past it.
    expect(result.attackImpacts).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(0);
    expectNoPageErrors(errors);
  });
});

test.describe('fighting creeps', () => {
  test('clearing a wild pack banks the bounty and emits the full kill sequence', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 73 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      t.addXp(120_000);
      const u = g.activeUnit();
      u.hp = u.stats.maxHp;
      u.mana = u.stats.maxMana;
      g.sim.events.captureAll = true;
      const before = g.sim.events.history.length;
      const goldBefore = g.gold;

      const fight = t.spawnWildCreepNearActive({ count: 3 });
      // Wade in and keep swinging until the pack is down (or we run out of patience).
      const target = { x: u.pos.x, y: u.pos.y };
      g.orderAttackMove({ x: target.x + 200, y: target.y });
      let hostiles = 99;
      for (let i = 0; i < 400; i++) {
        t.step(33);
        hostiles = g.sim.unitsArr.filter((c: any) => c.alive && c.team === 1 && c.kind !== 'npc').length;
        if (hostiles === 0) break;
      }
      t.fastForward(1); // drain kill-credit -> bounty

      const fresh = g.sim.events.history.slice(before);
      const has = (type: string) => fresh.some((e: any) => e.t === type);
      return {
        spawned: fight?.hostiles ?? 0,
        hostilesLeft: hostiles,
        hasDamage: has('damage'),
        hasDeath: has('death'),
        hasKillCredit: has('kill-credit'),
        goldGained: g.gold - goldBefore,
        alive: u.alive
      };
    });

    expect(result.spawned).toBe(3);
    expect(result.alive).toBe(true);
    expect(result.hasDamage).toBe(true);
    expect(result.hasDeath).toBe(true);
    expect(result.hasKillCredit).toBe(true);
    // The reward loop paid out for the kills.
    expect(result.goldGained).toBeGreaterThan(0);
    expectNoPageErrors(errors);
  });

  test('grinding a pack feeds XP back into a level-up', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'crystal-maiden', seed: 74 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      // Start at level 1 (cheap to level): force-clearing a few weak waves runs the
      // kill-credit -> bounty XP path deterministically, regardless of balance.
      const u = g.activeUnit();
      const levelBefore = u.level;
      const xpBefore = u.xp;

      for (let wave = 0; wave < 5; wave++) {
        t.spawnWildCreepNearActive({ count: 3 });
        t.fastForward(0.4);
        t.clearHostiles();
        t.fastForward(0.8); // drain kill-credit -> XP/bounty
      }

      const after = g.activeUnit();
      return {
        levelBefore,
        levelAfter: after.level,
        xpBefore,
        xpAfter: after.xp
      };
    });

    // Grinding fed XP into the hero...
    expect(result.xpAfter).toBeGreaterThan(result.xpBefore);
    // ...enough to climb at least one level from the start.
    expect(result.levelAfter).toBeGreaterThan(result.levelBefore);
    expectNoPageErrors(errors);
  });
});

test.describe('mechanical & presentation contract (INTERACTION_VERIFICATION §4)', () => {
  test('casting a kit emits cast events with vfx + sound and lands a declared effect', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'crystal-maiden', seed: 75 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      t.addXp(120_000);
      const u = g.activeUnit();
      u.hp = u.stats.maxHp;
      // addXp banks XP but doesn't auto-spend ability points, so force-learn the
      // castable kit (passives/auras/attack-mods aren't castable orders).
      const CASTABLE = new Set(['no-target', 'unit-target', 'point-target', 'skillshot', 'ground-aoe']);
      for (const a of u.abilities) {
        if (CASTABLE.has(a.def.targeting) && a.level <= 0) a.level = 1;
      }
      u.markStatsDirty?.();
      u.refresh(g.sim.time);

      g.sim.events.captureAll = true;
      const before = g.sim.events.history.length;

      // Keep a sturdy punching bag right next to the caster so range/target
      // never block a cast. Re-seat it before each cast in case it falls.
      const ensureEnemy = () => {
        let e = g.sim.unitsArr.find((c: any) => c.alive && c.team === 1 && c.kind !== 'npc');
        if (!e) {
          t.spawnWildCreepNearActive({ count: 1 });
          e = g.sim.unitsArr.find((c: any) => c.alive && c.team === 1 && c.kind !== 'npc');
        }
        if (e) {
          e.pos = { x: u.pos.x + 70, y: u.pos.y };
          e.prevPos = { ...e.pos };
          e.hp = e.stats.maxHp; // survive the nukes so unit-targets keep a target
        }
        return e;
      };

      let attempted = 0;
      for (let slot = 0; slot < u.abilities.length; slot++) {
        const a = u.abilities[slot];
        if (a.level <= 0 || !CASTABLE.has(a.def.targeting)) continue;
        const enemy = ensureEnemy();
        const point = enemy ? { x: enemy.pos.x, y: enemy.pos.y } : { x: u.pos.x + 70, y: u.pos.y };
        u.mana = u.stats.maxMana;
        const opts = a.def.targeting === 'unit-target'
          ? { uid: enemy?.uid }
          : a.def.targeting === 'no-target'
            ? {}
            : { point };
        g.castAbility(slot, opts);
        attempted++;
        t.fastForward(1.0);
      }

      const fresh = g.sim.events.history.slice(before);
      const casts = fresh.filter((e: any) => e.t === 'cast');
      const castsWithVfx = casts.filter((e: any) => e.vfx && typeof e.vfx === 'object');
      const castsWithSound = casts.filter((e: any) => typeof e.sound === 'string' && e.sound.length > 0);
      const effectKinds = new Set(
        fresh
          .filter((e: any) => ['damage', 'status-apply', 'aoe-burst', 'projectile-spawn', 'zone-spawn', 'heal'].includes(e.t))
          .map((e: any) => e.t)
      );
      return {
        attempted,
        castCount: casts.length,
        castsWithVfx: castsWithVfx.length,
        castsWithSound: castsWithSound.length,
        effectKinds: [...effectKinds]
      };
    });

    expect(result.attempted).toBeGreaterThan(0);
    // A real kit fired at least one active...
    expect(result.castCount).toBeGreaterThan(0);
    // ...and every cast carried the renderer's vfx + sound contract.
    expect(result.castsWithVfx).toBe(result.castCount);
    expect(result.castsWithSound).toBeGreaterThan(0);
    // ...and at least one declared effect actually resolved on the bus.
    expect(result.effectKinds.length).toBeGreaterThan(0);
    expectNoPageErrors(errors);
  });
});

test.describe('graphical check (WebGL renderer)', () => {
  test('the real renderer draws the overworld and a live fight without GL errors', async ({ page }, testInfo) => {
    // Full WebGL boot under SwiftShader is slow; give it the same headroom the
    // boot smoke test uses. 'low' quality skips the heavy preload chain.
    test.setTimeout(120_000);
    const errors = watchPageErrors(page);

    await boot(page, { webgl: true, hero: 'juggernaut', seed: 76, quality: 'low' });
    await waitForPlayableUi(page);
    await clearCinematics(page);

    // The canvas must hold a live GL context.
    const gl = await page.evaluate(() => {
      const c = document.getElementById('game-canvas') as HTMLCanvasElement | null;
      const ctx = c?.getContext('webgl2') ?? c?.getContext('webgl');
      return { hasGl: Boolean(ctx), lost: ctx ? (ctx as WebGLRenderingContext).isContextLost() : true };
    });
    expect(gl.hasGl).toBe(true);
    expect(gl.lost).toBe(false);

    // Stage a small crowd so the scene has units, VFX, and terrain to submit.
    const fight = await page.evaluate(() => (window as any).__test.spawnPerfFight({ units: 12, creepId: 'kobold', radius: 480 }));
    expect(fight).not.toBeNull();

    // Let the rAF loop render and sample a fresh frame window.
    await page.waitForTimeout(1200);
    await page.evaluate(() => (window as any).__test.resetGraphicsStats());
    await page.waitForTimeout(1500);

    const stats = await page.evaluate(() => (window as any).__test.graphicsStats());
    await attachElementScreenshot(page, testInfo, 'overworld-fight-webgl', '#game-canvas');

    expect(stats).not.toBeNull();
    // The renderer is actually submitting geometry, not a blank frame.
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(stats.triangles).toBeGreaterThan(0);
    expect(stats.frameMsP95).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(stats.dpr)).toBe(true);
    expect(stats.dpr).toBeGreaterThan(0);

    // The sim is still healthy after rendering.
    const s = await state(page);
    expect(s.ready).toBe(true);
    expect(s.mode).toBe('webgl');
    expect(s.party[0].alive).toBe(true);
    expectNoPageErrors(errors);
  });
});
