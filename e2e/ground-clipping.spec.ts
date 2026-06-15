import { test, expect } from '@playwright/test';
import { boot, clearCinematics, expectNoPageErrors, watchPageErrors } from './helpers';

const WORLD_SCALE = 100;

test.describe('ground clipping red-team', () => {
  test('rendered hero stays on top of terrain through teleports, dashes, and dungeon floors', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchPageErrors(page);
    await boot(page, { hero: 'juggernaut', region: 'icewrack', seed: 14001, webgl: true, quality: 'low' });
    await clearCinematics(page);

    const result = await page.evaluate((worldScale) => {
      const t = (window as any).__test;
      const g = (window as any).__game;
      const samples: { label: string; ok: boolean; y: number; ground: number; delta: number; finite: boolean }[] = [];
      const currentUnit = () => g.liveDungeon?.drivenUnit?.() ?? g.liveRaid?.claimDriver?.() ?? g.activeUnit();
      const sample = (label: string) => {
        for (let i = 0; i < 2; i++) t.step(33);
        const u = currentUnit();
        const view = g.scene.views?.get(u.uid);
        if (!view) {
          samples.push({ label, ok: false, y: Number.NaN, ground: Number.NaN, delta: Number.NaN, finite: false });
          return;
        }
        const root = view.rig.root.position;
        const simX = root.x * worldScale;
        const simY = root.z * worldScale;
        const ground = g.scene.groundHeightAt(simX, simY);
        const expected = ground + ((u.renderHeight ?? 0) / worldScale);
        const delta = root.y - expected;
        const finite = Number.isFinite(root.x) && Number.isFinite(root.y) && Number.isFinite(root.z) && Number.isFinite(ground);
        samples.push({ label, ok: finite && delta >= -0.03 && Math.abs(delta) < 0.45, y: root.y, ground: expected, delta, finite });
      };

      sample('initial icewrack');

      const hero = g.activeUnit();
      const weirdClicks = [
        { x: g.sim.bounds.w + 20_000, y: -20_000 },
        { x: g.region.town.pos.x + 1200, y: g.region.town.pos.y + 700 },
        { x: 72, y: g.sim.bounds.h - 72 }
      ];
      for (const point of weirdClicks) {
        g.orderMove(point);
        for (let i = 0; i < 10; i++) t.step(33);
        sample(`walk ${Math.round(point.x)},${Math.round(point.y)}`);
      }

      // Player abuse: snap the sim unit across a large terrain-height delta.
      t.teleportActive(g.sim.bounds.w - 140, 140);
      sample('teleport snap to opposite rim');

      // Player abuse: dash into a temporary blocker near the rim.
      g.sim.obstacles.push({
        id: 'e2e-dash-rock',
        pos: { x: hero.pos.x + 150, y: hero.pos.y },
        radius: 120,
        body: { layer: 'static', blocksMovement: true, shape: { kind: 'circle', radius: 120 } }
      });
      g.tryDash({ x: hero.pos.x + 900, y: hero.pos.y });
      for (let i = 0; i < 10; i++) t.step(33);
      sample('dash into rim rock');

      const portal = g.region.dungeons[0];
      const entered = g.startDungeon(portal.dungeonId, 'normal');
      t.skipCinematics();
      for (let i = 0; i < 8; i++) t.step(33);
      sample('dungeon entry floor');
      const dungeon = g.liveDungeon;
      if (dungeon) {
        const driver = dungeon.drivenUnit();
        g.orderMove({ x: dungeon.sim.bounds.w - 180, y: dungeon.sim.bounds.h - 180 });
        for (let i = 0; i < 12; i++) t.step(33);
        sample('dungeon diagonal walk');
        return {
          entered,
          samples,
          dungeonBounds: dungeon.sim.bounds,
          driverFinite: Number.isFinite(driver.pos.x) && Number.isFinite(driver.pos.y)
        };
      }

      return { entered, samples, dungeonBounds: null, driverFinite: false };
    }, WORLD_SCALE);

    expect(result.entered).toBe(true);
    expect(result.driverFinite).toBe(true);
    expect(result.samples.every((s) => s.ok), JSON.stringify(result.samples, null, 2)).toBe(true);
    expectNoPageErrors(errors);
  });
});
