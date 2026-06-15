import { test, expect, type Page } from '@playwright/test';
import { boot, expectNoPageErrors, fastForward, skipActiveCinematic, waitForPlayableUi, watchPageErrors } from './helpers';

// ============================================================
// AFFORDANCE FEEDBACK (e2e) — the player-reachable bugs that the
// headless sim can't see because they live in the input -> HUD seam.
//
//   - "talents don't work, can't spend skill points": a reachable
//     spend button that no-ops.
//   - "left click to inspect does nothing": a click that changes
//     selection but never pins the inspect card.
//   - the Journal binding actually opening the Journal.
//
// These drive the real HUD/input the way a player does and assert
// the visible result, not just internal state.
// ============================================================

const MODAL_CARD = '#modal-root:not(.hidden) .modal-card';

async function focusGame(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__test?.state && (window as any).__game), null, { timeout: 30_000 });
  await waitForPlayableUi(page);
  await page.evaluate(() => window.focus());
}

test.describe('affordance feedback', () => {
  test('spending a skill point through the hero panel actually ranks an ability', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 9301, hud: true });
    await skipActiveCinematic(page);
    await focusGame(page);

    // Level the active hero so points are pending, then let the HUD repaint.
    await page.evaluate(() => (window as any).__test.addXp(40000));
    await fastForward(page, 0.2);

    const before = await page.evaluate(() => {
      const g = (window as any).__game;
      const rec = g.party[g.activeIdx];
      return {
        pending: g.pendingAbilityPoints(rec),
        ranks: rec.unit.abilities.map((a: any) => a.level)
      };
    });
    expect(before.pending).toBeGreaterThan(0);

    // Find the first enabled "+" spend button the player could actually click.
    const slot = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#hero-panel .ab-plus[data-skill]')] as HTMLButtonElement[];
      const live = btns.find((b) => !b.disabled);
      return live ? Number(live.dataset.skill) : -1;
    });
    expect(slot, 'a live skill-spend button is present').toBeGreaterThanOrEqual(0);

    await page.locator(`#hero-panel .ab-plus[data-skill="${slot}"]`).evaluate((el) => (el as HTMLElement).click());
    await fastForward(page, 0.1);

    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      const rec = g.party[g.activeIdx];
      return {
        pending: g.pendingAbilityPoints(rec),
        ranks: rec.unit.abilities.map((a: any) => a.level)
      };
    });

    expect(after.pending).toBe(before.pending - 1);
    expect(after.ranks[slot]).toBe(before.ranks[slot] + 1);
    expectNoPageErrors(errors);
  });

  test('J opens the Quest Journal', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 9302, hud: true });
    await skipActiveCinematic(page);
    await focusGame(page);

    // Closed to start, the J binding opens the Journal (not the menu, which also
    // has a "Journal" label — the menu is the only modal with a [data-mtab] tab strip).
    await expect(page.locator('#modal-root')).toHaveClass(/hidden/);
    await page.keyboard.press('j');
    await expect(page.locator(MODAL_CARD)).toContainText('Journal');
    expect(await page.locator('#modal-root [data-mtab]').count(), 'opened the Journal, not the menu').toBe(0);
    expectNoPageErrors(errors);
  });

  test('every interface key opens its panel and closes cleanly', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 9304, hud: true });
    await skipActiveCinematic(page);
    await focusGame(page);
    // Default boot lands in town, so the Shop (B) is reachable here too.
    expect((await page.evaluate(() => (window as any).__test.state().inTown))).toBe(true);

    // Each interface binding must open *a* modal (none may be a dead key).
    const panels: { key: string; label: string }[] = [
      { key: 'Tab', label: 'party' },
      { key: 'b', label: 'shop' },
      { key: 'j', label: 'journal' },
      { key: 'k', label: 'codex' },
      { key: 'h', label: 'character' }
    ];

    for (const panel of panels) {
      await expect(page.locator('#modal-root'), `${panel.label}: starts closed`).toHaveClass(/hidden/);
      await page.keyboard.press(panel.key);
      await expect(page.locator(MODAL_CARD), `${panel.label}: ${panel.key} opened a panel`).toBeVisible();
      // Close via the modal's own X so the next key starts from a clean slate.
      await page.locator('#modal-close').click();
      await expect(page.locator('#modal-root'), `${panel.label}: closes cleanly`).toHaveClass(/hidden/);
    }
    expectNoPageErrors(errors);
  });

  test('left-clicking a unit pins its inspect card (does not just silently select)', async ({ page }) => {
    // Full WebGL boot under SwiftShader comfortably exceeds the 30s default.
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    // Real renderer so scene.pick() can project the click to a unit.
    await boot(page, { hero: 'juggernaut', seed: 9303, hud: true, webgl: true, quality: 'low' });
    await skipActiveCinematic(page);
    await focusGame(page);

    const box = await page.locator('#game-canvas').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // The camera follows the active hero, so the unit sits near screen centre
    // (slightly low under the angled follow cam). Use REAL mouse moves so the
    // rAF loop recomputes hover, scanning a vertical strip until it resolves a unit.
    let target: { x: number; y: number } | null = null;
    for (let dy = -40; dy <= 180 && !target; dy += 20) {
      await page.mouse.move(cx, cy + dy);
      await page.waitForTimeout(120); // let a couple of rAF frames re-pick
      const hover = await page.evaluate(() => (window as any).__test.inputState()?.hoverUid ?? -1);
      if (hover >= 0) target = { x: cx, y: cy + dy };
    }
    expect(target, 'a unit was hovered near screen centre').not.toBeNull();

    await page.mouse.click(target!.x, target!.y, { button: 'left' });
    await page.waitForTimeout(120);

    const inspect = await page.evaluate(() => (window as any).__test.inputState()?.inspectUid ?? -1);
    expect(inspect, 'left-click pinned an inspect target').toBeGreaterThanOrEqual(0);
    expectNoPageErrors(errors);
  });
});
