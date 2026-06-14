import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { ALL_HEROES } from '../data/index';
import { ALL_CREEPS } from '../data/creeps/index';
import { creepWorldSize, heroWorldSize, inBand, inferCreatureSizeClass, SIZE_BANDS, SIZE_PROMPTS, type ResolvedWorldSize } from '../engine/world-size';
import { AMBIENT_CRITTERS, DRESSING_PROP_SIZES, TOWN_BUILDING_SIZE, FOLIAGE_SIZES } from '../data/world/props';
import { TREE_MODELS, ROCK_MODELS, TOWN_BUILDINGS } from '../engine/terrain';
import type { SizeClass, WorldSize } from '../core/types';
import { creepCreatureUrl, heroBaseId, heroBaseUrl, HOLDOUT_REPLACEMENT_ASSETS } from '../engine/assets';

// ============================================================
// OVERWORLD_PLANNING §5.6 / §10.4: the build pipeline (build_assets.mjs, a plain
// .mjs with no TS runtime) needs each shipped GLB's declared fit target so it can
// stamp post-fit `dimsM` into the manifest (closing the §9.5 gate). This test is
// the generator + the guard: it computes the authoritative path -> WorldSize map
// from the same resolver the renderer uses and asserts the committed JSON matches.
// Refresh with: UPDATE_WORLD_SIZES=1 npx vitest run src/test/asset-world-sizes.test.ts
// ============================================================

const MAP_PATH = 'scripts/assets/world-sizes.generated.json';

interface SizeMapEntry {
  heightM: number;
  sizeClass: SizeClass;
  pose: string;
  source: string;
}

const round = (n: number): number => +n.toFixed(4);

function entryFrom(ws: ResolvedWorldSize | WorldSize, source: string): SizeMapEntry {
  return {
    heightM: round(ws.heightM),
    sizeClass: (ws.sizeClass ?? 'prop') as SizeClass,
    pose: ws.pose ?? 'static',
    source
  };
}

function entryFromHeight(heightM: number, source: string): SizeMapEntry {
  return {
    heightM: round(heightM),
    sizeClass: inferCreatureSizeClass(heightM),
    pose: 'standing',
    source
  };
}

function assetPath(url: string): string {
  return url.replace(/^\/assets\//, '');
}

function putTallest(map: Record<string, SizeMapEntry>, path: string, heightM: number): void {
  const prev = map[path];
  if (!prev || heightM > prev.heightM) map[path] = entryFromHeight(heightM, 'shared-creature');
}

// Dressing-prop keys -> the authored filenames already on disk.
const DRESSING_FILES: Record<keyof typeof DRESSING_PROP_SIZES, string> = {
  well: 'well',
  cart: 'cart',
  barrel: 'barrel',
  market: 'market_stand_1'
};

const FOLIAGE_FILES: Record<keyof typeof FOLIAGE_SIZES, string[]> = {
  tree: [...new Set(Object.values(TREE_MODELS).flat())],
  rock: ROCK_MODELS,
  bush: ['bush'],
  fern: ['fern']
};

function buildSizeMap(): Record<string, SizeMapEntry> {
  const map: Record<string, SizeMapEntry> = {};
  // Per-hero GLBs (one file per hero, fit to 1.8 x scale).
  for (const hero of ALL_HEROES) map[`heroes/${hero.id}.glb`] = entryFrom(heroWorldSize(hero), 'hero');
  // Full-body holdout replacement GLBs live outside /heroes but fit to the same
  // resolved hero height. Additive signature props are intentionally not mapped.
  for (const asset of HOLDOUT_REPLACEMENT_ASSETS) {
    const hero = ALL_HEROES.find((h) => h.id === asset.heroId);
    if (hero) map[assetPath(asset.modelUrl)] = entryFrom(heroWorldSize(hero), 'holdout-replacement');
  }
  // Shared creature GLBs can be reused by multiple creeps/heroes and are fit at
  // runtime to each unit's rig. The manifest target is therefore a nominal path
  // target: the tallest current user of that shared asset, enough to stamp `dimsM`
  // and catch grotesque authored proportions without pretending the path is unique.
  for (const creep of ALL_CREEPS) {
    const url = creepCreatureUrl(creep.id, creep.silhouette.build);
    if (url) putTallest(map, assetPath(url), creepWorldSize(creep).heightM);
  }
  for (const hero of ALL_HEROES) {
    const url = heroBaseUrl(heroBaseId(hero.id));
    if (url?.startsWith('/assets/creeps/')) putTallest(map, assetPath(url), heroWorldSize(hero).heightM);
  }
  // Ambient critters.
  for (const c of AMBIENT_CRITTERS) map[assetPath(c.url)] = entryFrom(c.worldSize, 'critter');
  // Town dressing props.
  for (const [key, file] of Object.entries(DRESSING_FILES)) {
    map[`props/town/${file}.glb`] = entryFrom(DRESSING_PROP_SIZES[key as keyof typeof DRESSING_PROP_SIZES], 'prop');
  }
  // Town buildings (all share the structure fit target).
  for (const name of TOWN_BUILDINGS) map[`props/town/${name}.glb`] = entryFrom(TOWN_BUILDING_SIZE, 'building');
  // Foliage classes: trees, rocks, and shipped low props.
  for (const [kind, files] of Object.entries(FOLIAGE_FILES)) {
    for (const name of files) map[`props/foliage/${name}.glb`] = entryFrom(FOLIAGE_SIZES[kind as keyof typeof FOLIAGE_SIZES], 'foliage');
  }
  // Stable key order so the committed JSON is diff-friendly.
  return Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
}

describe('asset world sizes (OVERWORLD_PLANNING §5.6)', () => {
  const sizes = buildSizeMap();

  it('every mapped GLB declares an in-band height', () => {
    expect(Object.keys(sizes).length).toBeGreaterThan(130);
    for (const [path, entry] of Object.entries(sizes)) {
      expect(SIZE_BANDS[entry.sizeClass], `${path}: class ${entry.sizeClass}`).toBeDefined();
      expect(inBand(entry.sizeClass, entry.heightM), `${path}: ${entry.heightM}m out of ${entry.sizeClass} band`).toBe(true);
    }
  });

  it('the committed size map is in sync with the resolver', () => {
    const payload = {
      _comment: 'GENERATED by src/test/asset-world-sizes.test.ts. Path -> declared WorldSize the asset build fits to, plus the per-class generation-prompt anchors (OVERWORLD_PLANNING §5.6). Refresh: UPDATE_WORLD_SIZES=1 npx vitest run src/test/asset-world-sizes.test.ts',
      version: 2,
      prompts: SIZE_PROMPTS,
      sizes
    };
    if (process.env.UPDATE_WORLD_SIZES) {
      writeFileSync(MAP_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    }
    let onDisk: { sizes?: Record<string, SizeMapEntry>; prompts?: Record<string, string> } | null = null;
    try {
      onDisk = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
    } catch {
      onDisk = null;
    }
    expect(onDisk, `${MAP_PATH} missing — run UPDATE_WORLD_SIZES=1 to generate`).not.toBeNull();
    expect(onDisk!.sizes, 'size map drifted — run UPDATE_WORLD_SIZES=1 to refresh').toEqual(sizes);
    expect(onDisk!.prompts, 'prompt bridge drifted — run UPDATE_WORLD_SIZES=1 to refresh').toEqual(SIZE_PROMPTS);
  });
});
