import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { newGameSave } from '../systems/game';
import { heroAssetEntry } from '../engine/assets';
import {
  preloadPathsForRegion,
  propPreloadPathsForRegion,
  retainedAssetUrlsForRegion,
  retainedModelUrlsForSave
} from '../systems/asset-retention';

// OPTIMIZATION 2.0 §D.3 / §G.3 leak guard (headless). The WebGL region-cycle
// rebuild can't run under CI's SwiftShader (it destabilises the GPU process), so
// the guard lives where the leak is actually *decided*: the retained-set policy
// that main.ts feeds to evictTextureAssets/evictModelAssets on every travel. If
// these sets wrongly retained the old region, nothing would be reclaimed and the
// cache would grow region over region. These are pure, so we assert them directly.

beforeAll(() => registerAllContent());

describe('region-travel asset retention (leak guard)', () => {
  it('retains only the destination region\'s terrain set, so the old one is evicted', () => {
    // tranquil-vale is grass (Grass001); devarshi-desert is desert (Ground080).
    const grass = retainedAssetUrlsForRegion('tranquil-vale', true, true);
    const desert = retainedAssetUrlsForRegion('devarshi-desert', true, true);

    const grassColor = '/assets/textures/terrain/Grass001_Color.jpg';
    const desertColor = '/assets/textures/terrain/Ground080_Color.jpg';

    expect(grass.has(grassColor)).toBe(true);
    expect(desert.has(desertColor)).toBe(true);

    // Travelling grass -> desert must NOT retain the grass textures: the eviction
    // predicate main.ts uses, `(url) => !retained.has(url)`, then reclaims them.
    expect(desert.has(grassColor)).toBe(false);
    const evictsGrass = (url: string): boolean => !desert.has(url);
    expect(evictsGrass(grassColor)).toBe(true);
    expect(evictsGrass(desertColor)).toBe(false);
  });

  it('keeps the per-region retained set bounded (one terrain set + env/vfx), never additive', () => {
    // A region's retained texture footprint is a fixed, small set regardless of
    // how many regions the player has visited — that's what stops accumulation.
    const full = preloadPathsForRegion('tranquil-vale', true, true);
    const terrainOnly = preloadPathsForRegion('devarshi-desert', false, false);
    expect(terrainOnly).toHaveLength(3); // color + normal + roughness
    expect(full.length).toBeLessThanOrEqual(7); // + water normal + env hdr + 2 vfx atlases
    // Low tier (no env/vfx) retains strictly less than the enhanced tier.
    expect(retainedAssetUrlsForRegion('tranquil-vale', false, false).size)
      .toBeLessThan(retainedAssetUrlsForRegion('tranquil-vale', true, true).size);
  });

  it('preloads water, night IBL, and enhanced critters only when the scene will need them', () => {
    const water = preloadPathsForRegion('nightsilver-woods', true, false, true);
    expect(water).toContain('textures/water/water_normal.webp');
    expect(water).toContain('env/night_1k.hdr');

    const dry = preloadPathsForRegion('devarshi-desert', true, false, false);
    expect(dry).not.toContain('textures/water/water_normal.webp');
    expect(dry).not.toContain('env/night_1k.hdr');

    const lowProps = propPreloadPathsForRegion('tranquil-vale', false);
    const enhancedProps = propPreloadPathsForRegion('tranquil-vale', true);
    expect(lowProps.some((path) => path.startsWith('creeps/'))).toBe(false);
    expect(enhancedProps).toEqual(expect.arrayContaining(['creeps/alpaca.glb', 'creeps/fox.glb', 'creeps/frog.glb']));
  });

  it('retains party hero models but not benched heroes (so swapped-out models evict)', () => {
    const save = newGameSave('juggernaut');
    const retained = retainedModelUrlsForSave(save);

    const jug = heroAssetEntry('juggernaut');
    const sven = heroAssetEntry('sven');
    // Both are authored humanoids with GLB entries; only the party member is retained.
    expect(jug?.modelUrl).toBeTruthy();
    expect(sven?.modelUrl).toBeTruthy();
    expect(retained.has(jug!.modelUrl)).toBe(true);
    expect(retained.has(sven!.modelUrl)).toBe(false);

    // A benched hero's model is therefore evictable on the next scene build.
    const evicts = (url: string): boolean => !retained.has(url);
    expect(evicts(sven!.modelUrl)).toBe(true);
    expect(evicts(jug!.modelUrl)).toBe(false);
  });
});
