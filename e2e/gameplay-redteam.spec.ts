import { test, expect, type Page } from '@playwright/test';
import { boot, clearCinematics, expectNoPageErrors, fastForward, waitForPlayableUi, watchPageErrors } from './helpers';

const MODAL_CARD = '#modal-root:not(.hidden) .modal-card';

async function focusGame(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__test?.state && (window as any).__game), null, { timeout: 30_000 });
  await waitForPlayableUi(page);
  await page.evaluate(() => window.focus());
}

test.describe('gameplay red-team journeys', () => {
  test('real kills update the quest log, Journal claim pays, and skill spend still works', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 13001, hud: true });
    await clearCinematics(page);
    await focusGame(page);

    const staged = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      t.addXp(40_000);
      g.sim.events.captureAll = true;
      for (let i = 0; i < 4; i++) {
        t.spawnWildCreepNearActive({ count: 3, creepId: 'kobold' });
        t.clearHostiles();
        t.fastForward(0.25);
      }
      const cull = g.questBoard().find((q: any) => q.id === 'bounty-cull-wilds');
      const rec = g.party[g.activeIdx];
      return {
        cullStatus: cull?.status ?? null,
        claimable: cull?.claimable ?? false,
        pending: g.pendingAbilityPoints(rec),
        ranks: rec.unit.abilities.map((a: any) => a.level),
        gold: g.gold
      };
    });

    expect(staged.cullStatus).toBe('complete');
    expect(staged.claimable).toBe(true);
    expect(staged.pending).toBeGreaterThan(0);

    await page.keyboard.press('j');
    await expect(page.locator(MODAL_CARD)).toContainText('Bounties');
    const claimBtn = page.locator('[data-claim-quest="bounty-cull-wilds"]');
    await expect(claimBtn).toBeVisible();
    await claimBtn.click({ force: true });
    await fastForward(page, 0.1);

    const afterClaim = await page.evaluate(() => {
      const g = (window as any).__game;
      const cull = g.questBoard().find((q: any) => q.id === 'bounty-cull-wilds');
      return { gold: g.gold, status: cull?.status ?? null, progress: cull?.objectives?.[0]?.have ?? -1 };
    });
    expect(afterClaim.gold).toBeGreaterThan(staged.gold);
    expect(afterClaim.status).toBe('active');
    expect(afterClaim.progress).toBe(0);

    await page.evaluate(() => (document.querySelector('#modal-close') as HTMLElement | null)?.click());
    await expect(page.locator('#modal-root')).toHaveClass(/hidden/);
    const slot = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#hero-panel .ab-plus[data-skill]')] as HTMLButtonElement[];
      const live = btns.find((b) => !b.disabled);
      return live ? Number(live.dataset.skill) : -1;
    });
    expect(slot).toBeGreaterThanOrEqual(0);
    await page.locator(`#hero-panel .ab-plus[data-skill="${slot}"]`).evaluate((el) => (el as HTMLElement).click());
    await fastForward(page, 0.1);

    const afterSkill = await page.evaluate((skillSlot) => {
      const g = (window as any).__game;
      const rec = g.party[g.activeIdx];
      return { pending: g.pendingAbilityPoints(rec), rank: rec.unit.abilities[skillSlot].level };
    }, slot);
    expect(afterSkill.pending).toBe(staged.pending - 1);
    expect(afterSkill.rank).toBe(staged.ranks[slot] + 1);
    expectNoPageErrors(errors);
  });

  test('mashing item drop/pickup/use and swap keys preserves party and inventory state', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 13002, hud: true });
    await clearCinematics(page);
    await focusGame(page);
    await page.evaluate(() => (window as any).__test.fillParty({ level: 12 }));
    await clearCinematics(page);

    const setup = await page.evaluate(() => {
      const g = (window as any).__game;
      const hero = g.activeUnit();
      const make = (id: string) => ({ defId: id, charges: -1, cooldownUntil: 0 });
      g.sim.events.captureAll = true;
      const open = { x: g.region.town.pos.x, y: g.region.town.pos.y + 900 };
      hero.pos = { ...open };
      hero.prevPos = { ...open };
      hero.items[0] = make('blink-dagger');
      hero.items[1] = make('broadsword');
      hero.items[2] = make('boots-of-speed');
      hero.markStatsDirty();
      hero.refresh(g.sim.time);
      g.party[g.activeIdx].items = hero.items.map((it: any) => it ? { id: it.defId } : null);
      const dropPos = { x: hero.pos.x + 40, y: hero.pos.y + 20 };
      const dropped = g.dropHeroItemToGround(1, dropPos);
      const drop = g.groundItemDrops.find((d: any) => d.item.id === 'broadsword');
      const immediatePickup = g.tryPickupGroundItem(drop.uid);
      return {
        dropped,
        immediatePickup,
        dropUid: drop.uid,
        startActive: g.activeIdx,
        orderKind: hero.order.kind
      };
    });

    expect(setup.dropped).toBe(true);
    expect(setup.immediatePickup).toBe(true);

    const pickup = await page.evaluate((dropUid) => {
      const g = (window as any).__game;
      const hero = g.activeUnit();
      g.paused = false;
      g.cinematic.clear();
      const beforeInvalid = g.sim.events.history.filter((e: any) => e.t === 'item-used').length;
      g.useItem(5, { point: { x: hero.pos.x + 100, y: hero.pos.y } });
      g.sim.tick();
      const afterInvalid = g.sim.events.history.filter((e: any) => e.t === 'item-used').length;
      const blinkSlot = hero.items.findIndex((it: any) => it?.defId === 'blink-dagger');
      hero.lastEnemyDamageAt = -999;
      g.useItem(blinkSlot, { point: { x: hero.pos.x + 500, y: hero.pos.y + 20 } });
      for (let i = 0; i < 120; i++) {
        g.sim.tick();
        if (g.sim.events.history.some((e: any) => e.t === 'item-used' && e.itemId === 'blink-dagger')) break;
      }
      return {
        pickedUp: !g.groundItemDrops.some((d: any) => d.uid === dropUid),
        hasBroadsword: hero.items.some((it: any) => it?.defId === 'broadsword'),
        invalidNooped: afterInvalid === beforeInvalid,
        blinkUsed: g.sim.events.history.some((e: any) => e.t === 'item-used' && e.itemId === 'blink-dagger')
      };
    }, setup.dropUid);

    expect(pickup.pickedUp).toBe(true);
    expect(pickup.hasBroadsword).toBe(true);
    expect(pickup.invalidNooped).toBe(true);
    expect(pickup.blinkUsed).toBe(true);

    await page.keyboard.press('2');
    await fastForward(page, 0.1);
    const afterSwap = await page.evaluate(() => {
      const g = (window as any).__game;
      return {
        activeIdx: g.activeIdx,
        alive: g.party.every((rec: any) => !rec.unit || rec.unit.alive),
        itemCounts: g.party.map((rec: any) => rec.unit ? rec.unit.items.filter(Boolean).length : rec.items.filter(Boolean).length)
      };
    });
    expect(afterSwap.activeIdx).toBe(1);
    expect(afterSwap.alive).toBe(true);
    expect(afterSwap.itemCounts[0]).toBeGreaterThanOrEqual(2);
    expectNoPageErrors(errors);
  });

  test('walk-up recruitment can be canceled, retried, then a dungeon portal still works', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 13003 });
    await clearCinematics(page);

    const recruit = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const npc = g.sim.unitsArr.find((u: any) => u.kind === 'npc' && g.npcAt(u.uid) === 'sven');
      const questId = g.npcAt(npc.uid) && g.REG?.hero ? '' : 'recruit-sven';
      void questId;
      const heroQuestId = 'recruit-sven';
      const quest = g.questProgress[heroQuestId] ?? { stage: 'found', attunement: 3, trialCompletions: 0 };
      quest.stage = 'found';
      quest.attunement = 3;
      g.questProgress[heroQuestId] = quest;

      t.teleportActive(npc.pos.x + 430, npc.pos.y);
      g.tryRecruit(npc.uid);
      const pendingBeforeCancel = g.pendingRecruitNpcUid === npc.uid;
      g.orderMove({ x: npc.pos.x + 900, y: npc.pos.y + 100 });
      t.fastForward(0.2);
      const canceled = g.pendingRecruitNpcUid === null && !g.activeTrial;

      g.tryRecruit(npc.uid);
      for (let i = 0; i < 600 && !g.activeTrial; i++) t.step(33);
      return {
        pendingBeforeCancel,
        canceled,
        trialStarted: Boolean(g.activeTrial),
        questStage: g.questProgress[heroQuestId]?.stage ?? null
      };
    });

    expect(recruit.pendingBeforeCancel).toBe(true);
    expect(recruit.canceled).toBe(true);
    expect(recruit.trialStarted).toBe(true);
    expect(recruit.questStage).toBe('found');

    await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      g.activeTrial = null;
      const save = g.buildSave();
      save.regionId = 'icewrack';
      save.worldSeed = 44190;
      save.playerPos = { x: 5000, y: 8340 };
      save.recruited = [...new Set([...save.recruited, 'pudge', 'earthshaker', 'sven', 'axe'])];
      t.load(save);
    });
    await page.waitForFunction(() => (window as any).__test.state().regionId === 'icewrack', null, { timeout: 30_000 });

    const dungeon = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const portal = g.region.dungeons[0];
      g.orderMove(portal.pos);
      for (let i = 0; i < 900; i++) {
        t.step(33);
        const p = g.controlledUnit().pos;
        if (Math.hypot(p.x - portal.pos.x, p.y - portal.pos.y) <= portal.radius * 0.7) break;
      }
      const entered = g.tryInteract();
      t.skipCinematics();
      return {
        entered,
        dungeonId: g.liveDungeonId,
        roomIndex: g.liveDungeon?.room.index ?? -1,
        bounds: g.liveDungeon?.sim.bounds ?? null
      };
    });

    expect(dungeon.entered).toBe(true);
    expect(dungeon.dungeonId).toBe('frost-hollow');
    expect(dungeon.roomIndex).toBeGreaterThanOrEqual(0);
    expect(dungeon.bounds?.w).toBeGreaterThan(0);
    expectNoPageErrors(errors);
  });
});
