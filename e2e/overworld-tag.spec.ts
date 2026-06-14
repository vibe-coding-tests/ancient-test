import { test, expect } from '@playwright/test';
import { boot, clearCinematics, watchPageErrors, expectNoPageErrors } from './helpers';

// SWAP_COMBAT_OVERHAUL browser coverage. The headless suite proves the tag math;
// these specs prove the LIVE overworld loop honours it end to end — the Tag Gauge
// gating a boon, the Tag Chain escalating across quick swaps, the dull beat on a
// drained gauge, off-field persistence under Resonance, the reaction preview, and
// that the real HUD surfaces the gauges, boon lines, and next-link hint. Raid
// driver-swap was already covered; the overworld tag verbs were not.
//
// Everything drives the real `__game` through the `?test` harness. Combat is faked
// deterministically by spawning adjacent wild creeps and stamping the active hero's
// last-damage clock, so `partyRecentlyInCombat()` is true without waiting on AI.

/** Build a party (active + benched ids), drop adjacent hostiles, and mark combat. */
const SETUP = `(function (heroIds) {
  const t = window.__test;
  const g = window.__game;
  t.fillParty({ heroIds: heroIds });
  t.skipCinematics();
  t.spawnWildCreepNearActive({ count: 2 });
  const u = g.activeUnit();
  u.lastEnemyDamageAt = g.sim.time;
  for (const rec of g.party) {
    rec.lastCombatAt = g.sim.time;
    if (rec.unit) rec.unit.lastEnemyDamageAt = g.sim.time;
  }
  return { partyLen: g.party.length, activeIdx: g.activeIdx };
})`;

test.describe('overworld — swap/tag combat', () => {
  test('a ready Tag Gauge fires a boon on swap-in and then goes on cooldown', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 71 });
    await clearCinematics(page);

    const result = await page.evaluate((setupSrc) => {
      const setup = eval(setupSrc) as (ids: string[]) => { partyLen: number };
      const g = (window as any).__game;
      const party = setup(['earthshaker']);
      g.sim.events.captureAll = true;
      const before = { ...g.party[1] }.tagGaugeReadyAt;

      const swapped = g.trySwap(1);
      const enemyStunned = g.sim.unitsArr.some(
        (u: any) => u.team !== g.activeUnit().team && u.alive && u.statuses.some((s: any) => s.status === 'stun')
      );
      return {
        partyLen: party.partyLen,
        swapped,
        boonFired: g.sim.events.history.some((e: any) => e.t === 'tag-boon' && e.when === 'tag-in'),
        enemyStunned,
        gaugeBefore: before,
        gaugeAfter: g.party[1].tagGaugeReadyAt,
        now: g.sim.time
      };
    }, SETUP);

    expect(result.partyLen).toBeGreaterThanOrEqual(2);
    expect(result.swapped).toBe(true);
    expect(result.boonFired).toBe(true);
    expect(result.enemyStunned).toBe(true);             // Earthshaker's Lockdown tag landed
    expect(result.gaugeBefore).toBeLessThanOrEqual(result.now);
    expect(result.gaugeAfter).toBeGreaterThan(result.now); // gauge spent → on cooldown
    expectNoPageErrors(errors);
  });

  test('consecutive tag-ins build an escalating Tag Chain', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 72 });
    await clearCinematics(page);

    const result = await page.evaluate((setupSrc) => {
      const setup = eval(setupSrc) as (ids: string[]) => unknown;
      const t = (window as any).__test;
      const g = (window as any).__game;
      setup(['earthshaker', 'sven']);

      const first = g.trySwap(1);
      g.swapReadyAt = g.sim.time;          // clear the swap floor without advancing live combat (no death drift)
      const second = g.trySwap(2);
      const chain = g.combatReadout().tagChain;
      return { first, second, count: chain?.count ?? 0, ampPct: chain?.ampPct ?? 0 };
    }, SETUP);

    expect(result.first).toBe(true);
    expect(result.second).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(2);
    expect(result.ampPct).toBeGreaterThan(0);
    expectNoPageErrors(errors);
  });

  test('swapping with a drained gauge plays the dull beat, not a boon', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 73 });
    await clearCinematics(page);

    const result = await page.evaluate((setupSrc) => {
      const setup = eval(setupSrc) as (ids: string[]) => unknown;
      const g = (window as any).__game;
      setup(['earthshaker']);
      g.sim.events.captureAll = true;
      g.party[1].tagGaugeReadyAt = g.sim.time + 30; // gauge down

      const swapped = g.trySwap(1);
      return {
        swapped,
        dullBeat: g.sim.events.history.some((e: any) => e.t === 'swap-flat'),
        boonFired: g.sim.events.history.some((e: any) => e.t === 'tag-boon')
      };
    }, SETUP);

    expect(result.swapped).toBe(true);
    expect(result.dullBeat).toBe(true);
    expect(result.boonFired).toBe(false);
    expectNoPageErrors(errors);
  });

  test('a benched hero persists off-field after a combat swap under Resonance', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 74 });
    await clearCinematics(page);

    const result = await page.evaluate((setupSrc) => {
      const setup = eval(setupSrc) as (ids: string[]) => unknown;
      const g = (window as any).__game;
      g.setResonanceEnabled(true);
      setup(['sven']);

      const swapped = g.trySwap(1);                  // bench Juggernaut mid-combat
      const benched = g.party[0].unit;
      const readout = g.combatReadout();
      return {
        swapped,
        benchedStillInSim: !!benched && benched.alive,
        offFieldUntil: benched?.offFieldUntil ?? 0,
        offFieldCount: readout.offField.count,
        now: g.sim.time
      };
    }, SETUP);

    expect(result.swapped).toBe(true);
    expect(result.benchedStillInSim).toBe(true);
    expect(result.offFieldUntil).toBeGreaterThan(result.now);
    expect(result.offFieldCount).toBeGreaterThanOrEqual(1);
    expectNoPageErrors(errors);
  });

  test('a ready elemental tag previews its reaction against a nearby aura', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 75 });
    await clearCinematics(page);

    const result = await page.evaluate((setupSrc) => {
      const setup = eval(setupSrc) as (ids: string[]) => unknown;
      const g = (window as any).__game;
      g.setResonanceEnabled(true);
      setup(['lina', 'crystal-maiden']);

      g.trySwap(1);                                  // Lina (pyro) tags in, seeding a pyro aura
      const preview = g.tagReactionPreview(2);       // Crystal Maiden (cryo) is benched + ready
      g.setResonanceEnabled(false);
      const offPreview = g.tagReactionPreview(2);
      return { reaction: preview?.reaction ?? null, offPreview };
    }, SETUP);

    expect(result.reaction).toBe('melt');            // pyro + cryo
    expect(result.offPreview).toBeNull();            // no preview with Resonance off
    expectNoPageErrors(errors);
  });

  test('the HUD shows tag gauges, the boon line, and the next-link hint', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 76, hud: true });
    await clearCinematics(page);

    const readout = await page.evaluate((setupSrc) => {
      const setup = eval(setupSrc) as (ids: string[]) => unknown;
      const t = (window as any).__test;
      const g = (window as any).__game;
      setup(['omniknight', 'sniper']);
      for (let i = 0; i < 6; i++) {
        g.activeUnit().lastEnemyDamageAt = g.sim.time; // keep the combat clock hot across renders
        t.step(33);
      }
      const r = g.combatReadout();
      return { active: r.active, nextLink: r.nextLink };
    }, SETUP);

    expect(readout.active).toBe(true);
    expect(readout.nextLink?.heroId).toBe('omniknight');
    await expect(page.locator('.party-frame .tag-gauge').first()).toBeVisible();
    await expect(page.locator('.party-frame .tag-line').first()).toContainText('TAG');

    const nextLink = page.locator('#combat-readout .next-link-line');
    await expect(nextLink).toBeVisible();
    await expect(nextLink).toContainText('Omniknight'); // the team-heal boon out-values Sniper's selfish crumb
    expectNoPageErrors(errors);
  });

  test('the opt-in charge meter lets you swap twice with no floor, then refills', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 77 });
    await clearCinematics(page);

    const result = await page.evaluate((setupSrc) => {
      const setup = eval(setupSrc) as (ids: string[]) => unknown;
      const t = (window as any).__test;
      const g = (window as any).__game;
      setup(['earthshaker', 'sven']);
      g.setSwapChargesEnabled(true);

      const startCharges = g.swapChargeState()?.current ?? 0;
      const first = g.trySwap(1);            // 2 -> 1
      const second = g.trySwap(2);           // 1 -> 0, no floor wait between them
      const third = g.trySwap(0);            // blocked: out of charges
      t.fastForward(3.5);                    // a charge refills
      const fourth = g.trySwap(0);
      return { startCharges, first, second, third, fourth };
    }, SETUP);

    expect(result.startCharges).toBeCloseTo(2);
    expect(result.first).toBe(true);
    expect(result.second).toBe(true);
    expect(result.third).toBe(false);
    expect(result.fourth).toBe(true);
    expectNoPageErrors(errors);
  });
});
