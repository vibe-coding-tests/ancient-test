import type { AffixDef } from '../core/types';

export const DUNGEON_AFFIXES: AffixDef[] = [
  {
    id: 'jailer',
    name: 'Jailer',
    excludes: ['vortex'],
    apply: [
      {
        kind: 'status',
        status: 'root',
        duration: 1.4,
        target: 'enemies-in-radius',
        radius: 4200,
        params: { tag: 'affix-jailer' }
      }
    ]
  },
  {
    id: 'frozen',
    name: 'Frozen',
    apply: [
      {
        kind: 'zone',
        at: 'self',
        zone: {
          shape: 'circle',
          radius: 280,
          duration: 5,
          auraMods: { affects: 'enemies', mods: { moveSpeedPct: -35, attackSpeed: -25 } },
          tick: {
            interval: 1,
            affects: 'enemies',
            effects: [{ kind: 'damage', dtype: 'magical', amount: 12, target: 'target' }]
          }
        }
      }
    ]
  },
  {
    id: 'vortex',
    name: 'Vortex',
    minTier: 'nightmare',
    excludes: ['jailer'],
    apply: [
      {
        kind: 'displace',
        mode: 'pull',
        target: 'enemies-in-radius',
        radius: 4200,
        distance: 420,
        speed: 1100,
        toward: 'caster'
      }
    ]
  },
  {
    id: 'fast',
    name: 'Fast',
    apply: [
      {
        kind: 'statmod',
        target: 'self',
        duration: 9999,
        mods: { moveSpeedPct: 22, attackSpeed: 35 }
      }
    ]
  },
  {
    id: 'molten',
    name: 'Molten',
    // A burning trail under each pack member (a follow-zone, kept finite so it
    // never outlives the creep that laid it). Punishes standing on the pack.
    apply: [
      {
        kind: 'zone',
        at: 'self',
        follow: true,
        zone: {
          shape: 'circle',
          radius: 210,
          duration: 10,
          tick: {
            interval: 1,
            affects: 'enemies',
            effects: [{ kind: 'damage', dtype: 'magical', amount: 16, target: 'target' }]
          }
        }
      }
    ]
  },
  {
    id: 'waller',
    name: 'Waller',
    minTier: 'nightmare',
    // Impassable terrain raised at engage, reusing the Fissure wall primitive.
    apply: [
      {
        kind: 'zone',
        at: 'self',
        zone: {
          shape: 'line',
          length: 540,
          width: 90,
          duration: 8,
          wall: true
        }
      }
    ]
  },
  {
    id: 'shielding',
    name: 'Shielding',
    // A bounded defensive buff (the closed-set version of D3's "timed invuln"):
    // hardened armor + magic resist that dies with the carrier, never a true
    // permanent invuln that would make a pack unkillable.
    apply: [
      {
        kind: 'statmod',
        target: 'self',
        duration: 9999,
        mods: { armor: 14, magicResistPct: 40 }
      }
    ]
  },
  {
    id: 'health-link',
    name: 'Health Link',
    minTier: 'nightmare',
    // True shared-damage is not a current primitive, so this composes the
    // existing follow-zone aura into the same readable pack fantasy: members
    // standing together reinforce each other's health and armor.
    apply: [
      {
        kind: 'zone',
        at: 'self',
        follow: true,
        zone: {
          shape: 'circle',
          radius: 420,
          duration: 9999,
          auraMods: { affects: 'allies', mods: { maxHp: 160, armor: 4 } }
        }
      }
    ]
  }
];

export function dungeonAffixes(ids: string[]): AffixDef[] {
  return ids
    .map((id) => DUNGEON_AFFIXES.find((affix) => affix.id === id))
    .filter((affix): affix is AffixDef => !!affix);
}
