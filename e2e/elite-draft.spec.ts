import { test, expect, type Page } from '@playwright/test';
import {
  attachElementScreenshot,
  boot,
  clearCinematics,
  expectNoPageErrors,
  watchPageErrors
} from './helpers';

const MODAL_CARD = '#modal-root:not(.hidden) .modal-card';
const POOL_CHIP = (id: string): string => `[data-ed-pick="${id}"]`;

/**
 * Recruit exactly `ids` and open the Elite Five pick/ban screen. Mirrors the
 * real `[data-elite]` button handler (`beginEliteDraft()` then `openEliteDraft()`)
 * without first walking the whole gauntlet-progression UI to reach that button.
 */
async function openEliteDraft(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((recruited) => {
    const g = (window as any).__game;
    const hud = (window as any).__hud;
    g.recruited = new Set(recruited);
    if (!g.beginEliteDraft()) throw new Error('beginEliteDraft refused for a valid roster');
    hud.openEliteDraft();
  }, ids);
  await expect(page.locator(MODAL_CARD)).toContainText('Elite Five');
}

/** The first legal enemy-pool hero the player can ban right now. */
async function firstLegalEnemyBan(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.eliteDraft;
    const taken = new Set([...s.bans, ...s.player.map((h: any) => h.heroId), ...s.enemy.map((h: any) => h.heroId)]);
    return [...new Set<string>(s.enemyPool)].find((id) => !taken.has(id))!;
  });
}

test.describe('elite five — interactive pick/ban draft', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a minimum five-hero roster drafts a full five through the UI and commits (no soft-lock)', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 808, hud: true });
    await clearCinematics(page);

    // Exactly five recruited heroes — the minimum beginEliteDraft allows. The
    // leader's ban must NOT remove one of these, or the player can never field a
    // fifth pick (the regression this guards against).
    const roster = ['juggernaut', 'sven', 'sniper', 'lich', 'lina'];
    await openEliteDraft(page, roster);
    await attachElementScreenshot(page, testInfo, 'elite-01-draft-open', MODAL_CARD);

    // Step 0 is the player's ban from the leader's pool.
    await page.locator(POOL_CHIP(await firstLegalEnemyBan(page))).click();

    // With the minimum roster the foe's ban is skipped, so every recruited hero
    // stays pickable. Pick all five through the real chip buttons.
    for (const id of roster) {
      await expect(page.locator(POOL_CHIP(id))).toBeEnabled();
      await page.locator(POOL_CHIP(id)).click();
    }

    await expect(page.locator(MODAL_CARD)).toContainText('Your five (5/5)');
    await expect(page.locator(`${MODAL_CARD} .ed-team.you .ed-slot:not(.empty)`)).toHaveCount(5);
    await attachElementScreenshot(page, testInfo, 'elite-02-draft-full-five', MODAL_CARD);

    const state = await page.evaluate(() => {
      const g = (window as any).__game;
      const s = g.eliteDraft;
      return { playerIds: s.player.map((h: any) => h.heroId), bans: [...s.bans], done: g.eliteDraftTurn()?.done };
    });
    expect(state.done).toBe(true);
    expect(state.playerIds.slice().sort()).toEqual(roster.slice().sort());
    for (const banned of state.bans) expect(roster).not.toContain(banned);

    // The commit button unlocks and accepts the draft. A soft-locked draft would
    // leave `eliteDraft` non-null (commit refuses an incomplete five); a clean
    // commit nulls it before running the match.
    const commit = page.locator('[data-ed="commit"]');
    await expect(commit).toBeEnabled();
    await commit.click();
    expect(await page.evaluate(() => (window as any).__game.eliteDraft)).toBeNull();
    expectNoPageErrors(errors);
  });

  test('a deeper roster lets the foe ban a player pick, and the player still fields five and commits', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 811, hud: true });
    await clearCinematics(page);

    // Eight recruited: the player has surplus, so the leader's ban SHOULD fire
    // and remove one of the player's heroes (the other branch of the guard).
    const roster = ['juggernaut', 'sven', 'sniper', 'lich', 'lina', 'zeus', 'axe', 'luna'];
    await openEliteDraft(page, roster);

    await page.locator(POOL_CHIP(await firstLegalEnemyBan(page))).click();

    // After the player's ban resolves, the foe has auto-banned one of the
    // player's pool heroes (surplus roster => safe to deny a pick).
    const afterBans = await page.evaluate((pool) => {
      const g = (window as any).__game;
      const s = g.eliteDraft;
      return { bans: [...s.bans], foeBannedFromPlayerPool: s.bans.some((id: string) => pool.includes(id)) };
    }, roster);
    expect(afterBans.bans.length).toBeGreaterThanOrEqual(2); // player ban + foe ban
    expect(afterBans.foeBannedFromPlayerPool).toBe(true);

    // Pick the first five still-legal heroes from the player's pool via the UI.
    for (let i = 0; i < 5; i++) {
      const nextPick = await page.evaluate((pool) => {
        const g = (window as any).__game;
        const s = g.eliteDraft;
        const taken = new Set([...s.bans, ...s.player.map((h: any) => h.heroId), ...s.enemy.map((h: any) => h.heroId)]);
        return pool.find((id: string) => s.playerPool.includes(id) && !taken.has(id)) ?? null;
      }, roster);
      expect(nextPick, 'a legal pick remains for every player slot').not.toBeNull();
      await page.locator(POOL_CHIP(nextPick as string)).click();
    }

    await expect(page.locator(MODAL_CARD)).toContainText('Your five (5/5)');
    await attachElementScreenshot(page, testInfo, 'elite-03-deeper-roster-full-five', MODAL_CARD);

    const done = await page.evaluate(() => {
      const g = (window as any).__game;
      return { turnDone: g.eliteDraftTurn()?.done, playerCount: g.eliteDraft.player.length, enemyCount: g.eliteDraft.enemy.length };
    });
    expect(done.turnDone).toBe(true);
    expect(done.playerCount).toBe(5);
    expect(done.enemyCount).toBe(5);

    const commit = page.locator('[data-ed="commit"]');
    await expect(commit).toBeEnabled();
    await commit.click();
    expect(await page.evaluate(() => (window as any).__game.eliteDraft)).toBeNull();
    expectNoPageErrors(errors);
  });
});
