import { test, expect } from '@playwright/test';
import { boot, clearCinematics, expectNoPageErrors, watchPageErrors } from './helpers';

test.describe('gambit AI overhaul — live browser loop', () => {
  test('team-mind assigns one save holder and prevents double-save item spam', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'lich', seed: 91 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const t = (window as any).__test;
      t.fillParty({ heroIds: ['crystal-maiden', 'sven', 'juggernaut', 'sniper'], level: 24 });
      for (const rec of g.party) {
        if (rec.heroId === 'lich' || rec.heroId === 'crystal-maiden') rec.items = [{ id: 'glimmer-cape' }, null, null, null, null, null];
      }

      const started = g.startLiveRaid('roshan-pit', 'normal', { maxSec: 20 });
      t.skipCinematics();
      if (!started) return { started: false } as const;

      const sim = g.liveRaid.sim;
      const boss = g.liveRaid.boss;
      const supports = sim.unitsArr.filter((u: any) => u.team === 0 && (u.heroId === 'lich' || u.heroId === 'crystal-maiden'));
      const ally = sim.unitsArr.find((u: any) => u.team === 0 && u.heroId === 'sven');
      for (const unit of sim.unitsArr.filter((u: any) => u.team === 0)) {
        unit.abilities = [];
        unit.mana = unit.stats.maxMana;
      }
      for (const support of supports) {
        support.pos = { x: 2000, y: 2000 + support.uid * 25 };
        support.prevPos = { ...support.pos };
      }
      ally.pos = { x: 2120, y: 2000 };
      ally.prevPos = { ...ally.pos };
      ally.hp = ally.stats.maxHp * 0.28;
      ally.lastEnemyDamageAt = sim.time;
      boss.pos = { x: 2300, y: 2000 };
      boss.prevPos = { ...boss.pos };
      sim.rebuildSpatial();

      const tm = sim.teamMind(0);
      for (let i = 0; i < 12; i++) t.step(33);
      const glimmerStates = supports.map((u: any) => ({
        uid: u.uid,
        heroId: u.heroId,
        cooldownUntil: u.items[0]?.cooldownUntil ?? 0
      }));
      return {
        started: true,
        saveHolderUid: tm.saveHolderUid,
        glimmerStates,
        glimmersUsed: glimmerStates.filter((it: any) => it.cooldownUntil > sim.time)
      };
    });

    expect(result.started).toBe(true);
    expect(result.saveHolderUid).not.toBeNull();
    expect(result.glimmersUsed).toHaveLength(1);
    expect(result.glimmersUsed[0].uid).toBe(result.saveHolderUid);
    expectNoPageErrors(errors);
  });

  test('cross-unit team chain roots before the nuker spends Dagon', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'lion', seed: 92 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const t = (window as any).__test;
      t.fillParty({ heroIds: ['zeus', 'sven', 'juggernaut', 'lich'], level: 24 });
      for (const rec of g.party) {
        if (rec.heroId === 'lion') rec.items = [{ id: 'rod-of-atos' }, null, null, null, null, null];
        else if (rec.heroId === 'zeus') rec.items = [{ id: 'dagon' }, null, null, null, null, null];
        else rec.items = [null, null, null, null, null, null];
      }

      const started = g.startLiveRaid('roshan-pit', 'normal', { maxSec: 20 });
      t.skipCinematics();
      if (!started) return { started: false } as const;

      const sim = g.liveRaid.sim;
      const boss = g.liveRaid.boss;
      const lion = sim.unitsArr.find((u: any) => u.team === 0 && u.heroId === 'lion');
      const zeus = sim.unitsArr.find((u: any) => u.team === 0 && u.heroId === 'zeus');
      for (const unit of sim.unitsArr.filter((u: any) => u.team === 0)) {
        if (unit !== lion && unit !== zeus) unit.items = [null, null, null, null, null, null];
        unit.abilities = [];
        unit.ctrl = { kind: 'none' };
        unit.mana = unit.stats.maxMana;
      }
      lion.pos = { x: 2000, y: 2000 };
      zeus.pos = { x: 2000, y: 2060 };
      boss.pos = { x: 2450, y: 2000 };
      for (const u of [lion, zeus, boss]) u.prevPos = { ...u.pos };
      sim.rebuildSpatial();

      const beforeSetup = sim.teamMind(0);

      boss.addStatus({ status: 'root', tag: 'e2e-root', sourceUid: lion.uid, sourceTeam: lion.team, until: sim.time + 2, isDebuff: true });
      boss.refresh(sim.time);
      sim.teamMinds?.delete?.(0);
      const afterSetup = sim.teamMind(0);

      return {
        started: true,
        lockdownUid: beforeSetup.lockdownUid,
        beforeChains: beforeSetup.chains.map((chain: any) => ({
          nextStep: chain.nextStep,
          steps: chain.steps
        })),
        afterChains: afterSetup.chains.map((chain: any) => ({
          nextStep: chain.nextStep,
          steps: chain.steps
        })),
        lionUid: lion.uid,
        zeusUid: zeus.uid,
        bossRooted: boss.summary.rooted
      };
    });

    expect(result.started).toBe(true);
    expect(result.lockdownUid).toBe(result.lionUid);
    expect(result.beforeChains[0].nextStep).toMatchObject({ unitUid: result.lionUid, role: 'enabler' });
    expect(result.afterChains[0].nextStep).toMatchObject({ unitUid: result.zeusUid, role: 'payoff' });
    expect(result.bossRooted).toBe(true);
    expectNoPageErrors(errors);
  });

  test('raid field awareness moves wounded allies toward friendly aura fields', async ({ page }) => {
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'lich', seed: 93 });
    await clearCinematics(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const t = (window as any).__test;
      t.fillParty({ heroIds: ['sven', 'juggernaut', 'sniper', 'crystal-maiden'], level: 24 });
      for (const rec of g.party) {
        if (rec.heroId === 'lich') rec.items = [{ id: 'vladmirs-offering' }, null, null, null, null, null];
        else rec.items = [null, null, null, null, null, null];
      }

      const started = g.startLiveRaid('roshan-pit', 'normal', { maxSec: 20 });
      t.skipCinematics();
      if (!started) return { started: false } as const;

      const sim = g.liveRaid.sim;
      const boss = g.liveRaid.boss;
      const lich = sim.unitsArr.find((u: any) => u.team === 0 && u.heroId === 'lich');
      const sven = sim.unitsArr.find((u: any) => u.team === 0 && u.heroId === 'sven');
      sven.abilities = [];
      lich.ctrl = { kind: 'none' };
      lich.pos = { x: 2000, y: 2000 };
      sven.pos = { x: 700, y: 2000 };
      boss.pos = { x: 3600, y: 2000 };
      for (const u of [lich, sven, boss]) u.prevPos = { ...u.pos };
      sven.hp = sven.stats.maxHp * 0.55;
      sim.rebuildSpatial();

      for (let i = 0; i < 12; i++) t.step(33);
      return {
        started: true,
        svenOrder: sven.order,
        lichPos: lich.pos,
        svenPos: sven.pos
      };
    });

    expect(result.started).toBe(true);
    expect(result.svenOrder.kind).toBe('move');
    expect(Math.hypot(result.svenOrder.point.x - result.lichPos.x, result.svenOrder.point.y - result.lichPos.y)).toBeLessThan(
      Math.hypot(result.svenPos.x - result.lichPos.x, result.svenPos.y - result.lichPos.y)
    );
    expectNoPageErrors(errors);
  });
});
