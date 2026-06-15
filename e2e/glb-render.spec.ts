import { test, expect, type Page } from '@playwright/test';
import { boot, waitForPlayableUi, skipActiveCinematic, attachScreenshot, watchPageErrors, expectNoPageErrors } from './helpers';

// Regression guard for the authored-asset enhancement layer (GRAPHICS_SPEC §13,
// ASSETS.md). The procedural rig is the boot floor and looks intentional with no
// assets present (§9.5), so a broken asset path / failed build / 404 does NOT
// crash the game or drop draw calls — it silently falls back to procedural. The
// other WebGL specs boot `quality:'low'` and only assert drawCalls/triangles > 0,
// which the procedural floor satisfies, so none of them would catch that.
//
// This spec boots the real renderer at a model-preloading tier and asserts the
// authored GLBs actually mount on the live rigs WITH their textures, and that
// nothing 404'd. If hero/creature GLBs stop loading, this fails instead of
// quietly shipping the procedural placeholders.

interface GlbReport {
  units: number;
  authored: number;
  authoredMeshes: number;
  texturedMeshes: number;
  texturedUnits: number;
  sampleTextureDims: string[];
  assets: {
    gpuTextureBytes: number;
    modelCacheSize: number;
    model: { requests: number; failures: number };
    texture: { requests: number; failures: number };
  } | null;
}

/** Walk the live scene's unit views for mounted authored GLBs + bound textures. */
async function glbReport(page: Page): Promise<GlbReport> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const views = g?.scene?.views as Map<number, any> | undefined;
    const test = (window as any).__test;
    const assets = test?.perfStats?.()?.assets ?? null;
    const out: GlbReport = {
      units: 0, authored: 0, authoredMeshes: 0, texturedMeshes: 0, texturedUnits: 0,
      sampleTextureDims: [],
      assets: assets && {
        gpuTextureBytes: assets.gpuTextureBytes,
        modelCacheSize: assets.modelCacheSize,
        model: { requests: assets.model.requests, failures: assets.model.failures },
        texture: { requests: assets.texture.requests, failures: assets.texture.failures }
      }
    };
    if (!views) return out;
    for (const [, view] of views) {
      out.units++;
      const model = view?.rig?.authoredModel;
      if (!model) continue;
      out.authored++;
      let textured = false;
      model.traverse((o: any) => {
        if (!o.isMesh || !o.material) return;
        out.authoredMeshes++;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m && m.map && m.map.image) {
            out.texturedMeshes++;
            textured = true;
            const img = m.map.image;
            const dim = `${img.width ?? img.naturalWidth ?? 0}x${img.height ?? img.naturalHeight ?? 0}`;
            if (out.sampleTextureDims.length < 4) out.sampleTextureDims.push(dim);
          }
        }
      });
      if (textured) out.texturedUnits++;
    }
    return out;
  });
}

test.describe('authored GLB rendering', () => {
  test('hero GLBs mount with textures on the live WebGL rigs @visual', async ({ page }, testInfo) => {
    // Real GL context + GLTF parse + meshopt decode under software rendering is
    // well over the 30s default; give it headroom. Requires a real/SwiftShader GPU.
    test.setTimeout(150_000);
    const errors = watchPageErrors(page);

    // 'high' forces the party-model preload chain (main.ts gates it on tier !== 'low'),
    // so the starter hero's authored GLB is warm by the time we look.
    await boot(page, { webgl: true, hud: true, hero: 'juggernaut', seed: 2026, quality: 'high' });
    await waitForPlayableUi(page);
    await skipActiveCinematic(page);

    // The GLB mounts asynchronously after the rig's view is created; drive the sim
    // a few frames and poll until the authored model + its texture have landed.
    let report: GlbReport = await glbReport(page);
    await expect.poll(async () => {
      await page.evaluate(() => (window as any).__test.step(33));
      report = await glbReport(page);
      return report.authored > 0 && report.texturedMeshes > 0;
    }, { timeout: 60_000, intervals: [250] }).toBe(true);

    await attachScreenshot(page, testInfo, 'glb-authored-overworld');

    // At least the starter hero mounted an authored GLB, carrying a real texture
    // map, with no asset load failures — i.e. the enhancement layer is live, not
    // silently falling back to the procedural floor.
    expect(report.authored, 'units with an authored GLB mounted').toBeGreaterThan(0);
    expect(report.texturedMeshes, 'authored meshes carrying a texture map').toBeGreaterThan(0);
    expect(report.assets, 'asset cache stats available in WebGL mode').not.toBeNull();
    expect(report.assets!.model.failures, 'GLB model load failures').toBe(0);
    expect(report.assets!.texture.failures, 'texture load failures').toBe(0);
    expect(report.assets!.gpuTextureBytes, 'GPU texture memory uploaded').toBeGreaterThan(0);
    expectNoPageErrors(errors);
  });
});
