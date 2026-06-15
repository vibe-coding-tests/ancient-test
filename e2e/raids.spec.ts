import { test, expect, type Page } from '@playwright/test';
import {
  attachElementScreenshot,
  boot,
  clearCinematics,
  expectNoPageErrors,
  watchPageErrors
} from './helpers';

const COMBAT_READOUT = '#combat-readout:not(.hidden)';

// An aggressive gambit so AI allies actively cast + attack the boss (so the
// "AI behaving weirdly" report has a concrete, observable contract to assert).
const AGGRO = [
  { if: [{ k: 'ability-ready', slot: 0 }], then: { k: 'cast', slot: 0, targetMode: 'focus' } },
  { if: [{ k: 'ability-ready', slot: 2 }], then: { k: 'cast', slot: 2, targetMode: 'focus' } },
  { if: [{ k: 'always' }], then: { k: 'attack-focus' } }
];

// Every raid hero carries a BKB in slot 0 (a no-target active item) plus a
// signature second item, so spell + item resolution both have something to fire.
const RAID_LOADOUTS: Record<string, string[]> = {
  juggernaut: ['black-king-bar', 'battlefury'],
  lich: ['black-king-bar', 'glimmer-cape'],
  lina: ['black-king-bar', 'kaya'],
  sniper: ['black-king-bar', 'dragon-lance'],
  sven: ['black-king-bar', 'assault-cuirass']
};

/** Field a full level-30 party with castable kits, active items, and an aggro gambit. */
async function prepareRaidParty(page: Page): Promise<void> {
  await page.evaluate(({ aggro, loadouts }) => {
    const t = (window as any).__test;
    const g = (window as any).__game;
    t.fillParty({ heroIds: ['juggernaut', 'lich', 'lina', 'sniper', 'sven'], level: 30 });
    for (const rec of g.party) {
      const ids = loadouts[rec.heroId] ?? ['black-king-bar'];
      rec.items = [0, 1, 2, 3, 4, 5].map((idx: number) => (ids[idx] ? { id: ids[idx] } : null));
      rec.gambits = aggro;
      if (rec.unit) {
        rec.unit.hp = rec.unit.stats.maxHp;
        rec.unit.mana = rec.unit.stats.maxMana;
      }
    }
  }, { aggro: AGGRO, loadouts: RAID_LOADOUTS });
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

/** Start a live raid and skip its intro cinematics so the sim can be stepped. */
async function startLiveRaid(page: Page, raidId = 'roshan-pit', tier = 'normal'): Promise<boolean> {
  return page.evaluate(({ raidId, tier }) => {
    const g = (window as any).__game;
    const ok = g.startLiveRaid(raidId, tier);
    let guard = 0;
    while (g.cinematic.active && guard++ < 200) g.cinematicSkip();
    g.cinematic.clear();
    const layer = document.getElementById('cinematic-layer');
    if (layer) { layer.classList.add('hidden'); layer.innerHTML = ''; }
    return ok;
  }, { raidId, tier });
}

test.describe('live raids', () => {
  test('a full party drives a live raid: swap drivers, order, and clear', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 53 });
    await clearCinematics(page);
    expect(await page.evaluate(() => (window as any).__test.fillParty({ level: 30 }))).toBe(5);

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const started = g.startLiveRaid('roshan-pit', 'normal');
      t.skipCinematics();
      if (!started) return { started: false } as const;

      // lazy claim: the driver runs on gambit AI until the first order
      const firstDriver = g.controlledUnit();
      const lazyGambit = firstDriver?.ctrl.kind === 'gambit';

      // swap to the second party slot
      const swapped = g.trySwap(1);
      const driver = g.controlledUnit();
      const driverUid = driver?.uid;

      // issue a move: claims player control and routes the order into the raid sim
      g.orderMove({ x: driver.pos.x + 160, y: driver.pos.y + 20 });
      const claimed = g.liveRaid.sim.unit(driverUid);
      const orderRouted = claimed?.ctrl.kind === 'player' && claimed?.order.kind === 'move';

      // fell the boss (deterministic clear) and let the loop adjudicate the result
      t.clearHostiles();
      let guard = 0;
      while (g.liveRaid && guard++ < 60) t.fastForward(0.1);

      return {
        started: true,
        lazyGambit,
        swapped,
        orderRouted,
        ended: !g.liveRaid,
        codexUnlocked: g.codexUnlocks.has('raid:roshan-pit'),
        clears: g.raidProgress['roshan-pit']?.clears ?? 0
      } as const;
    });

    expect(result.started).toBe(true);
    expect(result.lazyGambit).toBe(true);
    expect(result.swapped).toBe(true);
    expect(result.orderRouted).toBe(true);
    expect(result.ended).toBe(true);
    expect(result.codexUnlocked).toBe(true);
    expect(result.clears).toBeGreaterThanOrEqual(1);
    expectNoPageErrors(errors);
  });

  test('number keys swap drivers and town actions stay blocked mid-raid', async ({ page }) => {
    const errors = watchPageErrors(page);
    // ?hud=1 mounts the real InputController + HUD over the headless scene, so
    // keyboard routing (swap-2, shop, capture) goes through input.ts for real.
    await boot(page, { hero: 'juggernaut', seed: 54, hud: true });
    await clearCinematics(page);
    await page.evaluate(() => (window as any).__test.fillParty({ level: 30 }));

    const setup = await page.evaluate(() => {
      const g = (window as any).__game;
      const started = g.startLiveRaid('roshan-pit', 'normal');
      (window as any).__test.skipCinematics();
      return { started, slot0: g.controlledUnit()?.uid, slot1Uid: g.liveRaid?.partyUids?.[1] };
    });
    expect(setup.started).toBe(true);

    // '2' => swap-2 => drive party slot 2 (input.ts -> trySwap -> selectLiveRaidHero)
    await page.keyboard.press('2');
    const afterSwap = await page.evaluate(() => (window as any).__game.controlledUnit()?.uid);
    expect(afterSwap).toBe(setup.slot1Uid);

    // town actions are guarded inside a live raid: these keys must not open
    // panels, leave the raid, or throw (input.ts `if (g.liveRaid) return`).
    await page.keyboard.press('b'); // shop
    await page.keyboard.press('t'); // capture
    await page.keyboard.press('g'); // interact / travel
    const stillLive = await page.evaluate(() => {
      const shop = document.querySelector('#shop, .shop-panel');
      return {
        raidActive: Boolean((window as any).__game.liveRaid),
        shopOpen: Boolean(shop && getComputedStyle(shop as Element).display !== 'none')
      };
    });
    expect(stillLive.raidActive).toBe(true);
    expect(stillLive.shopOpen).toBe(false);

    expectNoPageErrors(errors);
  });

  test('driver selection, spell + item resolution, AI orders, boss threat, and audio routing', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 71, hud: true });
    await clearCinematics(page);
    await prepareRaidParty(page);
    await installAudioProbe(page);
    expect(await startLiveRaid(page)).toBe(true);

    // The live raid surfaces through the combat readout (boss threat + raid cues),
    // not the gym bar. Step once so the HUD renders it.
    await page.evaluate(() => (window as any).__test.step());
    await expect(page.locator(COMBAT_READOUT)).toBeVisible();

    // 1–5 selects a driver: press '2' and confirm the controlled unit follows.
    const expectedSecond = await page.evaluate(() => (window as any).__game.liveRaid.partyUids[1]);
    await page.keyboard.press('2');
    await page.evaluate(() => (window as any).__test.step());
    const selectedUid = await page.evaluate(() => (window as any).__game.controlledUnit()?.uid);
    expect(selectedUid).toBe(expectedSecond);
    // back to slot 1 so the spell/item probe drives a known hero
    await page.keyboard.press('1');
    await page.evaluate(() => (window as any).__test.step());

    const result = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const raid = g.liveRaid;
      const sim = raid.sim;
      const boss = raid.boss;

      // a small time-advance that never lets a boss-phase cut-scene stall the sim
      const ff = (sec: number) => {
        const steps = Math.max(1, Math.round(sec / 0.1));
        for (let i = 0; i < steps; i++) {
          let guard = 0;
          while (g.cinematic.active && guard++ < 200) g.cinematicSkip();
          g.cinematic.clear();
          t.fastForward(0.1);
        }
      };

      const driver = g.controlledUnit();
      driver.mana = driver.stats.maxMana;

      // --- spell resolution: cast the first ready ability at the boss ---
      let spellSlot = -1;
      let spellId: string | null = null;
      for (let slot = 0; slot < driver.abilities.length; slot++) {
        const ability = driver.abilities[slot];
        if (!ability || ability.level <= 0 || !driver.abilityReady(slot, sim.time).ok) continue;
        const args = ability.def.targeting === 'unit-target'
          ? { uid: boss.uid }
          : ability.def.targeting === 'no-target' || ability.def.targeting === 'toggle'
            ? {}
            : { point: { ...boss.pos } };
        g.castAbility(slot, args);
        ff(1.6);
        if (driver.abilities[slot].cooldownUntil > sim.time || driver.mana < driver.stats.maxMana) {
          spellSlot = slot;
          spellId = ability.def.id;
          break;
        }
      }

      // --- item resolution: pop the BKB in slot 0 ---
      driver.mana = driver.stats.maxMana;
      const itemBefore = driver.items[0]?.cooldownUntil ?? 0;
      g.useItem(0, { point: { ...driver.pos } });
      ff(0.8);
      const itemAfter = driver.items[0]?.cooldownUntil ?? 0;

      // --- let the fight breathe so AI + boss threat resolve ---
      ff(7);

      const partyOrders = sim.unitsArr
        .filter((u: any) => u.alive && u.team === 0 && u.kind === 'hero' && u.uid !== driver.uid)
        .map((u: any) => u.order.kind);
      const bossFocusIsParty = raid.partyUids.includes(boss.ctrl.focusUid);
      const readout = g.combatReadout();
      const audioLog = (window as any).__audioLog as any[];
      const castIds = audioLog.filter((e) => e.kind === 'event' && e.t === 'cast').map((e) => e.abilityId);

      return {
        driverHeroId: driver.heroId,
        spellSlot,
        spellId,
        itemId: driver.items[0]?.defId ?? null,
        itemCooldownAdvanced: itemAfter > itemBefore,
        partyOrders,
        aiActing: partyOrders.some((k: string) => k === 'cast' || k === 'attack-unit' || k === 'move'),
        bossFocusIsParty,
        bossTargetName: readout.bossThreat?.targetName ?? null,
        raidReadoutPresent: Boolean(readout.raid),
        enrageSecondsRemaining: readout.raid?.enrage?.secondsRemaining ?? -1,
        audioCastIds: castIds,
        audioCastItem: castIds.includes('item:black-king-bar'),
        audioCastSpell: castIds.some((id: string | null) => Boolean(id && !id.startsWith('item:'))),
        positionalEvents: audioLog.filter((e) => e.kind === 'event' && e.hasPos).length,
        combatAudioUpdates: audioLog.filter((e) => e.kind === 'update' && e.inCombat).length
      };
    });

    // spells resolve
    expect(result.spellSlot, 'a ready ability should resolve into a cast').toBeGreaterThanOrEqual(0);
    expect(result.spellId).toBeTruthy();
    // items resolve
    expect(result.itemId).toBe('black-king-bar');
    expect(result.itemCooldownAdvanced, 'using the item should put it on cooldown').toBe(true);
    // the AI is acting, not idling
    expect(result.aiActing, `AI allies should issue real orders, got ${JSON.stringify(result.partyOrders)}`).toBe(true);
    // the boss threat table fixes onto a party hero (and the readout names it)
    expect(result.bossFocusIsParty || Boolean(result.bossTargetName)).toBe(true);
    // raid execution readout is live with an enrage clock counting down
    expect(result.raidReadoutPresent).toBe(true);
    expect(result.enrageSecondsRemaining).toBeGreaterThan(0);
    // audio routes both the hero spell and the item, positionally, in combat
    expect(result.audioCastItem).toBe(true);
    expect(result.audioCastSpell).toBe(true);
    expect(result.positionalEvents).toBeGreaterThan(0);
    expect(result.combatAudioUpdates).toBeGreaterThan(0);

    await attachElementScreenshot(page, testInfo, 'raid-01-combat-readout', COMBAT_READOUT);
    expectNoPageErrors(errors);
  });

  test('scripted mechanics fire: telegraphed zone, add wave, and enrage clock', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', seed: 72, hud: true });
    await clearCinematics(page);
    await prepareRaidParty(page);
    expect(await startLiveRaid(page)).toBe(true);

    const probe = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const raid = g.liveRaid;
      const sim = raid.sim;
      const boss = raid.boss;
      const maxHp = boss.stats.maxHp;
      const partyUids: number[] = raid.partyUids;

      // Park the boss next to the party so it engages immediately (deterministic threat).
      const cx = partyUids.reduce((s, uid) => s + (sim.unit(uid)?.pos.x ?? 0), 0) / partyUids.length;
      const cy = partyUids.reduce((s, uid) => s + (sim.unit(uid)?.pos.y ?? 0), 0) / partyUids.length;
      boss.pos = { x: cx + 180, y: cy };
      sim.rebuildSpatial?.();

      const keepAlive = () => {
        for (const uid of partyUids) {
          const u = sim.unit(uid);
          if (u && u.alive) { u.hp = u.stats.maxHp; u.mana = u.stats.maxMana; }
        }
        boss.hp = maxHp; // keep the boss up so armed mechanics resolve and we can watch
      };

      // Dip the boss below every HP-gated threshold once (zone @70, signature @50,
      // add wave @55) to arm them, then keep it alive while they fire.
      boss.hp = maxHp * 0.4;
      let guard = 0;
      while (g.cinematic.active && guard++ < 200) g.cinematicSkip();
      g.cinematic.clear();
      t.fastForward(0.1);

      let sawZone = false;
      let maxAdds = 0;
      let sawThreat = false;
      let enrage: any = null;
      for (let i = 0; i < 50; i++) {
        let cg = 0;
        while (g.cinematic.active && cg++ < 200) g.cinematicSkip();
        g.cinematic.clear();
        keepAlive();
        t.fastForward(0.1);
        const r = g.combatReadout();
        if (r.raid?.dodgeTelegraph) sawZone = true;
        const adds = r.raid?.nextAddWave?.activeAdds ?? 0;
        if (adds > maxAdds) maxAdds = adds;
        if (r.bossThreat?.targetName || partyUids.includes(boss.ctrl.focusUid)) sawThreat = true;
        if (r.raid?.enrage) enrage = r.raid.enrage;
      }

      const hostileZonesNow = sim.zones.filter((z: any) => z.team !== 0).length;
      const addsNow = sim.unitsArr.filter(
        (u: any) => u.alive && u.team === 1 && u.kind !== 'hero' && u.ownerUid === boss.uid
      ).length;

      return { sawZone, hostileZonesNow, maxAdds, addsNow, sawThreat, enrage };
    });

    // a telegraphed hostile zone went down on the party (dodge check)
    expect(probe.sawZone || probe.hostileZonesNow > 0).toBe(true);
    // an add wave entered the sim
    expect(probe.maxAdds).toBeGreaterThan(0);
    // the boss threat table is tracking a party hero (AI acting correctly)
    expect(probe.sawThreat).toBe(true);
    // the enrage clock is live and has not yet expired in the first seconds
    expect(probe.enrage).not.toBeNull();
    expect(probe.enrage.secondsRemaining).toBeGreaterThan(0);
    expect(probe.enrage.active).toBe(false);
    expectNoPageErrors(errors);
  });

  test('real WebGL raid loads GLB models, renders the boss + party, and captures frames @visual', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = watchPageErrors(page);
    // 'low' quality keeps the software-WebGL boot stable while still streaming the
    // per-unit authored GLB rigs for the near-camera boss + party (createView in
    // scene.ts is not quality-gated), so this verifies the asset pipeline for real.
    await boot(page, { webgl: true, hud: true, hero: 'juggernaut', seed: 73, quality: 'low' });
    await page.waitForFunction(() => Boolean((window as any).__test?.ready?.()), null, { timeout: 90_000 });
    await prepareRaidParty(page);
    expect(await startLiveRaid(page)).toBe(true);

    // Stream models in for several frames inside one evaluate (fewer round-trips =
    // far more stable under the software renderer).
    await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      for (let i = 0; i < 40; i++) {
        let guard = 0;
        while (g.cinematic.active && guard++ < 200) g.cinematicSkip();
        g.cinematic.clear();
        t.fastForward(0.1);
      }
    });
    await page.waitForTimeout(800);

    const probe = await page.evaluate(() => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const sim = g.liveRaid?.sim;
      const perf = t.perfStats();
      return {
        units: sim ? sim.unitsArr.filter((u: any) => u.alive).length : -1,
        bossAlive: Boolean(g.liveRaid?.boss?.alive),
        graphics: perf.graphics,
        model: perf.assets.model,
        modelCacheSize: perf.assets.modelCacheSize
      };
    });

    await attachElementScreenshot(page, testInfo, 'raid-02-webgl-live-raid', '#game-canvas');

    // the scene is rendering real geometry
    expect(probe.graphics).not.toBeNull();
    expect(probe.graphics.drawCalls).toBeGreaterThan(0);
    expect(probe.graphics.triangles).toBeGreaterThan(0);
    // GLB models were requested and resolved without a single failed load
    expect(probe.model.requests).toBeGreaterThan(0);
    expect(probe.model.failures).toBe(0);
    expect(probe.modelCacheSize).toBeGreaterThan(0);
    // the boss and party are present in the live raid sim
    expect(probe.bossAlive).toBe(true);
    expect(probe.units).toBeGreaterThanOrEqual(5);
    expectNoPageErrors(errors);
  });
});
