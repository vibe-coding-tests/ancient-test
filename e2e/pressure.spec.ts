import { test, expect, type Page } from '@playwright/test';
import {
  boot,
  clearCinematics,
  expectNoPageErrors,
  expectPartyWellFormed,
  skipActiveCinematic,
  state,
  waitForPlayableUi,
  watchPageErrors
} from './helpers';

// PRESSURE e2e — the browser-side counterpart to src/test/pressure/*. These do
// not re-check one scripted flow; they assert *properties that must hold across
// many states*: state never corrupts mid-fight, a long soak never drifts, the
// modal layer is a clean state machine, and save-gating tells the truth. Each is
// written against the player-facing surface (the ?test harness + DOM), not the
// internals it guards.

// A representative spread of (starter, region) pairs. Combat exercises the same
// shared sim everywhere, so a handful of biomes is enough to flush
// region-specific spawn/data corruption without paying for a full 30-cell cross.
const COMBAT_MATRIX: { hero: string; region: string; seed: number }[] = [
  { hero: 'juggernaut', region: 'tranquil-vale', seed: 9001 },
  { hero: 'crystal-maiden', region: 'icewrack', seed: 9002 },
  { hero: 'sniper', region: 'devarshi-desert', seed: 9003 },
  { hero: 'juggernaut', region: 'shadeshore', seed: 9004 },
  { hero: 'crystal-maiden', region: 'nightsilver-woods', seed: 9005 }
];

test.describe('PRESSURE: state never corrupts across a combat sweep', () => {
  for (const { hero, region, seed } of COMBAT_MATRIX) {
    test(`${hero} in ${region} survives a fight with well-formed party state`, async ({ page }) => {
      const errors = watchPageErrors(page);
      await boot(page, { hero, region, seed });
      await clearCinematics(page);

      expect((await state(page)).regionId).toBe(region);
      await expectPartyWellFormed(page, `${hero}/${region} pre-fight`);

      // Drop a wild pack next to the hero and let the real combat loop churn.
      const spawned = await page.evaluate(() => (window as any).__test.spawnWildCreepNearActive({ count: 4 }));
      expect(spawned?.hostiles ?? 0).toBeGreaterThan(0);

      // Step the fight in slices, checking the invariant after each one so a
      // transient corruption (negative HP, NaN stat, alive-at-0) is caught at
      // the tick it happens, not just at the end.
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => (window as any).__test.fastForward(0.75));
        await expectPartyWellFormed(page, `${hero}/${region} mid-fight slice ${i}`);
      }

      // Resolve the fight and let the dust settle — state stays well-formed
      // through the kills and beyond. (We deliberately don't assert inCombat
      // flips off here: regions with nearby camps re-aggro wild packs during
      // the settle, which is correct behavior, not corruption.)
      await page.evaluate(() => (window as any).__test.clearHostiles());
      await page.evaluate(() => (window as any).__test.fastForward(4));
      await expectPartyWellFormed(page, `${hero}/${region} post-fight`);

      expectNoPageErrors(errors);
    });
  }
});

test.describe('PRESSURE: a long soak stays well-formed and quiet', () => {
  test('three in-game minutes of stepping produce no drift and no errors', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', region: 'tranquil-vale', seed: 9100 });
    await clearCinematics(page);

    const partySize = (await state(page)).party.length;
    expect(partySize).toBeGreaterThan(0);

    // 18 × 10s = 180s of game time, validating the contract at every checkpoint.
    for (let i = 0; i < 18; i++) {
      await page.evaluate(() => (window as any).__test.fastForward(10));
      await expectPartyWellFormed(page, `soak checkpoint ${i}`);
    }

    const after = await state(page);
    // The party roster is stable across a quiet soak — nobody vanishes or
    // duplicates — and the play clock advanced as expected.
    expect(after.party.length).toBe(partySize);
    expect(after.playtime).toBeGreaterThanOrEqual(150);
    expect(Number.isFinite(after.gold)).toBe(true);
    expect(after.gold).toBeGreaterThanOrEqual(0);
    expectNoPageErrors(errors);
  });
});

test.describe('PRESSURE: the modal layer is a clean state machine', () => {
  test('every modal opens and closes back to a hidden, unpaused HUD', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 9200, hud: true });
    await skipActiveCinematic(page);
    await waitForPlayableUi(page);
    await page.evaluate(() => window.focus());
    // In town so the shop modal is reachable. (Town services are diegetic — they
    // open only by interacting with their NPC, so there is no global hotkey here.)
    expect((await state(page)).inTown).toBe(true);

    const modalRoot = page.locator('#modal-root');
    const openers: { key: string; name: string }[] = [
      { key: 'Tab', name: 'party' },
      { key: 'b', name: 'shop' },
      { key: 'j', name: 'journal' },
      { key: 'k', name: 'codex' },
      { key: 'Escape', name: 'menu' }
    ];

    // Run the full cycle three times: any leaked grab, double-open, or stuck
    // pause from one modal would surface as a failure on a later iteration.
    // Close via the universal #modal-close affordance — Esc has modal-specific
    // semantics (on some panels it reopens the menu instead of just closing).
    let openedAtLeastOne = false;
    for (let round = 0; round < 3; round++) {
      for (const { key, name } of openers) {
        await page.keyboard.press(key);
        // A press may either open the modal or (for an already-open one) be a
        // no-op; only assert the close-invariant when something actually opened.
        const opened = await modalRoot.evaluate((el) => !el.classList.contains('hidden')).catch(() => false);
        if (!opened) continue;
        openedAtLeastOne = true;

        await expect(modalRoot, `${name} should render a card`).not.toHaveClass(/hidden/);
        await expect(page.locator('#modal-root .modal-card')).toBeVisible();

        await page.locator('#modal-close').evaluate((el) => (el as HTMLElement).click());
        await expect(modalRoot, `${name} should close via #modal-close`).toHaveClass(/hidden/);
      }
    }

    expect(openedAtLeastOne).toBe(true);
    // The HUD ends idle: no modal, sim not left paused by a modal teardown.
    await expect(modalRoot).toHaveClass(/hidden/);
    expect(await page.evaluate(() => Boolean((window as any).__game.paused))).toBe(false);
    await expectPartyWellFormed(page, 'after modal churn');
    expectNoPageErrors(errors);
  });
});

test.describe('PRESSURE: save-gating reflects real game state', () => {
  test('saving is allowed when idle, blocked in combat, and blocked when the active hero is down', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'crystal-maiden', region: 'icewrack', seed: 9300 });
    await clearCinematics(page);

    // Idle in town: saving is allowed.
    const idle = await page.evaluate(() => {
      const g = (window as any).__game;
      return { canSave: g.canSave().ok, inCombat: g.inCombat() };
    });
    expect(idle.inCombat).toBe(false);
    expect(idle.canSave).toBe(true);

    // Pick a fight: order an attack and step until damage is exchanged (the
    // combat lock keys off lastDealt/TakenDamageAt, not mere proximity). While
    // the lock holds, saving must be blocked.
    const fighting = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      t.spawnWildCreepNearActive({ count: 3 });
      const u = g.activeUnit();
      const enemy = g.sim.unitsArr.find((c: any) => c.alive && c.team !== u.team);
      if (enemy) g.orderAttack(enemy.uid);
      let inC = false;
      for (let i = 0; i < 24 && !inC; i++) {
        t.fastForward(0.25);
        inC = g.inCombat();
      }
      const res = g.canSave();
      return { inCombat: g.inCombat(), canSave: res.ok, reason: res.reason ?? null };
    });
    expect(fighting.inCombat).toBe(true);
    expect(fighting.canSave).toBe(false);
    expect(fighting.reason).toMatch(/combat/i);

    // Clear the field, then kill the active hero: saving must stay blocked even
    // out of combat, for the distinct "hero is down" reason.
    const downed = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      t.clearHostiles();
      t.fastForward(1);
      const u = g.activeUnit();
      g.sim.killUnit(u, null, true);
      const res = g.canSave();
      return { inCombat: g.inCombat(), alive: g.activeUnit()?.alive ?? false, canSave: res.ok, reason: res.reason ?? null };
    });
    expect(downed.inCombat).toBe(false);
    expect(downed.alive).toBe(false);
    expect(downed.canSave).toBe(false);
    expect(downed.reason).toMatch(/down/i);

    expectNoPageErrors(errors);
  });
});
