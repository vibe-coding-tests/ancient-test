import { test, expect, type Page } from '@playwright/test';
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
const LIVE_GYM_BAR = '#live-gym-bar:not(.hidden)';
const COMBAT_READOUT = '#combat-readout:not(.hidden)';

async function prepareAutoBattlerRoster(page: Page, opts: { draft?: boolean } = {}): Promise<void> {
  await page.evaluate((options) => {
    const t = (window as any).__test;
    const g = (window as any).__game;
    t.fillParty({ heroIds: ['sven', 'sniper', 'lich', 'lina'], level: 14 });
    (g as any).recruitHero('zeus');
    t.skipCinematics();

    const aggro = [
      { if: [{ k: 'ability-ready', slot: 0 }], then: { k: 'cast', slot: 0, targetMode: 'focus' } },
      { if: [{ k: 'ability-ready', slot: 1 }], then: { k: 'cast', slot: 1, targetMode: 'focus' } },
      { if: [{ k: 'always' }], then: { k: 'attack-focus' } }
    ];
    const loadouts: Record<string, string[]> = {
      juggernaut: ['black-king-bar', 'blink-dagger'],
      sven: ['black-king-bar', 'crystalys'],
      sniper: ['black-king-bar', 'dragon-lance'],
      lich: ['black-king-bar', 'glimmer-cape'],
      lina: ['black-king-bar', 'kaya'],
      zeus: ['black-king-bar', 'arcane-boots']
    };

    for (const rec of g.party) {
      const ids = loadouts[rec.heroId] ?? ['black-king-bar'];
      rec.items = [0, 1, 2, 3, 4, 5].map((idx) => (ids[idx] ? { id: ids[idx] } : null));
      rec.gambits = aggro;
      if (rec.unit) {
        rec.unit.hp = rec.unit.stats.maxHp;
        rec.unit.mana = rec.unit.stats.maxMana;
      }
    }
    const zeus = g.benchRoster.get('zeus');
    if (zeus) {
      zeus.level = 14;
      zeus.items = [0, 1, 2, 3, 4, 5].map((idx) => (loadouts.zeus[idx] ? { id: loadouts.zeus[idx] } : null));
      zeus.gambits = aggro;
    }

    if (options.draft) {
      g.commitGymDraft('lunar-gym', {
        heroes: ['juggernaut', 'sven', 'sniper', 'lich', 'lina'].map((heroId) => ({
          heroId,
          level: 14,
          items: loadouts[heroId],
          gambits: aggro
        })),
        formation: {
          placements: {
            juggernaut: { col: 2, row: 2 },
            sven: { col: 2, row: 1 },
            sniper: { col: 0, row: 4 },
            lich: { col: 0, row: 0 },
            lina: { col: 1, row: 2 }
          }
        }
      });
    }
  }, opts);
}

async function openGymPrefight(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__hud.openGymPrefight('lunar-gym');
    (window as any).__test.step();
  });
  await expect(page.locator(MODAL_CARD)).toContainText('Lunar Gym');
}

async function installAudioProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as any).__game;
    const log: any[] = [];
    (window as any).__audioLog = log;
    g.audio.handleEvent = (ev: any, at?: any) => {
      log.push({ kind: 'event', t: ev.t, abilityId: ev.abilityId ?? null, itemId: ev.itemId ?? null, hasPos: Boolean(at) });
    };
    g.audio.playUi = (kind: string) => log.push({ kind: 'ui', ui: kind });
    g.audio.playStinger = (id: string) => log.push({ kind: 'stinger', id });
    g.audio.setListener = (pos: any) => log.push({ kind: 'listener', hasPos: Boolean(pos) });
    g.audio.update = (env: { inCombat: boolean }) => log.push({ kind: 'update', inCombat: env.inCombat });
  });
}

test.describe('auto battler e2e', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1440, height: 900 } });

  test('draft editor picks bench heroes, moves board slots, edits loadouts, and commits', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 601, hud: true });
    await clearCinematics(page);
    await prepareAutoBattlerRoster(page);
    await openGymPrefight(page);
    await attachElementScreenshot(page, testInfo, 'auto-battler-01-prefight-before-draft', MODAL_CARD);

    await page.locator('[data-pf="draft"]').click();
    await expect(page.locator(MODAL_CARD)).toContainText('Draft & Deploy');
    await expect(page.locator('[data-cell]')).toHaveCount(15);
    await expect(page.locator('[data-pool="zeus"]')).toBeVisible();
    await attachElementScreenshot(page, testInfo, 'auto-battler-02-draft-initial-board', MODAL_CARD);

    await page.locator('[data-remove="lina"]').click();
    await expect(page.locator('[data-draft="commit"]')).toBeDisabled();
    await page.locator('[data-pool="zeus"]').click();
    await expect(page.locator(MODAL_CARD)).toContainText('Holding Zeus');
    await page.locator('[data-cell="2:0"]').click();

    await page.locator('[data-pool="juggernaut"]').click();
    await expect(page.locator(MODAL_CARD)).toContainText('Holding Juggernaut');
    await page.locator('[data-cell="0:4"]').click();
    await page.locator('select[data-draft-item="juggernaut:0"]').selectOption('blink-dagger');
    await page.locator('[data-draft-gambit-preset="juggernaut:safe"]').click();
    await attachElementScreenshot(page, testInfo, 'auto-battler-03-draft-customized-board', MODAL_CARD);

    await expect(page.locator('[data-draft="commit"]')).toBeEnabled();
    await page.locator('[data-draft="commit"]').click();
    await expect(page.locator(MODAL_CARD)).toContainText('Drafted five');
    await attachScreenshot(page, testInfo, 'auto-battler-04-prefight-committed-draft');

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const draft = g.gymDraft('lunar-gym');
      const juggernaut = draft.heroes.find((h: any) => h.heroId === 'juggernaut');
      return {
        heroIds: draft.heroes.map((h: any) => h.heroId),
        walkingParty: g.party.map((r: any) => r.heroId),
        juggernautItems: juggernaut.items,
        juggernautRules: juggernaut.gambits?.length ?? 0,
        placements: draft.formation.placements
      };
    });

    expect(result.heroIds).toEqual(['juggernaut', 'sven', 'sniper', 'lich', 'zeus']);
    expect(result.walkingParty).toContain('lina');
    expect(result.walkingParty).not.toContain('zeus');
    expect(result.juggernautItems[0]).toBe('blink-dagger');
    expect(result.juggernautRules).toBeGreaterThan(0);
    expect(result.placements.juggernaut).toEqual({ col: 0, row: 4 });
    expect(result.placements.zeus).toEqual({ col: 2, row: 0 });
    expectNoPageErrors(errors);
  });

  test('live gym selection, Captain Call, spells, items, AI orders, and audio routing resolve', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 602, hud: true });
    await clearCinematics(page);
    await prepareAutoBattlerRoster(page, { draft: true });
    await installAudioProbe(page);
    await openGymPrefight(page);

    await page.locator('[data-pf="live"]').click();
    await page.evaluate(() => (window as any).__test.step());
    await expect(page.locator(LIVE_GYM_BAR)).toBeVisible();
    await attachElementScreenshot(page, testInfo, 'auto-battler-05-live-gym-bar-start', LIVE_GYM_BAR);

    const expectedSecond = await page.evaluate(() => {
      const g = (window as any).__game;
      return g.liveGym.playerHeroes()[1]?.heroId ?? null;
    });
    await page.keyboard.press('Digit2');
    await page.evaluate(() => (window as any).__test.step());
    const selected = await page.evaluate(() => {
      const g = (window as any).__game;
      const u = g.liveGym.sim.unit(g.scene.selectedUid);
      return { heroId: u?.heroId ?? null, name: u?.name ?? null };
    });
    expect(selected.heroId).toBe(expectedSecond);
    await expect(page.locator(LIVE_GYM_BAR)).toContainText(selected.name!);

    await expect(page.locator('[data-livegym="call"]')).toBeEnabled();
    await page.locator('[data-livegym="call"]').click();
    await page.evaluate(() => (window as any).__test.step());
    await expect(page.locator('[data-livegym="call"]')).toContainText('Call active');

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const t = (window as any).__test;
      const fight = g.liveGym;
      const sim = fight.sim;
      const controlled = g.controlledUnit();
      const captainActiveUidAtStart = fight.playerCaptain.activeUid;
      const enemies = sim.unitsArr.filter((u: any) => u.alive && u.team === 1);
      const target = enemies[0];
      const initialPlayerHomes = sim.unitsArr.filter((u: any) => u.team === 0).map((u: any) => ({
        heroId: u.heroId,
        x: u.pos.x,
        y: u.pos.y,
        homeX: u.ctrl?.homePos?.x ?? null,
        homeY: u.ctrl?.homePos?.y ?? null,
        order: u.order.kind
      }));

      for (const u of sim.unitsArr.filter((unit: any) => unit.team === 0)) {
        u.hp = u.stats.maxHp;
        u.mana = u.stats.maxMana;
      }

      let spellSlot = -1;
      let spellId: string | null = null;
      for (let slot = 0; slot < controlled.abilities.length; slot++) {
        const ability = controlled.abilities[slot];
        if (!ability || ability.level <= 0 || !controlled.abilityReady(slot, sim.time).ok) continue;
        const args = ability.def.targeting === 'unit-target'
          ? { uid: target.uid }
          : ability.def.targeting === 'no-target' || ability.def.targeting === 'toggle'
            ? {}
            : { point: { ...target.pos } };
        g.castAbility(slot, args);
        t.fastForward(1.6);
        if (controlled.abilities[slot].cooldownUntil > sim.time || controlled.mana < controlled.stats.maxMana) {
          spellSlot = slot;
          spellId = ability.def.id;
          break;
        }
      }

      controlled.mana = controlled.stats.maxMana;
      const itemBefore = controlled.items[0]?.cooldownUntil ?? 0;
      g.useItem(0, { point: { ...controlled.pos } });
      t.fastForward(0.8);
      const itemAfter = controlled.items[0]?.cooldownUntil ?? 0;
      t.fastForward(6);

      const audioLog = (window as any).__audioLog as any[];
      const playerHomes = sim.unitsArr.filter((u: any) => u.team === 0).map((u: any) => ({
        heroId: u.heroId,
        x: u.pos.x,
        y: u.pos.y,
        homeX: u.ctrl?.homePos?.x ?? null,
        homeY: u.ctrl?.homePos?.y ?? null,
        order: u.order.kind
      }));
      const enemyOrders = enemies.filter((u: any) => u.alive).map((u: any) => u.order.kind);
      const readout = g.combatReadout();

      return {
        controlledHeroId: controlled.heroId,
        captainActiveUidAtStart,
        selectedUid: g.scene.selectedUid,
        spellSlot,
        spellId,
        itemCooldownAdvanced: itemAfter > itemBefore,
        itemId: controlled.items[0]?.defId ?? null,
        initialPlayerHomes,
        playerHomes,
        uniqueHomes: new Set(initialPlayerHomes.map((u: any) => `${Math.round(u.homeX)}:${Math.round(u.homeY)}`)).size,
        homeSpreadX: Math.max(...initialPlayerHomes.map((u: any) => u.homeX)) - Math.min(...initialPlayerHomes.map((u: any) => u.homeX)),
        homeSpreadY: Math.max(...initialPlayerHomes.map((u: any) => u.homeY)) - Math.min(...initialPlayerHomes.map((u: any) => u.homeY)),
        enemyOrders,
        formation: readout.formation,
        audioUiKinds: audioLog.filter((e) => e.kind === 'ui').map((e) => e.ui),
        audioEventTypes: audioLog.filter((e) => e.kind === 'event').map((e) => e.t),
        audioCastIds: audioLog.filter((e) => e.kind === 'event' && e.t === 'cast').map((e) => e.abilityId),
        audioUpdates: audioLog.filter((e) => e.kind === 'update' && e.inCombat).length,
        positionalEvents: audioLog.filter((e) => e.kind === 'event' && e.hasPos).length
      };
    });

    expect(result.captainActiveUidAtStart).toBe(result.selectedUid);
    expect(result.controlledHeroId).toBe(selected.heroId);
    expect(result.spellSlot).toBeGreaterThanOrEqual(0);
    expect(result.spellId).toBeTruthy();
    expect(result.itemId).toBe('black-king-bar');
    expect(result.itemCooldownAdvanced).toBe(true);
    expect(result.initialPlayerHomes).toHaveLength(5);
    expect(result.uniqueHomes).toBe(5);
    expect(result.homeSpreadX).toBeGreaterThan(300);
    expect(result.homeSpreadY).toBeGreaterThan(900);
    expect(result.enemyOrders.some((kind: string) => kind !== 'stop' && kind !== 'hold')).toBe(true);
    expect(result.formation).not.toBeNull();
    expect(result.audioUiKinds.length).toBeGreaterThan(0);
    expect(result.audioEventTypes).toContain('item-used');
    expect(result.audioCastIds).toContain('item:black-king-bar');
    expect(result.audioCastIds.some((id: string | null) => Boolean(id && !id.startsWith('item:')))).toBe(true);
    expect(result.audioUpdates).toBeGreaterThan(0);
    expect(result.positionalEvents).toBeGreaterThan(0);
    await expect(page.locator(COMBAT_READOUT)).toBeVisible();
    await attachScreenshot(page, testInfo, 'auto-battler-06-live-combat-readout');
    expectNoPageErrors(errors);
  });

  test('real WebGL live gym frame captures without GL errors @visual', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = watchPageErrors(page);
    await boot(page, { webgl: true, hud: true, hero: 'juggernaut', seed: 603, quality: 'low' });
    await waitForPlayableUi(page);
    await clearCinematics(page);
    await prepareAutoBattlerRoster(page, { draft: true });
    await openGymPrefight(page);
    await attachElementScreenshot(page, testInfo, 'auto-battler-07-webgl-prefight', MODAL_CARD);

    await expect(page.locator('[data-pf="live"]')).toBeVisible();
    await page.evaluate(() => (document.querySelector('[data-pf="live"]') as HTMLButtonElement | null)?.click());
    await page.waitForFunction(() => !document.querySelector('#live-gym-bar.hidden'), null, { timeout: 30_000 });
    await page.evaluate(() => (window as any).__test.fastForward(0.4));
    await expect(page.locator(LIVE_GYM_BAR)).toBeVisible();
    const graphics = await page.evaluate(() => (window as any).__test.graphicsStats());
    expect(graphics).not.toBeNull();
    expect(graphics.drawCalls).toBeGreaterThan(0);
    expect(graphics.triangles).toBeGreaterThan(0);
    await attachElementScreenshot(page, testInfo, 'auto-battler-08-webgl-live-gym', '#game-canvas');
    expectNoPageErrors(errors);
  });
});
