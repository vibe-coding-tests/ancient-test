import { test, expect } from '@playwright/test';
import { boot, clearCinematics, watchPageErrors, expectNoPageErrors } from './helpers';

// Swap-combat (SWAP_COMBAT_OVERHAUL) in the LIVE browser loop. The headless
// suite (src/test/swap-mechanics.test.ts) proves the contracts against Game
// directly; these specs prove the same verbs survive the real update loop,
// event routing, and — with ?hud=1 — the InputController + HUD gauge rings.
//
// Everything drives through window.__game / window.__test, the same surface
// the other overworld specs use. Each spec asserts the page never threw.

// Make the active hero count as "recently in combat" so tag boons + off-field
// persistence are eligible, and ensure Resonance is on for the overworld path.
const ENGAGE = `(function (g) {
  g.settings.resonance = true;
  const u = g.activeUnit();
  if (u) u.lastEnemyDamageAt = g.sim.time;
})`;

test.describe('swap — overworld tag-in through the live loop', () => {
  test('a gauge-ready swap in combat fires the hero tag boon (Earthshaker stun)', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 71 });
    await clearCinematics(page);
    await page.evaluate(() =>
      (window as any).__test.fillParty({ heroIds: ['earthshaker', 'sven', 'lich', 'luna'], level: 20 })
    );
    await clearCinematics(page); // recruiting party members can queue a cinematic that pauses update()

    const result = await page.evaluate((engageSrc) => {
      const engage = eval(engageSrc) as (g: any) => void;
      const g = (window as any).__game;
      g.sim.events.captureAll = true;
      engage(g);
      const a = g.activeUnit();
      // an inert dummy right next to the hero so Earthshaker's tag stun has a target
      const wild = (window as any).__test.spawnWildCreepNearActive({ count: 1 });
      const enemy = g.sim.unitsArr.find((u: any) => u.alive && u.team !== a.team);
      enemy.ctrl = { kind: 'none' };
      enemy.pos = { x: a.pos.x + 110, y: a.pos.y };
      enemy.prevPos = { ...enemy.pos };
      enemy.hp = enemy.stats.maxHp;

      const esIdx = g.party.findIndex((r: any) => r.heroId === 'earthshaker');
      engage(g);
      const swapped = g.trySwap(esIdx);
      for (let i = 0; i < 6; i++) (window as any).__test.step(33);

      const tagBoons = g.sim.events.history.filter((e: any) => e.t === 'tag-boon' && e.when === 'tag-in');
      return {
        wild: Boolean(wild),
        swapped,
        activeIdx: g.activeIdx,
        esIdx,
        tagBoonFired: tagBoons.length > 0,
        enemyStunned: enemy.summary.stunned === true || enemy.statuses.some((s: any) => s.status === 'stun')
      };
    }, ENGAGE);

    expect(result.swapped).toBe(true);
    expect(result.activeIdx).toBe(result.esIdx);
    expect(result.tagBoonFired).toBe(true);
    expect(result.enemyStunned).toBe(true);
    expectNoPageErrors(errors);
  });

  test('an offField channel keeps damaging from the bench after a swap-out', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'drow-ranger', seed: 72 });
    await clearCinematics(page);
    await page.evaluate(() => (window as any).__test.fillParty({ heroIds: ['juggernaut', 'sven'], level: 20 }));
    await clearCinematics(page);

    const result = await page.evaluate((engageSrc) => {
      const engage = eval(engageSrc) as (g: any) => void;
      const g = (window as any).__game;
      engage(g);
      const drow = g.activeUnit();
      drow.mana = drow.stats.maxMana;
      (window as any).__test.spawnWildCreepNearActive({ count: 1 });
      const enemy = g.sim.unitsArr.find((u: any) => u.alive && u.team !== drow.team);
      enemy.ctrl = { kind: 'none' };
      enemy.pos = { x: drow.pos.x + 120, y: drow.pos.y };
      enemy.prevPos = { ...enemy.pos };
      enemy.hp = enemy.stats.maxHp;

      const slot = drow.abilities.findIndex((ab: any) => ab.def.id === 'drow-multishot');
      drow.abilities[slot].level = 1;
      g.sim.order(drow.uid, { kind: 'cast', slot });
      (window as any).__test.fastForward(0.4); // through the 0.2s cast point → channel running
      const channelLive = drow.channel !== null;

      engage(g);
      const swapped = g.trySwap(1); // bench Drow mid-channel
      const benched = g.party[0].unit;
      const benchedOffField = benched && benched.offFieldUntil > g.sim.time;
      const benchedChannelLive = Boolean(benched && benched.channel);
      const hpAtSwap = enemy.hp;
      (window as any).__test.fastForward(0.7); // off-field ticks keep raining

      return {
        channelLive,
        swapped,
        benchedOffField,
        benchedChannelLive,
        damagedFromBench: enemy.hp < hpAtSwap
      };
    }, ENGAGE);

    expect(result.channelLive).toBe(true);
    expect(result.swapped).toBe(true);
    expect(result.benchedOffField).toBe(true);
    expect(result.benchedChannelLive).toBe(true);
    expect(result.damagedFromBench).toBe(true);
    expectNoPageErrors(errors);
  });

  test('a swap pressed during a cast point queues and never eats the cast (§8.3)', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'drow-ranger', seed: 73 });
    await clearCinematics(page);
    await page.evaluate(() => (window as any).__test.fillParty({ heroIds: ['juggernaut'], level: 20 }));
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const drow = g.activeUnit();
      drow.mana = drow.stats.maxMana;
      const slot = drow.abilities.findIndex((ab: any) => ab.def.id === 'drow-gust');
      drow.abilities[slot].level = 1;

      g.sim.order(drow.uid, { kind: 'cast', slot, point: { x: drow.pos.x + 400, y: drow.pos.y } });
      (window as any).__test.fastForward(0.05); // inside the 0.25s cast point
      const castingNow = drow.cast !== null;
      const projBefore = g.sim.projectiles.length;

      const queued = g.trySwap(1);
      const idxRightAfterQueue = g.activeIdx; // should still be 0 — queued, not executed

      (window as any).__test.fastForward(0.5); // cast fires, then the queued swap flushes
      return {
        castingNow,
        queued,
        idxRightAfterQueue,
        projAfter: g.sim.projectiles.length,
        castNotLost: g.sim.projectiles.length > projBefore || g.sim.events.history.some((e: any) => e.t === 'projectile-hit'),
        activeIdxAfter: g.activeIdx
      };
    });

    expect(result.castingNow).toBe(true);
    expect(result.queued).toBe(true);
    expect(result.idxRightAfterQueue).toBe(0); // not swapped yet
    expect(result.castNotLost).toBe(true);     // the Gust still fired
    expect(result.activeIdxAfter).toBe(1);     // queued swap executed afterwards
    expectNoPageErrors(errors);
  });

  test('the swap floor blocks a second immediate swap, then clears', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 74 });
    await clearCinematics(page);
    await page.evaluate(() => (window as any).__test.fillParty({ heroIds: ['axe', 'sven'], level: 20 }));
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const partyIds = g.party.map((r: any) => r.heroId);
      const first = g.trySwap(1);
      const second = g.trySwap(2); // still on the floor
      const idxBlocked = g.activeIdx;
      const floorAfterFirst = g.swapReadyAt - g.sim.time;
      (window as any).__test.fastForward(2.5);
      const third = g.trySwap(2);
      return {
        partyIds,
        partyLen: g.party.length,
        resonance: g.settings.resonance,
        floorAfterFirst,
        first,
        second,
        idxBlocked,
        third,
        idxAfter: g.activeIdx,
        simTime: g.sim.time
      };
    });

    const diag = JSON.stringify(result);
    expect(result.first, diag).toBe(true);
    expect(result.second, diag).toBe(false);
    expect(result.idxBlocked, diag).toBe(1);
    expect(result.third, diag).toBe(true);
    expect(result.idxAfter, diag).toBe(2);
    expectNoPageErrors(errors);
  });
});

test.describe('swap — WebGL presentation contracts', () => {
  test('a live swap emits the tag-in cue and keeps the arriving rig planted', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 78, webgl: true, quality: 'low' });
    await clearCinematics(page);
    await page.evaluate(() => (window as any).__test.fillParty({ heroIds: ['earthshaker'], level: 20 }));
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const t = (window as any).__test;
      const swapped = g.trySwap(1);
      const samples: { bodyY: number; scale: number; rootY: number; tagInT: number; visible: boolean }[] = [];

      // `hero-tag` is a presentation event: it is queued by trySwap and only drained
      // into g.frameEvents on the next update() — it never lands in sim.events.history.
      // Accumulate it from the live frame buffer each step, which is the exact buffer
      // the audio layer reads to fire swapTagIn(ev.boon).
      let heroTags = 0;
      for (let i = 0; i < 14; i++) {
        t.step(33);
        heroTags += (g.frameEvents ?? []).filter((e: any) => e.t === 'hero-tag').length;
        const active = g.activeUnit();
        const view = g.scene?.views?.get(active?.uid);
        if (!view) continue;
        samples.push({
          bodyY: view.rig.body.position.y,
          scale: view.rig.body.scale.x,
          rootY: view.rig.root.position.y,
          tagInT: view.anim.tagInT,
          visible: view.rig.root.visible
        });
      }

      const finite = samples.every((s) =>
        Number.isFinite(s.bodyY) && Number.isFinite(s.scale) && Number.isFinite(s.rootY) && s.visible
      );
      return {
        mode: t.mode,
        swapped,
        heroTags,
        sawTagInAnim: samples.some((s) => s.tagInT > 0),
        samples,
        finite,
        minBodyY: Math.min(...samples.map((s) => s.bodyY)),
        minScale: Math.min(...samples.map((s) => s.scale)),
        maxScale: Math.max(...samples.map((s) => s.scale)),
        finalScale: samples.at(-1)?.scale ?? 0,
        finalTagInT: samples.at(-1)?.tagInT ?? -1
      };
    });

    const diag = JSON.stringify(result);
    expect(result.mode, diag).toBe('webgl');
    expect(result.swapped, diag).toBe(true);
    expect(result.heroTags, diag).toBeGreaterThanOrEqual(1);
    expect(result.sawTagInAnim, diag).toBe(true); // the arrival flourish actually started on the rig
    expect(result.samples.length, diag).toBeGreaterThan(4);
    expect(result.finite, diag).toBe(true);
    expect(result.minBodyY, diag).toBeGreaterThanOrEqual(0);
    expect(result.minScale, diag).toBeGreaterThanOrEqual(0.78);
    expect(result.maxScale, diag).toBeLessThan(1.04);
    expect(result.finalScale, diag).toBeCloseTo(1, 5);
    expect(result.finalTagInT, diag).toBe(0);
    expectNoPageErrors(errors);
  });
});

test.describe('swap — HUD + input routing', () => {
  test('number keys swap the active overworld hero and the HUD survives the swap', async ({ page }) => {
    const errors = watchPageErrors(page);
    // ?hud=1 mounts the real InputController + HUD (party frames / gauge rings)
    // over the headless scene, so the keyboard path goes through input.ts.
    await boot(page, { hero: 'juggernaut', seed: 75, hud: true });
    await clearCinematics(page);
    await page.evaluate(() => (window as any).__test.fillParty({ heroIds: ['earthshaker', 'sven'], level: 20 }));
    await clearCinematics(page);

    const setup = await page.evaluate(() => {
      const g = (window as any).__game;
      g.settings.resonance = true;
      return { slot1Uid: g.party[1]?.unit?.uid ?? null, slot1Hero: g.party[1]?.heroId ?? null };
    });

    // '2' => swap-2 => overworld trySwap(1)
    await page.keyboard.press('2');
    await page.evaluate(() => (window as any).__test.step(33));

    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      return {
        activeIdx: g.activeIdx,
        controlledHero: g.party[g.activeIdx]?.heroId ?? null,
        partyFrames: document.querySelectorAll('[data-swap]').length
      };
    });

    expect(after.activeIdx).toBe(1);
    expect(after.controlledHero).toBe(setup.slot1Hero);
    expect(after.partyFrames).toBeGreaterThan(0); // the HUD party frames rendered
    expectNoPageErrors(errors);
  });
});
