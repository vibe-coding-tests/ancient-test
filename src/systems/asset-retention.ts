import { REG } from '../core/registry';
import type { GameSave } from '../core/types';
import { AMBIENT_CRITTERS } from '../data/world/props';
import { ENABLED_HOLDOUT_SIGNATURES, heroAssetEntry, holdoutReplacementUrl } from '../engine/assets';

// Pure asset-retention policy (OPTIMIZATION 2.0 §D.1/§D.3). These decide which
// already-loaded textures/models survive a region change: main.ts evicts every
// cached URL the new region does NOT retain before building its scene, so the
// cache holds ~one region's footprint instead of accumulating every region the
// player has ever visited. Kept DOM-free and side-effect-free so the eviction
// decision can be unit-tested headlessly (the WebGL rebuild path cannot be).

const TERRAIN_PBR_SET: Record<string, string> = {
  grass: 'Grass001',
  forest: 'Grass001',
  coast: 'Grass001',
  snow: 'Snow010A',
  desert: 'Ground080',
  wasteland: 'Ground048'
};

export function preloadPathsForRegion(regionId: string, includeEnv: boolean, includeVfx: boolean, night = false): string[] {
  const region = REG.region(regionId);
  const set = TERRAIN_PBR_SET[region.biome] ?? TERRAIN_PBR_SET.grass;
  const paths = [
    `textures/terrain/${set}_Color.jpg`,
    `textures/terrain/${set}_NormalGL.jpg`,
    `textures/terrain/${set}_Roughness.jpg`
  ];
  if ((region.waterZones?.length ?? 0) > 0) paths.push('textures/water/water_normal.webp');
  if (includeEnv) {
    paths.push('env/vale_day_1k.hdr');
    // The scene swaps to the night IBL when the clock reads night (scene.ts
    // applyEnvPhase). Preloading it for a night entry stops the moonlit
    // reflections/exposure from popping in mid-arrival.
    if (night) paths.push('env/night_1k.hdr');
  }
  if (includeVfx) paths.push('vfx/vfx_atlas.webp', 'vfx/beam_ramp.webp');
  return paths;
}

export function retainedAssetUrlsForRegion(regionId: string, includeEnv: boolean, includeVfx: boolean, night = false): Set<string> {
  return new Set(preloadPathsForRegion(regionId, includeEnv, includeVfx, night).map((path) => `/assets/${path}`));
}

// Mirror of the authored prop tables in engine/terrain.ts (TREE_MODELS /
// ROCK_MODELS / TOWN_BUILDINGS + DRESSING_PROPS). Duplicated here — like
// TERRAIN_PBR_SET above — so this policy stays DOM/THREE-free and unit-testable.
// Keep in sync if terrain.ts gains/renames a prop GLB.
const TREE_MODELS_BY_BIOME: Record<string, string[]> = {
  grass: ['oak_1', 'oak_2', 'pine_1'],
  forest: ['oak_1', 'oak_2', 'oak_4', 'pine_1', 'pine_2'],
  coast: ['oak_1', 'pine_1'],
  snow: ['pine_2', 'pine_4'],
  desert: ['oak_4'],
  wasteland: ['oak_4', 'pine_4']
};
const ROCK_MODELS = ['rock_1', 'rock_2', 'rock_3'];
const TOWN_MODELS = ['house_1', 'house_2', 'house_3', 'inn', 'blacksmith', 'well', 'cart', 'barrel', 'market_stand_1'];

/**
 * Authored scene-dressing GLBs the new region's terrain build will stream in
 * (trees/rocks for its biome + town buildings/props). main.ts preloads these
 * behind the loading screen so the world doesn't visibly assemble itself —
 * trees/buildings popping over their procedural fallback — under the arrival
 * camera. Returns manifest-relative paths (matched against file.path/url).
 */
export function propPreloadPathsForRegion(regionId: string, includeCritters = false): string[] {
  const region = REG.region(regionId);
  const trees = TREE_MODELS_BY_BIOME[region.biome] ?? TREE_MODELS_BY_BIOME.grass;
  const foliage = [...trees, ...ROCK_MODELS].map((n) => `props/foliage/${n}.glb`);
  const town = TOWN_MODELS.map((n) => `props/town/${n}.glb`);
  const critters = includeCritters ? AMBIENT_CRITTERS.map((c) => c.url.replace('/assets/', '')) : [];
  return [...foliage, ...town, ...critters];
}

export function prewarmModelPathsForSave(save: GameSave): string[] {
  const paths = new Set<string>();
  for (const heroId of save.party) {
    const entry = heroAssetEntry(heroId);
    if (!entry) continue;
    paths.add(entry.modelUrl);
    if (entry.weaponUrl) paths.add(entry.weaponUrl);
  }
  return [...paths];
}

export function assetUrl(path: string): string {
  return path.startsWith('/assets/') ? path : `/assets/${path}`;
}

export function retainedModelUrlsForSave(save: GameSave): Set<string> {
  const paths = new Set(prewarmModelPathsForSave(save).map(assetUrl));
  for (const id of ENABLED_HOLDOUT_SIGNATURES) {
    paths.add(assetUrl(`holdouts/${id}.glb`));
    const replacement = holdoutReplacementUrl(id);
    if (replacement) paths.add(assetUrl(replacement));
  }
  return paths;
}
