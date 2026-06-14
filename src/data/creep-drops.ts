import { TUNING } from './tuning';
import { GEM_DEFS } from './gems';
import type { CreepTier, DifficultyTier, ItemDropTable, ItemQuality, ItemRarity } from '../core/types';

const COMMON_CONSUMABLES = [
  'tango',
  'healing-salve',
  'clarity',
  'dust-of-appearance',
  'observer-ward',
  'sentry-ward',
  'smoke-of-deceit'
].map((id) => ({ id, weight: 1 }));

const CHIPPED_GEMS = GEM_DEFS
  .filter((gem) => gem.grade === 'chipped')
  .map((gem) => ({ id: gem.id, weight: 1 }));

function itemEntry(id: string, rarity: ItemRarity = 'legendary', weight = 1) {
  return { id, weight, rarity };
}

const EARLY_COMPONENTS = [
  'iron-branch',
  'circlet',
  'gauntlets-of-strength',
  'slippers-of-agility',
  'mantle-of-intelligence',
  'belt-of-strength',
  'band-of-elvenskin',
  'robe-of-the-magi',
  'blades-of-attack'
].map((id) => ({ id, weight: 1 }));

const DEEP_COMPONENTS = [
  'broadsword',
  'claymore',
  'mithril-hammer',
  'demon-edge',
  'eaglesong',
  'reaver',
  'mystic-staff',
  'ultimate-orb',
  'point-booster',
  'sacred-relic'
].map((id) => ({ id, weight: 1 }));

const LARGE_ENDGAME_CORES = [
  'guardian-greaves',
  'manta-style',
  'daedalus',
  'monkey-king-bar',
  'ethereal-blade'
].map((id) => itemEntry(id));

const ANCIENT_ENDGAME_CORES = [
  'assault-cuirass',
  'manta-style',
  'daedalus',
  'monkey-king-bar',
  'mjollnir',
  'ethereal-blade',
  'wind-waker'
].map((id) => itemEntry(id));

export function qualityOddsByTier(): Record<DifficultyTier, Partial<Record<ItemQuality, number>>> {
  const out = {} as Record<DifficultyTier, Partial<Record<ItemQuality, number>>>;
  for (const tier of ['normal', 'nightmare', 'hell'] as const) {
    const chance = TUNING.loot.qualityDropChance[tier];
    out[tier] = {
      standard: 1 - chance,
      genuine: chance * 0.42,
      frozen: chance * 0.24,
      inscribed: chance * 0.22,
      corrupted: chance * 0.09,
      unusual: chance * 0.03
    };
  }
  return out;
}

export const DEFAULT_CREEP_DROP_TABLES: Record<CreepTier, ItemDropTable> = {
  small: {
    guaranteed: [],
    slots: [
      { id: 'creep-common-consumable', rarity: 'common', rolls: 1, chance: { normal: 0.30, nightmare: 0.36, hell: 0.42 }, pool: COMMON_CONSUMABLES, source: 'creep' },
      { id: 'creep-gem-chip', rarity: 'common', rolls: 1, chance: { normal: 0.08, nightmare: 0.11, hell: 0.14 }, pool: CHIPPED_GEMS, source: 'creep' }
    ]
  },
  medium: {
    guaranteed: [],
    slots: [
      { id: 'creep-common-consumable', rarity: 'common', rolls: 1, chance: { normal: 0.40, nightmare: 0.46, hell: 0.52 }, pool: COMMON_CONSUMABLES, source: 'creep' },
      { id: 'creep-gem-chip', rarity: 'common', rolls: 1, chance: { normal: 0.12, nightmare: 0.16, hell: 0.20 }, pool: CHIPPED_GEMS, source: 'creep' },
      { id: 'creep-uncommon-component', rarity: 'uncommon', rolls: 1, chance: { normal: 0.25, nightmare: 0.32, hell: 0.40 }, pool: EARLY_COMPONENTS, source: 'creep' }
    ]
  },
  large: {
    guaranteed: [],
    slots: [
      { id: 'creep-common-consumable', rarity: 'common', rolls: 1, chance: { normal: 0.35, nightmare: 0.42, hell: 0.50 }, pool: COMMON_CONSUMABLES, source: 'creep' },
      { id: 'creep-uncommon-component', rarity: 'uncommon', rolls: 1, chance: { normal: 0.55, nightmare: 0.64, hell: 0.74 }, pool: EARLY_COMPONENTS, source: 'creep' },
      { id: 'creep-gem-chip', rarity: 'common', rolls: 1, chance: { normal: 0.18, nightmare: 0.24, hell: 0.30 }, pool: CHIPPED_GEMS, source: 'creep' },
      { id: 'creep-large-endgame', rarity: 'legendary', rolls: 1, chance: TUNING.overworldEgSlotPct.largeCreep, pool: LARGE_ENDGAME_CORES, qualityOddsByTier: qualityOddsByTier(), source: 'creep', raritySplit: true }
    ]
  },
  ancient: {
    guaranteed: [],
    slots: [
      { id: 'creep-rare-component', rarity: 'rare', rolls: 1, chance: { normal: 0.60, nightmare: 0.72, hell: 0.84 }, pool: DEEP_COMPONENTS, source: 'creep' },
      { id: 'creep-mythical-component', rarity: 'mythical', rolls: 1, chance: { normal: 0.28, nightmare: 0.38, hell: 0.50 }, pool: DEEP_COMPONENTS, source: 'creep' },
      { id: 'creep-ancient-endgame', rarity: 'legendary', rolls: 1, chance: TUNING.overworldEgSlotPct.ancientCreep, pool: ANCIENT_ENDGAME_CORES, qualityOddsByTier: qualityOddsByTier(), source: 'creep', raritySplit: true }
    ]
  }
};
