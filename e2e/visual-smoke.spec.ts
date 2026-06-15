import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
  attachElementScreenshot,
  attachScreenshot,
  boot,
  clearCinematics,
  expectNoPageErrors,
  waitForPlayableUi,
  watchPageErrors
} from './helpers';

const MODAL_CARD = '#modal-root:not(.hidden) .modal-card';

async function evaluateWhenReady<T>(page: Page, fn: () => T | Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForFunction(() => Boolean((window as any).__test?.ready?.()), null, { timeout: 60_000 });
    try {
      return await page.evaluate(fn);
    } catch (err) {
      if (!String(err).includes('Execution context was destroyed') || attempt === 2) throw err;
    }
  }
  throw new Error('unreachable evaluate retry state');
}

async function closeModal(page: Page): Promise<void> {
  await evaluateWhenReady(page, () => (document.querySelector('#modal-close') as HTMLElement | null)?.click());
  await page.waitForFunction(() => !document.querySelector('#modal-root:not(.hidden) .modal-card'), null, {
    timeout: 10_000
  });
}

async function captureModalState(
  page: Page,
  testInfo: TestInfo,
  name: string,
  expectedText: string,
  open: () => void
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await evaluateWhenReady(page, open);
    try {
      await expect(page.locator(MODAL_CARD)).toContainText(expectedText, { timeout: 60_000 });
      await attachElementScreenshot(page, testInfo, name, MODAL_CARD);
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForTimeout(250);
    }
  }
}

test.describe('visual smoke', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('captures major player-facing states @visual', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = watchPageErrors(page);

    // 'low' quality skips the env/vfx/holdout/party-model preload chain that
    // otherwise gates boot; this smoke test only asserts UI states, not fidelity.
    await boot(page, { webgl: true, hero: 'juggernaut', seed: 2026, quality: 'low' });
    await waitForPlayableUi(page);
    await page.locator('#cinematic-layer').waitFor({ state: 'visible', timeout: 60_000 });
    await attachScreenshot(page, testInfo, '01-cinematic-prologue');

    await clearCinematics(page);
    await page.evaluate(() => {
      const layer = document.getElementById('cinematic-layer');
      if (layer) {
        layer.classList.add('hidden');
        layer.innerHTML = '';
      }
    });
    await waitForPlayableUi(page);
    await expect(page.locator('#hero-panel')).toContainText('Juggernaut');
    await expect(page.locator('#hero-panel')).toContainText('Facet:');
    await expect(page.locator('#hero-panel')).toContainText(/HP \+\d/);
    await expect(page.locator('#hero-panel')).toContainText(/MP \+\d/);
    await attachScreenshot(page, testInfo, '02-overworld-hud');
    await page.waitForFunction(() => Boolean((window as any).__test?.ready?.()), null, { timeout: 30_000 });

    await evaluateWhenReady(page, () => {
      const g = (window as any).__test.game();
      const u = g.activeUnit() ?? g.party?.[0]?.unit;
      u.pos = { ...g.region.town.pos };
      u.prevPos = { ...g.region.town.pos };
      g.playerPos = { ...g.region.town.pos };
      (window as any).__test.step();
    });
    await captureModalState(page, testInfo, '03-town-shop', 'Shop', () => (window as any).__hud.toggleModal('shop'));
    await closeModal(page);

    await captureModalState(page, testInfo, '04-quest-journal', 'Quest Journal', () =>
      (document.querySelector('[data-open="journal"]') as HTMLElement | null)?.click()
    );
    await closeModal(page);

    await captureModalState(page, testInfo, '05-compendium', 'Compendium', () =>
      (document.querySelector('[data-open="codex"]') as HTMLElement | null)?.click()
    );
    await closeModal(page);

    expectNoPageErrors(errors);
  });
});
