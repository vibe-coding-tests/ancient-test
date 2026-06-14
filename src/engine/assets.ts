import { AnimationClip, Group } from 'three';
import { loadModelAsset } from './asset-loaders';

export interface HeroModelAsset {
  scene: Group;
  animations: AnimationClip[];
}

export interface HeroAssetManifestEntry {
  heroId: string;
  modelUrl: string;
  weaponUrl?: string;
  clips: Partial<Record<'idle' | 'run' | 'attack' | 'cast' | 'channel' | 'death', string>>;
  sockets: ('weapon' | 'back' | 'shoulder')[];
  fallback: 'procedural';
}

// ------------------------------------------------------------------
// WS-A: shared base meshes + per-hero retexture (VFX_ASSETS §2-3).
// One CC0 base per archetype serves a whole cohort; the build retextures a copy
// to each hero's three-color palette (build_assets.mjs recolorToPalette) and the
// loader still resolves per-hero GLBs. Procedural rigs remain the floor: a hero
// with base 'procedural', or any base whose file has not shipped, simply keeps
// its hand-tuned primitive likeness.
// ------------------------------------------------------------------

export type HeroBaseId =
  | 'knight' | 'mage' | 'barbarian' | 'rogue'
  | 'spider' | 'dragonevolved' | 'demon' | 'wolf' | 'giant' | 'golelingevolved'
  | 'goblin' | 'velociraptor' | 'bull' | 'fox' | 'yeti' | 'crab' | 'ghost'
  | 'bear' | 'treant' | 'flier' | 'serpent' | 'scorpion' | 'centaur'
  | 'procedural';

const HERO_COHORTS: Record<Exclude<HeroBaseId, 'procedural'>, string[]> = {
  // §3.1 KayKit Knight base — armored melee (15). Phase 4 Tier B moved the two
  // mech offenders (clockwerk, timbersaw) off this humanoid base to the goblin family.
  knight: ['juggernaut', 'sven', 'abaddon', 'dragon-knight', 'chaos-knight', 'legion-commander', 'omniknight', 'dawnbreaker', 'kunkka', 'mars', 'wraith-king', 'chen', 'slardar', 'faceless-void', 'pangolier'],
  // §3.2 KayKit Mage base — robed caster (28). Phase 4 Tier B moved death-prophet
  // (a legless floating banshee) off this standing humanoid base to the ghost family.
  mage: ['crystal-maiden', 'lich', 'lina', 'zeus', 'witch-doctor', 'invoker', 'lion', 'rubick', 'pugna', 'necrophos', 'disruptor', 'grimstroke', 'keeper-of-the-light', 'shadow-shaman', 'silencer', 'skywrath-mage', 'outworld-destroyer', 'warlock', 'dark-seer', 'dark-willow', 'enchantress', 'natures-prophet', 'queen-of-pain', 'storm-spirit', 'vengeful-spirit', 'dazzle', 'arc-warden', 'razor'],
  // §3.3 KayKit Barbarian base — brute (15)
  barbarian: ['pudge', 'earthshaker', 'lifestealer', 'undying', 'ogre-magi', 'bristleback', 'troll-warlord', 'axe', 'magnus', 'brewmaster', 'alchemist', 'huskar', 'beastmaster', 'slark', 'underlord'],
  // §3.4 KayKit Rogue base — agile / ranged (18)
  rogue: ['sniper', 'mirana', 'drow-ranger', 'windranger', 'phantom-assassin', 'riki', 'bounty-hunter', 'anti-mage', 'templar-assassin', 'clinkz', 'meepo', 'void-spirit', 'ember-spirit', 'marci', 'phantom-lancer', 'monkey-king', 'luna', 'bloodseeker'],
  // §3.5 Quaternius/generated creature bases (42)
  spider: ['broodmother', 'weaver', 'nyx-assassin'],
  // sand-king is a scorpion: the generated scorpion family (pincers + arched stinger)
  // reads truer than the arachnid `spider` base it used to share.
  scorpion: ['sand-king'],
  dragonevolved: ['jakiro', 'viper', 'puck', 'winter-wyvern'],
  demon: ['doom', 'shadow-demon', 'shadow-fiend', 'night-stalker', 'terrorblade', 'visage', 'bane', 'leshrac'],
  wolf: ['lycan'],
  // Primal Beast wants a huge brute body; giant is the closest shipped base.
  giant: ['primal-beast'],
  golelingevolved: ['tiny', 'elder-titan', 'earth-spirit'],
  // Keen tinkerers + mech suits. Phase 4 Tier B: clockwerk (goblin in a clockwork
  // mech) and timbersaw (sawblade mech) read truer here than on the knight body.
  goblin: ['techies', 'gyrocopter', 'tinker', 'clockwerk', 'timbersaw'],
  velociraptor: ['venomancer', 'snapfire'],
  bull: ['spirit-breaker'],
  // centaur-warrunner regains its humanoid horse-torso on the generated centaur family
  // (the `bull` quadruped dropped it); shared with the centaur creeps.
  centaur: ['centaur-warrunner'],
  fox: ['hoodwink'],
  yeti: ['tusk'],
  crab: ['tidehunter'],
  // P1.3 generated creature families (original animated GLBs, runtime-recolored).
  bear: ['ursa', 'lone-druid'],
  flier: ['phoenix', 'batrider'],
  serpent: ['naga-siren', 'medusa'],
  treant: ['treant-protector'],
  // Spectral, legless floaters. Phase 4 Tier B: death-prophet (a hovering banshee)
  // reads truer on the wraith body than as a standing robed mage.
  ghost: ['spectre', 'death-prophet']
};

// §3.6 procedural-only holdouts: genuinely abstract forms where an existing
// creature base would read worse than the generated primitive rig.
const PROCEDURAL_HOLDOUTS: ReadonlySet<string> = new Set([
  'io', 'enigma', 'morphling', 'ancient-apparition'
]);

/** heroId → shared base assignment (VFX_ASSETS §3). Built once from the cohorts. */
export const HERO_BASE: Readonly<Record<string, HeroBaseId>> = (() => {
  const map: Record<string, HeroBaseId> = {};
  for (const [base, ids] of Object.entries(HERO_COHORTS) as [Exclude<HeroBaseId, 'procedural'>, string[]][]) {
    for (const id of ids) map[id] = base;
  }
  for (const id of PROCEDURAL_HOLDOUTS) map[id] = 'procedural';
  return map;
})();

/** The shared base a hero reads through, or 'procedural' when none fits. */
export function heroBaseId(heroId: string | undefined): HeroBaseId {
  if (!heroId) return 'procedural';
  return HERO_BASE[heroId] ?? 'procedural';
}

// ------------------------------------------------------------------
// Shipped hero GLBs (VFX_ASSETS WS-A). Every hero in an enabled humanoid CC0 cohort gets
// its own retextured KayKit Adventurers GLB built by scripts/assets/build_assets.mjs
// (palette recolor + clip trim), so the manifest below is derived straight from the
// cohort map rather than hand-listed. Storage is no longer a constraint (no-budget
// policy, DECISIONS 2026-06-13): we ship a per-hero file for every cohort member.
// Gating still keeps the runtime from firing 404s for cohorts whose art hasn't been
// built, while the whole pipeline + procedural fallback stays wired and tested.
// Asset policy: original/generated or any Creative Commons license incl. NC/SA
// (DECISIONS 2026-06-14), never Valve/Blizzard files, no NoDerivatives.
// ------------------------------------------------------------------

/** KayKit humanoid cohorts whose per-hero GLBs are actually built + shipped. */
export const ENABLED_HERO_COHORTS: ReadonlySet<HeroBaseId> = new Set<HeroBaseId>([
  'knight', 'mage', 'barbarian', 'rogue'
]);

const CREATURE_HERO_BASES: ReadonlySet<HeroBaseId> = new Set<HeroBaseId>([
  'spider', 'dragonevolved', 'demon', 'wolf', 'giant', 'golelingevolved',
  'goblin', 'velociraptor', 'bull', 'fox', 'yeti', 'crab', 'bear', 'treant',
  'flier', 'serpent', 'ghost', 'scorpion', 'centaur'
]);

// A few creature bases reuse a vendored creep GLB whose filename differs from the
// base id (e.g. the crab base reads through the shipped `crabenemy.glb`).
const CREATURE_BASE_FILE: Partial<Record<HeroBaseId, string>> = {
  crab: 'crabenemy'
};

// After the build renames KayKit's 76-clip universal rig down to our six logical
// clips, every shipped GLB exposes the same names; only the mage cohort ships a
// distinct channel clip (Spellcast_Long), so its entry advertises one.
function cohortClips(base: HeroBaseId): HeroAssetManifestEntry['clips'] {
  return base === 'mage'
    ? { idle: 'idle', run: 'run', attack: 'attack', cast: 'cast', channel: 'channel', death: 'death' }
    : { idle: 'idle', run: 'run', attack: 'attack', cast: 'cast', death: 'death' };
}

export const PHASE5_STARTER_ASSETS: HeroAssetManifestEntry[] = (() => {
  const out: HeroAssetManifestEntry[] = [];
  for (const [base, ids] of Object.entries(HERO_COHORTS) as [Exclude<HeroBaseId, 'procedural'>, string[]][]) {
    if (!ENABLED_HERO_COHORTS.has(base)) continue;
    for (const heroId of ids) {
      out.push({
        heroId,
        modelUrl: `/assets/heroes/${heroId}.glb`,
        weaponUrl: `/assets/weapons/heroes/${heroId}.glb`,
        clips: cohortClips(base),
        sockets: ['weapon', 'back', 'shoulder'],
        fallback: 'procedural'
      });
    }
  }
  return out.sort((a, b) => a.heroId.localeCompare(b.heroId));
})();

/** A7: abstract holdouts now ship generated animated replacement GLBs too. */
export const HOLDOUT_REPLACEMENT_ASSETS: HeroAssetManifestEntry[] = [...PROCEDURAL_HOLDOUTS]
  .sort((a, b) => a.localeCompare(b))
  .map((heroId) => ({
    heroId,
    modelUrl: `/assets/holdouts/replacements/${heroId}.glb`,
    clips: { idle: 'idle', run: 'run', attack: 'attack', cast: 'cast', channel: 'channel', death: 'death' },
    sockets: [],
    fallback: 'procedural'
  }));

/** ASSET_GAPS polish: downloaded GLBs for creature-base heroes whose shared
 * stand-in was readable but too generic. Static body downloads stay disabled
 * until an animated replacement exists; moving shared bases beat frozen bodies. */
export const BESPOKE_HERO_MODEL_ASSETS: HeroAssetManifestEntry[] = ['snapfire']
  .sort((a, b) => a.localeCompare(b))
  .map((heroId) => ({
    heroId,
    modelUrl: `/assets/heroes/${heroId}.glb`,
    clips: { idle: 'idle', run: 'run', attack: 'attack', cast: 'cast', death: 'death' },
    sockets: [],
    fallback: 'procedural'
  }));

export const BESPOKE_HERO_MODELS: ReadonlySet<string> = new Set<string>(
  BESPOKE_HERO_MODEL_ASSETS.map((a) => a.heroId)
);

const SHIPPED_HERO_ASSETS: HeroAssetManifestEntry[] = [...PHASE5_STARTER_ASSETS, ...BESPOKE_HERO_MODEL_ASSETS, ...HOLDOUT_REPLACEMENT_ASSETS]
  .sort((a, b) => a.heroId.localeCompare(b.heroId));

/** Heroes whose authored glTF is actually shipped in /public/assets. */
export const ENABLED_HERO_MODELS: ReadonlySet<string> = new Set<string>(
  SHIPPED_HERO_ASSETS.map((a) => a.heroId)
);

export const ENABLED_HOLDOUT_MODELS: ReadonlySet<string> = new Set<string>(
  HOLDOUT_REPLACEMENT_ASSETS.map((a) => a.heroId)
);

/** The manifest entry for a hero, but only when its model is actually available. */
export function heroAssetEntry(heroId: string | undefined): HeroAssetManifestEntry | null {
  if (!heroId || !ENABLED_HERO_MODELS.has(heroId)) return null;
  return SHIPPED_HERO_ASSETS.find((a) => a.heroId === heroId) ?? null;
}

/**
 * A6 fallback: additive generated signature kits for the 11 procedural holdouts.
 * A7 replacement GLBs are preferred, but these still mount over the animated
 * procedural rigs if a replacement is missing or fails.
 */
export const ENABLED_HOLDOUT_SIGNATURES: ReadonlySet<string> = new Set(PROCEDURAL_HOLDOUTS);

export function holdoutSignatureUrl(heroId: string | undefined): string | null {
  return heroId && ENABLED_HOLDOUT_SIGNATURES.has(heroId) ? `/assets/holdouts/${heroId}.glb` : null;
}

export function holdoutReplacementUrl(heroId: string | undefined): string | null {
  return heroId && ENABLED_HOLDOUT_MODELS.has(heroId) ? `/assets/holdouts/replacements/${heroId}.glb` : null;
}

/**
 * Shared bases whose CC0 GLB has actually shipped. Humanoid cohorts use per-hero
 * GLBs above; creature-base heroes reuse the already-vendored Quaternius creature
 * files under /assets/creeps. Gating keeps the runtime from firing 404s.
 */
export const ENABLED_HERO_BASES: ReadonlySet<HeroBaseId> = CREATURE_HERO_BASES;

export function heroBaseUrl(base: HeroBaseId): string | null {
  if (base === 'procedural' || !ENABLED_HERO_BASES.has(base)) return null;
  if (CREATURE_HERO_BASES.has(base)) return `/assets/creeps/${CREATURE_BASE_FILE[base] ?? base}.glb`;
  return `/assets/bases/${base}.glb`;
}

/**
 * Phase 3 (GRAPHICS_SPEC §13): creeps render as authored Quaternius creatures
 * (CC0) when a mapping exists, else fall back to the procedural rig. Specific
 * ids win; otherwise the silhouette `build` picks a sensible archetype so every
 * creep (including summoned minions) resolves to a creature.
 */
const CREATURE_BY_ID: Record<string, string> = {
  ghost: 'ghost',
  'fell-spirit': 'ghost',
  'alpha-wolf': 'wolf',
  'giant-wolf': 'wolf',
  'polar-furbolg': 'bear',
  'frostbitten-golem': 'golelingevolved',
  'granite-golem': 'golelingevolved',
  'rock-golem': 'golelingevolved',
  'mud-golem': 'golelingevolved',
  'black-dragon': 'dragonevolved',
  // Hellbear is a bear — the generated bear family (P1.3) beats the humanoid giant.
  hellbear: 'bear',
  'hill-troll': 'tribal',
  kobold: 'goblin',
  'kobold-foreman': 'goblin',
  // gnolls are hyena-folk; the generated gnoll family (hyena head + mane) reads
  // feral where the small-humanoid `goblin` did not (no CC0 hyena/gnoll GLB exists).
  'gnoll-assassin': 'gnoll',
  // vhoul are desert undead → the CC0 skeleton (idle/run/attack/death) reads far
  // closer than the goblin it replaced.
  'vhoul-assassin': 'skeleton',
  'satyr-banisher': 'demon',
  'satyr-mindstealer': 'demon',
  // Harpies are fliers; the winged family (P1.3) reads airborne, not ground-bound.
  'harpy-stormcrafter': 'flier',
  'harpy-scout': 'flier',
  // Wildkin/wildwing are owlbears — the bear family reads closer than a raptor.
  wildwing: 'bear',
  'wildwing-ripper': 'bear',
  'enraged-wildkin': 'bear',
  'ice-shaman': 'tribal',
  'ogre-frostmage': 'orcenemy',
  'prowler-shaman': 'demon',
  'prowler-acolyte': 'demon',
  'dark-troll': 'tribal',
  'dark-troll-summoner': 'tribal',
  'dark-troll-summoner-minion': 'tribal',
  'prowler-shaman-minion': 'demon',
  // Centaurs regain the humanoid torso on the generated centaur family (the `bull`
  // quadruped dropped it); shared with the centaur-warrunner hero.
  'centaur-courser': 'centaur',
  'centaur-conqueror': 'centaur',
  thunderhide: 'bull',
  'ancient-thunderhide': 'bull',
  'elder-jungle-stalker': 'wolf',
  // Route the ogre bruiser to the second orc variant so same-archetype brutes
  // aren't all the identical orc.glb (uses the otherwise-unreferenced file).
  'ogre-bruiser': 'orcenemy',
  'ogre-magi-large': 'orc',
  // Generated serpent family: snake/naga-style summons no longer use a generic
  // procedural ward/illusion body.
  'shadow-shaman-serpent-ward': 'serpent',
  'phase3-serpent-ward': 'serpent',
  'phase3-naga-image': 'serpent'
};

const CREATURE_BY_BUILD: Record<string, string> = {
  biped: 'goblin',
  brute: 'orc',
  golem: 'golelingevolved',
  quad: 'wolf',
  bird: 'flier',
  blob: 'glubevolved'
};

/** Authored creature GLB URL for a creep, or null to keep the procedural rig. */
export function creepCreatureUrl(creepId: string | undefined, build: string | undefined): string | null {
  const name = (creepId && CREATURE_BY_ID[creepId]) || (build && CREATURE_BY_BUILD[build]) || null;
  return name ? `/assets/creeps/${name}.glb` : null;
}

// Marquee artifacts with a generated signature held-weapon GLB (ASSET_GAPS P3).
// Generated by scripts/assets/generate_item_weapons.mjs; these override the hero's
// default hand weapon when equipped. Items keep their procedural `appearance.weapon`
// as the guaranteed fallback when the asset is absent.
const ITEM_WEAPON_GLB = new Set([
  'daedalus',
  'radiance',
  'battlefury',
  'divine-rapier',
  'butterfly',
  'scythe-of-vyse',
  'eye-of-skadi',
  'monkey-king-bar',
  'abyssal-blade',
  'mjollnir',
  'satanic',
  'bloodthorn',
  'desolator'
]);

/** Signature held-weapon GLB URL for an equipped item, or null if it has none. */
export function itemWeaponGlbUrl(defId: string | undefined): string | null {
  return defId && ITEM_WEAPON_GLB.has(defId) ? `/assets/weapons/items/${defId}.glb` : null;
}

export class HeroAssetLoader {
  private cache = new Map<string, Promise<HeroModelAsset | null>>();
  private weaponCache = new Map<string, Promise<HeroModelAsset | null>>();
  private baseCache = new Map<HeroBaseId, Promise<HeroModelAsset | null>>();

  /** Resolve a hero's authored scene + clips, or null to keep the procedural rig. */
  loadHero(entry: HeroAssetManifestEntry): Promise<HeroModelAsset | null> {
    const cached = this.cache.get(entry.heroId);
    if (cached) return cached;
    const promise = loadModelAsset(entry.modelUrl);
    this.cache.set(entry.heroId, promise);
    return promise;
  }

  /** Resolve a hero's generated held-weapon scene, or null to keep the procedural fallback. */
  loadHeroWeapon(entry: HeroAssetManifestEntry): Promise<HeroModelAsset | null> {
    if (!entry.weaponUrl) return Promise.resolve(null);
    const cached = this.weaponCache.get(entry.heroId);
    if (cached) return cached;
    const promise = loadModelAsset(entry.weaponUrl);
    this.weaponCache.set(entry.heroId, promise);
    return promise;
  }

  /**
   * WS-A0: load a shared base mesh once and reuse the clone for every hero in its
   * cohort. Caching per base (not per hero) is what keeps 122 heroes at ~16 loads.
   * Returns null for procedural holdouts or any base whose file has not shipped.
   */
  loadBase(base: HeroBaseId): Promise<HeroModelAsset | null> {
    const cached = this.baseCache.get(base);
    if (cached) return cached;
    const url = heroBaseUrl(base);
    const promise: Promise<HeroModelAsset | null> = url
      ? loadModelAsset(url)
      : Promise.resolve(null);
    this.baseCache.set(base, promise);
    return promise;
  }

  /** True once a load has been attempted for this hero (success or fallback). */
  has(heroId: string): boolean {
    return this.cache.has(heroId);
  }

  /** True once a base load has been attempted (cohort-shared). */
  hasBase(base: HeroBaseId): boolean {
    return this.baseCache.has(base);
  }
}
