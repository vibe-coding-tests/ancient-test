// Declared world sizes for the built & environment layer (OVERWORLD_PLANNING §4).
//
// Buildings, dressing props, foliage, and ambient critters used to size at the
// call site (a hardcoded 3.6 for town buildings, inline prop heights, literal
// critter heights in scene.ts). This is "the one new home": `terrain.ts` and
// `scene.ts` read a declared `WorldSize` from here instead of a literal, so the
// built world has the same single source of truth as creatures.

import type { CollisionLayer, WorldSize } from '../../core/types';

export type WorldCollisionMode = 'solid' | 'soft' | 'decor';

export interface WorldCollisionSpec {
  mode: WorldCollisionMode;
  radius: number;
  layer: CollisionLayer;
  blocksProjectiles?: boolean;
  label: string;
}

/** Town buildings (houses, inn, blacksmith) fit to this — replaces the 3.6 literal. */
export const TOWN_BUILDING_SIZE: WorldSize = {
  heightM: 3.6,
  footprintM: 3.0,
  widthM: 6,
  depthM: 6,
  sizeClass: 'structure',
  pose: 'static',
  footprintDecoupled: true
};

/** The town's central monument: the one `landmark` that reads from across the region
 *  and towers over every `structure` (OVERWORLD_PLANNING §3 door-frame / §6 neighbour
 *  rule). Rendered at the plaza centre by `buildTownMonument` in `terrain.ts`. */
export const TOWN_LANDMARK_SIZE: WorldSize = {
  heightM: 12,
  footprintM: 2.4,
  widthM: 4,
  depthM: 4,
  sizeClass: 'landmark',
  pose: 'static',
  footprintDecoupled: true
};

export const TOWN_BUILDING_COLLISION: WorldCollisionSpec = {
  mode: 'solid',
  radius: 300,
  layer: 'static',
  blocksProjectiles: true,
  label: 'Town building'
};

export const TOWN_LANDMARK_COLLISION: WorldCollisionSpec = {
  mode: 'soft',
  radius: 240,
  layer: 'static',
  blocksProjectiles: false,
  label: 'Town landmark'
};

export const SHRINE_COLLISION: WorldCollisionSpec = {
  mode: 'soft',
  radius: 500,
  layer: 'trigger',
  blocksProjectiles: false,
  label: 'Shrine'
};

export const CHEST_COLLISION: WorldCollisionSpec = {
  mode: 'soft',
  radius: 260,
  layer: 'loot',
  blocksProjectiles: false,
  label: 'Chest'
};

export const GROUND_LOOT_COLLISION: WorldCollisionSpec = {
  mode: 'soft',
  radius: 72,
  layer: 'loot',
  blocksProjectiles: false,
  label: 'Ground loot'
};

export const REGION_TRIGGER_COLLISION = {
  gate: { mode: 'soft', layer: 'trigger', blocksProjectiles: false, label: 'Route gate' },
  dungeon: { mode: 'soft', layer: 'trigger', blocksProjectiles: false, label: 'Dungeon portal' },
  gym: { mode: 'soft', layer: 'trigger', blocksProjectiles: false, label: 'Gym entrance' },
  waypoint: { mode: 'soft', layer: 'trigger', blocksProjectiles: false, label: 'Waypoint' },
  discovery: { mode: 'soft', layer: 'trigger', blocksProjectiles: false, label: 'Discovery' },
  shard: { mode: 'soft', layer: 'loot', blocksProjectiles: false, label: 'Mad Moon shard' }
} as const satisfies Record<string, Omit<WorldCollisionSpec, 'radius'>>;

/** Authored town dressing props already on disk, each with its declared size. */
export const DRESSING_PROP_SIZES = {
  well: { heightM: 1.9, footprintM: 0.9, sizeClass: 'prop', pose: 'static' },
  cart: { heightM: 1.5, footprintM: 1.0, sizeClass: 'prop', pose: 'static' },
  barrel: { heightM: 1.0, footprintM: 0.4, sizeClass: 'prop', pose: 'static' },
  market: { heightM: 2.0, footprintM: 1.2, sizeClass: 'prop', pose: 'static' }
} as const satisfies Record<string, WorldSize>;

export const DRESSING_PROP_COLLISION = {
  well: { mode: 'solid', radius: 95, layer: 'static', blocksProjectiles: false, label: 'Town well' },
  cart: { mode: 'solid', radius: 90, layer: 'static', blocksProjectiles: false, label: 'Market cart' },
  barrel: { mode: 'solid', radius: 42, layer: 'static', blocksProjectiles: false, label: 'Barrel' },
  market: { mode: 'soft', radius: 110, layer: 'trigger', blocksProjectiles: false, label: 'Market stand' }
} as const satisfies Record<keyof typeof DRESSING_PROP_SIZES, WorldCollisionSpec>;

// Solid-looking town dressing that previously had no collider, so the hero
// walked straight through it (the "some objects are solid, others aren't"
// inconsistency). Each now blocks movement so it reads as physical and A* routes
// around it. Radii are kept tight to the visible footprint so they don't choke
// the plaza.
export const LAMP_POST_COLLISION: WorldCollisionSpec = {
  mode: 'solid', radius: 34, layer: 'static', blocksProjectiles: false, label: 'Lamp post'
};
export const CRATE_COLLISION: WorldCollisionSpec = {
  mode: 'solid', radius: 40, layer: 'static', blocksProjectiles: false, label: 'Crate'
};

/** Instanced foliage fit targets — replaces the 4.6 / 1.5 literals in terrain.ts. */
export const FOLIAGE_SIZES = {
  tree: { heightM: 4.6, footprintM: 1.2, sizeClass: 'structure', pose: 'static' },
  rock: { heightM: 1.5, footprintM: 0.9, sizeClass: 'prop', pose: 'static' },
  bush: { heightM: 0.9, footprintM: 0.7, sizeClass: 'prop', pose: 'static' },
  fern: { heightM: 0.7, footprintM: 0.45, sizeClass: 'prop', pose: 'static' }
} as const satisfies Record<string, WorldSize>;

/** Gameplay collision modes for generated overworld dressing. */
export const FOLIAGE_COLLISION = {
  tree: { mode: 'solid', radius: 55, layer: 'static', blocksProjectiles: false, label: 'Tree' },
  rock: { mode: 'solid', radius: 60, layer: 'static', blocksProjectiles: false, label: 'Rock' },
  bush: { mode: 'decor', radius: 0, layer: 'decor', label: 'Bush' },
  fern: { mode: 'decor', radius: 0, layer: 'decor', label: 'Fern' }
} as const satisfies Record<keyof typeof FOLIAGE_SIZES, WorldCollisionSpec>;

export interface AmbientCritterDef {
  id: string;
  url: string;
  speed: number;
  worldSize: WorldSize;
}

/** Ambient town critters — replaces the literal heights in scene.ts. */
export const AMBIENT_CRITTERS: AmbientCritterDef[] = [
  { id: 'alpaca', url: '/assets/creeps/alpaca.glb', speed: 30, worldSize: { heightM: 1.3, footprintM: 0.4, sizeClass: 'small', pose: 'quadruped' } },
  { id: 'fox', url: '/assets/creeps/fox.glb', speed: 78, worldSize: { heightM: 0.7, footprintM: 0.18, sizeClass: 'tiny', pose: 'quadruped' } },
  { id: 'frog', url: '/assets/creeps/frog.glb', speed: 40, worldSize: { heightM: 0.42, footprintM: 0.12, sizeClass: 'tiny', pose: 'quadruped' } }
];

/** All declared built/env sizes, flattened for the §7 coverage matrix + lint. */
export const BUILT_WORLD_SIZES: { id: string; kind: 'building' | 'landmark' | 'prop' | 'critter'; worldSize: WorldSize }[] = [
  { id: 'town-monument', kind: 'landmark', worldSize: TOWN_LANDMARK_SIZE },
  { id: 'town-building', kind: 'building', worldSize: TOWN_BUILDING_SIZE },
  ...Object.entries(DRESSING_PROP_SIZES).map(([id, worldSize]) => ({ id, kind: 'prop' as const, worldSize })),
  ...Object.entries(FOLIAGE_SIZES).map(([id, worldSize]) => ({ id, kind: 'prop' as const, worldSize })),
  ...AMBIENT_CRITTERS.map((c) => ({ id: c.id, kind: 'critter' as const, worldSize: c.worldSize }))
];
