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
  },
  {
    id: 'summoner',
    name: 'Summoner',
    minTier: 'hell',
    // Nasty (extra bodies + threat) so it is gated to hell. Conjures a short-lived
    // pair of thralls at engage; excludes Health Link so the adds can't be made tanky.
    excludes: ['health-link'],
    apply: [
      {
        kind: 'summon',
        at: 'self',
        count: 2,
        summon: {
          id: 'affix-conjured-thrall',
          name: 'Conjured Thrall',
          lifetime: 24,
          stats: { maxHp: 360, damage: 22, armor: 0, moveSpeed: 330, attackRange: 120, baseAttackTime: 1.5 },
          silhouette: { build: 'biped', scale: 0.58, weapon: 'sword', head: 'horned' },
          palette: ['#9a6cff', '#1a0f2e', '#d8c2ff']
        }
      }
    ]
  },
  {
    id: 'volatile',
    name: 'Volatile',
    minTier: 'nightmare',
    // The affix vocabulary has no on-death hook, so the "death-nova" reads as a
    // telegraphed pulse: a persistent footprint under the carrier that detonates
    // on a slow beat (the standing zone is the telegraph). Excludes Reflective so
    // two follow-damage fields never stack into an unreadable mince zone.
    excludes: ['reflective'],
    apply: [
      {
        kind: 'zone',
        at: 'self',
        follow: true,
        zone: {
          shape: 'circle',
          radius: 260,
          duration: 9999,
          tick: {
            interval: 3,
            affects: 'enemies',
            effects: [{ kind: 'damage', dtype: 'magical', amount: 70, target: 'target' }]
          }
        }
      }
    ]
  },
  {
    id: 'reflective',
    name: 'Reflective',
    minTier: 'nightmare',
    // A thorns field: a tight retaliation nova that punishes meleeing the carrier.
    // Composes the follow-zone primitive (there is no true damage-reflect stat).
    excludes: ['volatile'],
    apply: [
      {
        kind: 'zone',
        at: 'self',
        follow: true,
        zone: {
          shape: 'circle',
          radius: 180,
          duration: 9999,
          tick: {
            interval: 1,
            affects: 'enemies',
            effects: [{ kind: 'damage', dtype: 'physical', amount: 22, target: 'target' }]
          }
        }
      }
    ]
  },
  {
    id: 'hexer',
    name: 'Hexer',
    minTier: 'hell',
    // Nasty (strips buffs + silences) so it is gated to hell. A hex field that purges
    // and silences players who step into it — purge has no radius, so the on-enter
    // window targets each intruder directly instead of a one-shot AoE.
    apply: [
      {
        kind: 'zone',
        at: 'self',
        follow: true,
        zone: {
          shape: 'circle',
          radius: 320,
          duration: 9999,
          onEnter: {
            affects: 'enemies',
            windowSec: 2.5,
            effects: [
              { kind: 'purge', target: 'target' },
              { kind: 'status', status: 'silence', duration: 1.6, target: 'target', params: { tag: 'affix-hexer' } }
            ]
          }
        }
      }
    ]
  },
  {
    id: 'warding',
    name: 'Warding',
    minTier: 'nightmare',
    // A stationary damage ward dropped at engage (a placed hazard, not a follow-trail):
    // denies the ground the pack is fighting on so you can't just stand and trade.
    apply: [
      {
        kind: 'zone',
        at: 'self',
        zone: {
          shape: 'circle',
          radius: 340,
          duration: 12,
          tick: {
            interval: 1,
            affects: 'enemies',
            effects: [{ kind: 'damage', dtype: 'magical', amount: 20, target: 'target' }]
          }
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
