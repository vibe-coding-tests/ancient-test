import type { ItemDef } from '../../core/types';

// ============================================================
// Phase 1 item catalog: consumables, components, and 15+
// identity-rich assembled items (SPEC §5, Item Feel Fidelity).
// ============================================================

export const CONSUMABLES: ItemDef[] = [
  {
    id: 'tango',
    name: 'Tango',
    tier: 'consumable',
    cost: 90,
    charges: 3,
    lore: 'Bitter leaves the vale shepherds chew on long watches.',
    glyph: 'leaf',
    active: {
      id: 'tango-active',
      name: 'Eat Tango',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [1],
      effects: [
        { kind: 'status', status: 'buff', duration: 16, target: 'self', params: { mods: { hpRegen: 7 }, tag: 'tango-regen' } }
      ],
      vfx: { archetype: 'shield', color: '#9fdc5c', scale: 0.4 }
    }
  },
  {
    id: 'healing-salve',
    name: 'Healing Salve',
    tier: 'consumable',
    cost: 110,
    charges: 1,
    lore: 'A thick ointment that works fast but hates being interrupted.',
    glyph: 'flask',
    active: {
      id: 'salve-active',
      name: 'Apply Salve',
      targeting: 'unit-target',
      affects: 'ally',
      castRange: 250,
      castPoint: 0,
      cooldown: [1],
      effects: [
        { kind: 'status', status: 'buff', duration: 8, target: 'target', params: { mods: { hpRegen: 50 }, breakOnDamage: true, tag: 'salve-regen' } }
      ],
      vfx: { archetype: 'shield', color: '#ff9fb8', scale: 0.5 }
    }
  },
  {
    id: 'clarity',
    name: 'Clarity',
    tier: 'consumable',
    cost: 50,
    charges: 1,
    lore: 'Bottled focus. Spills easily.',
    glyph: 'flask',
    active: {
      id: 'clarity-active',
      name: 'Drink Clarity',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [1],
      effects: [
        { kind: 'status', status: 'buff', duration: 20, target: 'self', params: { mods: { manaRegen: 11 }, breakOnDamage: true, tag: 'clarity-regen' } }
      ],
      vfx: { archetype: 'shield', color: '#86c8ff', scale: 0.4 }
    }
  },
  {
    id: 'dust-of-appearance',
    name: 'Dust of Appearance',
    tier: 'consumable',
    cost: 80,
    charges: 1,
    lore: 'Ground moonstone. It settles on what pretends not to be there.',
    glyph: 'burst',
    active: {
      id: 'dust-active',
      name: 'Scatter Dust',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [1],
      effects: [
        {
          kind: 'status', status: 'buff', duration: 12, target: 'enemies-in-radius', radius: 1050,
          params: { mods: { revealed: 1, moveSpeedPct: -15 }, tag: 'dust-reveal' }
        }
      ],
      vfx: { archetype: 'ground-aoe', color: '#c8a0ff', scale: 1 }
    }
  }
];

export const COMPONENTS: ItemDef[] = [
  { id: 'iron-branch', name: 'Iron Branch', tier: 'component', cost: 50, passiveMods: { str: 1, agi: 1, int: 1 }, lore: 'A twig of the World Tree. Surprisingly load-bearing.', glyph: 'branch' },
  { id: 'circlet', name: 'Circlet', tier: 'component', cost: 155, passiveMods: { str: 2, agi: 2, int: 2 }, lore: 'A thin band of moon-silver.', glyph: 'ring' },
  { id: 'crown', name: 'Crown', tier: 'component', cost: 450, passiveMods: { str: 4, agi: 4, int: 4 }, lore: 'Worn by a minor king of a minor hill.', glyph: 'crown' },
  { id: 'gauntlets-of-strength', name: 'Gauntlets of Strength', tier: 'component', cost: 140, passiveMods: { str: 3 }, lore: 'Knuckles first, questions later.', glyph: 'fist' },
  { id: 'slippers-of-agility', name: 'Slippers of Agility', tier: 'component', cost: 140, passiveMods: { agi: 3 }, lore: 'Soft-soled and silent.', glyph: 'boot' },
  { id: 'mantle-of-intelligence', name: 'Mantle of Intelligence', tier: 'component', cost: 140, passiveMods: { int: 3 }, lore: 'Smells faintly of old libraries.', glyph: 'mantle' },
  { id: 'belt-of-strength', name: 'Belt of Strength', tier: 'component', cost: 450, passiveMods: { str: 6 }, lore: 'Cinch it tight; lift the world.', glyph: 'belt' },
  { id: 'band-of-elvenskin', name: 'Band of Elvenskin', tier: 'component', cost: 450, passiveMods: { agi: 6 }, lore: 'Woven by hands that never fumble.', glyph: 'band' },
  { id: 'robe-of-the-magi', name: 'Robe of the Magi', tier: 'component', cost: 450, passiveMods: { int: 6 }, lore: 'The hem is stitched with quiet theorems.', glyph: 'mantle' },
  { id: 'blades-of-attack', name: 'Blades of Attack', tier: 'component', cost: 450, passiveMods: { damage: 9 }, lore: 'Twin edges, zero patience.', glyph: 'blade' },
  { id: 'broadsword', name: 'Broadsword', tier: 'component', cost: 1000, passiveMods: { damage: 15 }, lore: 'A soldier\u2019s honest answer.', glyph: 'blade' },
  { id: 'claymore', name: 'Claymore', tier: 'component', cost: 1350, passiveMods: { damage: 20 }, lore: 'Heavy enough to argue with gates.', glyph: 'blade' },
  { id: 'mithril-hammer', name: 'Mithril Hammer', tier: 'component', cost: 1600, passiveMods: { damage: 24 }, lore: 'Forged from a falling star\u2019s leftovers.', glyph: 'hammer' },
  { id: 'quarterstaff', name: 'Quarterstaff', tier: 'component', cost: 875, passiveMods: { damage: 10, attackSpeed: 10 }, lore: 'Plain wood, perfect balance.', glyph: 'staff' },
  { id: 'ogre-axe', name: 'Ogre Axe', tier: 'component', cost: 1000, passiveMods: { str: 10 }, lore: 'An ogre\u2019s idea of subtlety.', glyph: 'axe' },
  { id: 'staff-of-wizardry', name: 'Staff of Wizardry', tier: 'component', cost: 1000, passiveMods: { int: 10 }, lore: 'Hums at the frequency of unfinished spells.', glyph: 'staff' },
  { id: 'blade-of-alacrity', name: 'Blade of Alacrity', tier: 'component', cost: 1000, passiveMods: { agi: 10 }, lore: 'Light as a rumor.', glyph: 'blade' },
  { id: 'boots-of-speed', name: 'Boots of Speed', tier: 'basic', cost: 500, passiveMods: { moveSpeed: 45 }, lore: 'The vale\u2019s most popular purchase.', glyph: 'boot' },
  { id: 'gloves-of-haste', name: 'Gloves of Haste', tier: 'component', cost: 450, passiveMods: { attackSpeed: 20 }, lore: 'They twitch when you hesitate.', glyph: 'fist' },
  { id: 'sages-mask', name: 'Sage\u2019s Mask', tier: 'component', cost: 175, passiveMods: { manaRegen: 1 }, lore: 'Breathe in. The mana follows.', glyph: 'mask' },
  { id: 'ring-of-regen', name: 'Ring of Regeneration', tier: 'component', cost: 175, passiveMods: { hpRegen: 1.75 }, lore: 'A modest loop of troll-bone.', glyph: 'ring' },
  { id: 'void-stone', name: 'Void Stone', tier: 'component', cost: 800, passiveMods: { manaRegen: 2.25 }, lore: 'A pebble from nowhere, full of everything.', glyph: 'gem' },
  { id: 'energy-booster', name: 'Energy Booster', tier: 'component', cost: 800, passiveMods: { maxMana: 250 }, lore: 'A crystal that forgot how to be empty.', glyph: 'gem' },
  { id: 'vitality-booster', name: 'Vitality Booster', tier: 'component', cost: 1000, passiveMods: { maxHp: 250 }, lore: 'Warm to the touch, like a second heartbeat.', glyph: 'gem' },
  { id: 'chainmail', name: 'Chainmail', tier: 'component', cost: 550, passiveMods: { armor: 5 }, lore: 'A thousand small refusals.', glyph: 'armor' },
  { id: 'cloak', name: 'Cloak', tier: 'component', cost: 550, passiveMods: { magicResistPct: 20 }, lore: 'Woven against weather and worse.', glyph: 'cloak' },
  { id: 'shadow-amulet', name: 'Shadow Amulet', tier: 'component', cost: 1000, passiveMods: {}, lore: 'It dims the light\u2019s opinion of you.', glyph: 'gem' },
  { id: 'magic-stick', name: 'Magic Stick', tier: 'basic', cost: 200, charges: 0, maxCharges: 10,
    triggers: [{ on: 'on-nearby-enemy-cast', radius: 1200, chargeGain: 1 }],
    consumesAllCharges: true,
    lore: 'It drinks stray magic and shares when squeezed.',
    glyph: 'wand',
    active: {
      id: 'magic-stick-active',
      name: 'Spend Charges',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [13],
      effects: [
        { kind: 'heal', amount: 15, target: 'self', perCharge: true },
        { kind: 'mana', op: 'restore', amount: 15, target: 'self', perCharge: true }
      ],
      vfx: { archetype: 'shield', color: '#c8a0ff', scale: 0.5 }
    }
  }
];

export const ASSEMBLED: ItemDef[] = [
  {
    id: 'bracer', name: 'Bracer', tier: 'basic', cost: 505,
    components: ['gauntlets-of-strength', 'circlet'], recipeCost: 210,
    passiveMods: { str: 5, agi: 2, int: 2, maxHp: 75 },
    lore: 'Strength, buckled on.', glyph: 'band'
  },
  {
    id: 'wraith-band', name: 'Wraith Band', tier: 'basic', cost: 505,
    components: ['slippers-of-agility', 'circlet'], recipeCost: 210,
    passiveMods: { agi: 5, str: 2, int: 2, attackSpeed: 5 },
    lore: 'A ghost\u2019s grip steadies your wrist.', glyph: 'band'
  },
  {
    id: 'null-talisman', name: 'Null Talisman', tier: 'basic', cost: 505,
    components: ['mantle-of-intelligence', 'circlet'], recipeCost: 210,
    passiveMods: { int: 5, str: 2, agi: 2, maxMana: 60 },
    lore: 'A small argument against existence.', glyph: 'gem'
  },
  {
    id: 'magic-wand', name: 'Magic Wand', tier: 'basic', cost: 450,
    components: ['magic-stick', 'iron-branch', 'iron-branch'], recipeCost: 150,
    passiveMods: { str: 2, agi: 2, int: 2 },
    charges: 0, maxCharges: 20,
    triggers: [{ on: 'on-nearby-enemy-cast', radius: 1200, chargeGain: 1 }],
    consumesAllCharges: true,
    lore: 'The stick, promoted.',
    glyph: 'wand',
    active: {
      id: 'magic-wand-active',
      name: 'Spend Charges',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [13],
      effects: [
        { kind: 'heal', amount: 15, target: 'self', perCharge: true },
        { kind: 'mana', op: 'restore', amount: 15, target: 'self', perCharge: true }
      ],
      vfx: { archetype: 'shield', color: '#c8a0ff', scale: 0.5 }
    }
  },
  {
    id: 'arcane-boots', name: 'Arcane Boots', tier: 'basic', cost: 1300,
    components: ['boots-of-speed', 'energy-booster'], recipeCost: 0,
    passiveMods: { moveSpeed: 45, maxMana: 250 },
    lore: 'March on mana.', glyph: 'boot',
    active: {
      id: 'arcane-boots-active',
      name: 'Replenish Mana',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [55],
      effects: [{ kind: 'mana', op: 'restore', amount: 175, target: 'allies-in-radius', radius: 1200 }],
      vfx: { archetype: 'ground-aoe', color: '#86c8ff', scale: 0.8 }
    }
  },
  {
    id: 'blink-dagger', name: 'Blink Dagger', tier: 'core', cost: 2250,
    lore: 'A dagger that cuts distance instead of flesh. It sulks when you bleed.',
    glyph: 'dagger',
    damageLockoutSec: 3,
    active: {
      id: 'blink-active',
      name: 'Blink',
      targeting: 'point-target',
      // castable at any point; the blink effect clamps overshoot to 4/5 of 1200 (Dota rule)
      castRange: 99999,
      castPoint: 0,
      cooldown: [15],
      effects: [{ kind: 'displace', mode: 'blink', target: 'self', toward: 'point', distance: 1200 }],
      vfx: { archetype: 'global-mark', color: '#7adfff', scale: 0.7 }
    }
  },
  {
    id: 'black-king-bar', name: 'Black King Bar', tier: 'core', cost: 3975,
    components: ['ogre-axe', 'mithril-hammer'], recipeCost: 1375,
    passiveMods: { str: 10, damage: 24 },
    lore: 'A bar of dead king\u2019s gold. Spells slide off royalty.',
    glyph: 'bar',
    active: {
      id: 'bkb-active',
      name: 'Avatar',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [75],
      values: { duration: [6] },
      effects: [
        { kind: 'status', status: 'magic-immune', duration: 'duration', target: 'self', params: { basicDispelOnApply: true, tag: 'bkb-avatar' } }
      ],
      vfx: { archetype: 'shield', color: '#ffd27f', color2: '#b8860b', scale: 1 }
    }
  },
  {
    id: 'euls-scepter', name: 'Eul\u2019s Scepter of Divinity', tier: 'core', cost: 2725,
    components: ['staff-of-wizardry', 'void-stone', 'sages-mask'], recipeCost: 750,
    passiveMods: { int: 10, manaRegen: 2.5, moveSpeed: 20 },
    lore: 'The wind obeys whoever holds the scepter, and mocks everyone else.',
    glyph: 'cyclone',
    active: {
      id: 'euls-active',
      name: 'Cyclone',
      targeting: 'unit-target',
      affects: 'any',
      castRange: 575,
      castPoint: 0,
      cooldown: [23],
      manaCost: [175],
      effects: [{ kind: 'status', status: 'cyclone', duration: 2.5, target: 'target' }],
      vfx: { archetype: 'storm', color: '#9fe8e8', color2: '#e8fbff', scale: 0.8 }
    }
  },
  {
    id: 'force-staff', name: 'Force Staff', tier: 'core', cost: 2200,
    components: ['staff-of-wizardry', 'ring-of-regen'], recipeCost: 1025,
    passiveMods: { int: 10, hpRegen: 2.5 },
    lore: 'It pushes. Friend, foe, self \u2014 physics does not take sides.',
    glyph: 'staff',
    active: {
      id: 'force-staff-active',
      name: 'Force',
      targeting: 'unit-target',
      affects: 'any',
      castRange: 750,
      castPoint: 0,
      cooldown: [19],
      manaCost: [100],
      effects: [{ kind: 'displace', mode: 'forced', target: 'target', toward: 'facing', distance: 600, speed: 1500 }],
      vfx: { archetype: 'beam', color: '#9fe85c', scale: 0.8 }
    }
  },
  {
    id: 'glimmer-cape', name: 'Glimmer Cape', tier: 'core', cost: 1950,
    components: ['cloak', 'shadow-amulet'], recipeCost: 400,
    passiveMods: { magicResistPct: 20 },
    lore: 'Woven from dusk. Wrap a friend in it and watch them stop existing.',
    glyph: 'cloak',
    active: {
      id: 'glimmer-active',
      name: 'Glimmer',
      targeting: 'unit-target',
      affects: 'ally',
      castRange: 800,
      castPoint: 0,
      cooldown: [14],
      manaCost: [90],
      effects: [
        { kind: 'status', status: 'invis', duration: 5, target: 'target', params: { fadeTime: 0.6 } },
        { kind: 'statmod', mods: { magicResistPct: 45 }, duration: 5, target: 'target' }
      ],
      vfx: { archetype: 'shield', color: '#b89fff', color2: '#4a3a78', scale: 0.8 }
    }
  },
  {
    id: 'mekansm', name: 'Mekansm', tier: 'core', cost: 1875,
    components: ['chainmail', 'ring-of-regen', 'ring-of-regen'], recipeCost: 975,
    passiveMods: { armor: 5, hpRegen: 3.5 },
    aura: { radius: 1200, affects: 'allies', mods: { hpRegen: 2 } },
    lore: 'A whirring heart of brass that believes in the whole party.',
    glyph: 'gear',
    active: {
      id: 'mekansm-active',
      name: 'Restore',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [65],
      manaCost: [100],
      effects: [{ kind: 'heal', amount: 300, target: 'allies-in-radius', radius: 1200 }],
      vfx: { archetype: 'ground-aoe', color: '#7dffb5', color2: '#e7d9a8', scale: 1 }
    }
  },
  {
    id: 'battlefury', name: 'Battlefury', tier: 'core', cost: 3975,
    components: ['broadsword', 'claymore', 'quarterstaff'], recipeCost: 750,
    passiveMods: { damage: 50, hpRegen: 7.5, manaRegen: 3 },
    attackMod: { cleave: { pct: 60, radius: 600 } },
    lore: 'An axe with opinions about crowds.',
    glyph: 'axe'
  },
  {
    id: 'crystalys', name: 'Crystalys', tier: 'core', cost: 1900,
    components: ['broadsword', 'blades-of-attack'], recipeCost: 450,
    passiveMods: { damage: 32 },
    attackMod: { critChance: 20, critMult: 160 },
    lore: 'A blade of living crystal that sings on the lucky swings.',
    glyph: 'blade'
  },
  {
    id: 'diffusal-blade', name: 'Diffusal Blade', tier: 'core', cost: 2500,
    components: ['blade-of-alacrity', 'blade-of-alacrity'], recipeCost: 500,
    passiveMods: { agi: 20 },
    attackMod: { manaBurnPerHit: 40, manaBurnAsDamagePct: 100 },
    lore: 'It drinks spells out of the blood.',
    glyph: 'blade',
    active: {
      id: 'diffusal-active',
      name: 'Inhibit',
      targeting: 'unit-target',
      affects: 'enemy',
      castRange: 600,
      castPoint: 0,
      cooldown: [15],
      effects: [
        { kind: 'purge', target: 'target' },
        { kind: 'status', status: 'slow', duration: 3, target: 'target', params: { moveSlowPct: 50 } }
      ],
      vfx: { archetype: 'beam', color: '#c8a0ff', color2: '#7a5cc8', scale: 0.7 }
    }
  },
  {
    id: 'maelstrom', name: 'Maelstrom', tier: 'core', cost: 2950,
    components: ['mithril-hammer', 'gloves-of-haste'], recipeCost: 900,
    passiveMods: { damage: 24, attackSpeed: 20 },
    attackMod: { procChance: 30, procDamage: 140 },
    lore: 'A hammer with a storm trapped in the head. It leaks.',
    glyph: 'hammer'
  },
  {
    id: 'drum-of-endurance', name: 'Drum of Endurance', tier: 'basic', cost: 1650,
    components: ['crown', 'sages-mask'], recipeCost: 1025,
    passiveMods: { str: 4, agi: 4, int: 4 },
    aura: { radius: 1200, affects: 'allies', mods: { moveSpeed: 20 } },
    charges: 4,
    lore: 'Its beat keeps tired legs honest.',
    glyph: 'drum',
    active: {
      id: 'drums-active',
      name: 'Endurance',
      targeting: 'no-target',
      castPoint: 0,
      cooldown: [60],
      effects: [
        { kind: 'statmod', mods: { moveSpeedPct: 13, attackSpeed: 45 }, duration: 6, target: 'allies-in-radius', radius: 1200 }
      ],
      vfx: { archetype: 'ground-aoe', color: '#ffb35c', scale: 0.9 }
    }
  },
  {
    id: 'vladmirs-offering', name: 'Vladmir\u2019s Offering', tier: 'core', cost: 2175,
    components: ['ring-of-regen', 'sages-mask', 'blades-of-attack'], recipeCost: 1375,
    passiveMods: { hpRegen: 1.75, manaRegen: 1 },
    aura: { radius: 1200, affects: 'allies', mods: { lifestealPct: 15, damagePct: 12, armor: 3 } },
    lore: 'A fanged chalice that tithes every wound.',
    glyph: 'fang'
  }
];

export const ALL_ITEMS: ItemDef[] = [...CONSUMABLES, ...COMPONENTS, ...ASSEMBLED];
