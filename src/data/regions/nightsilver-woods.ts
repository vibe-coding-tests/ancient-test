import type { RegionDef } from '../../core/types';

export const NIGHTSILVER_WOODS: RegionDef = {
  id: 'nightsilver-woods',
  name: 'Nightsilver Woods',
  biome: 'forest',
  size: 12000,
  seed: 23017,
  lore: 'A moonlit forest where Selemene’s hunters track the Mad Moon shards by the shadows they refuse to cast. The moon-cult reads every bound Echo as an omen: either the Mad Moon is being mourned, or it is being gathered.',
  arrivalBeat: 'arrival-nightsilver-woods',
  town: { name: 'Moonwake', pos: { x: 5600, y: 6500 }, radius: 820 },
  shrine: { pos: { x: 5600, y: 6200 } },
  shopInventory: [
    'tango', 'healing-salve', 'clarity', 'dust-of-appearance',
    'iron-branch', 'circlet', 'slippers-of-agility', 'mantle-of-intelligence',
    'band-of-elvenskin', 'robe-of-the-magi', 'blade-of-alacrity', 'staff-of-wizardry',
    'boots-of-speed', 'gloves-of-haste', 'sages-mask', 'void-stone', 'chainmail',
    'magic-stick', 'wraith-band', 'null-talisman', 'magic-wand', 'yasha', 'kaya',
    'dragon-lance', 'mask-of-madness', 'blink-dagger', 'euls-scepter', 'force-staff',
    'glimmer-cape', 'diffusal-blade', 'maelstrom', 'drum-of-endurance'
  ],
  camps: [
    { id: 'nw-ghost-1', creepId: 'ghost', count: 4, pos: { x: 3500, y: 5200 }, radius: 260, respawnSec: 75 },
    { id: 'nw-ghost-2', creepId: 'ghost', count: 3, pos: { x: 7400, y: 4400 }, radius: 260, respawnSec: 75 },
    { id: 'nw-wolf-1', creepId: 'alpha-wolf', count: 2, pos: { x: 2900, y: 7800 }, radius: 280, respawnSec: 110 },
    { id: 'nw-wolf-2', creepId: 'alpha-wolf', count: 2, pos: { x: 8800, y: 7800 }, radius: 280, respawnSec: 110 },
    { id: 'nw-satyr-1', creepId: 'satyr-banisher', count: 2, pos: { x: 4700, y: 9000 }, radius: 280, respawnSec: 120 },
    { id: 'nw-harpy-1', creepId: 'harpy-stormcrafter', count: 3, pos: { x: 8800, y: 3300 }, radius: 300, respawnSec: 130 }
  ],
  heroSpawns: [
    { heroId: 'luna', pos: { x: 6900, y: 8050 } },
    { heroId: 'mirana', pos: { x: 3800, y: 8500 } },
    { heroId: 'lina', pos: { x: 8300, y: 5600 } },
    { heroId: 'zeus', pos: { x: 9350, y: 7200 } },
    { heroId: 'drow-ranger', pos: { x: 2500, y: 4400 } },
    { heroId: 'bane', pos: { x: 6200, y: 9300 } }
  ],
  echoSpawns: [
    { id: 'nw-echo-luna', heroId: 'luna', pos: { x: 7600, y: 8600 }, level: 12, respawnSec: 180 },
    { id: 'nw-echo-mirana', heroId: 'mirana', pos: { x: 4300, y: 9450 }, level: 12, respawnSec: 180 },
    { id: 'nw-echo-lina', heroId: 'lina', pos: { x: 9100, y: 5200 }, level: 12, respawnSec: 180 },
    { id: 'nw-echo-bane', heroId: 'bane', pos: { x: 6600, y: 9800 }, level: 13, respawnSec: 200 }
  ],
  gates: [
    { id: 'nw-to-tv', name: 'South Pass to Tranquil Vale', pos: { x: 5600, y: 11250 }, radius: 500, toRegionId: 'tranquil-vale', toPos: { x: 6000, y: 1200 } },
    { id: 'nw-to-icewrack', name: 'Frost Road to Icewrack', pos: { x: 10600, y: 1600 }, radius: 500, toRegionId: 'icewrack', toPos: { x: 1600, y: 9800 }, requiredBadge: 'lunar-badge' }
  ],
  gyms: [{ gymId: 'lunar-gym', pos: { x: 6100, y: 3000 }, radius: 650 }],
  elevation: { tiers: [0, 140, 280] },
  climbPoints: [
    { id: 'nw-moonroot-climb', pos: { x: 4300, y: 9000 }, fromTier: 0, toTier: 1 },
    { id: 'nw-high-bough-climb', pos: { x: 8050, y: 7800 }, fromTier: 1, toTier: 2 }
  ],
  glidePoints: [
    { id: 'nw-silver-bough-glide', pos: { x: 8200, y: 7600 }, fromTier: 2 }
  ],
  waterZones: [
    { id: 'nw-moonpool', poly: [{ x: 6900, y: 4700 }, { x: 7700, y: 4550 }, { x: 7850, y: 5200 }, { x: 7050, y: 5350 }], deep: true }
  ],
  waypoints: [
    { id: 'nw-waypoint-moonwake', name: 'Moonwake Waystone', pos: { x: 5800, y: 6500 } },
    { id: 'nw-waypoint-lunar-gym', name: 'Lunar Steps Waystone', pos: { x: 6250, y: 3600 } },
    { id: 'nw-waypoint-silver-bough', name: 'Silver Bough Waystone', pos: { x: 8350, y: 7480 } }
  ],
  chests: [
    { id: 'nw-chest-moonpool-bank', pos: { x: 7600, y: 5400 }, tier: 'rich', loot: { gold: 170, items: ['clarity'] } },
    { id: 'nw-chest-satyr-relic', pos: { x: 4900, y: 9300 }, tier: 'precious', gate: { kind: 'camp', campId: 'nw-satyr-1' }, loot: { gold: 260, items: ['yasha'], shardCount: 1 } },
    { id: 'nw-chest-frozen-bridge', pos: { x: 7320, y: 4940 }, tier: 'luxurious', gate: { kind: 'puzzle', puzzleId: 'nw-freeze-moonpool' }, loot: { gold: 420, items: ['maelstrom'], shardCount: 2 } }
  ],
  shards: [
    { id: 'nw-shard-moonwake', pos: { x: 5400, y: 6020 } },
    { id: 'nw-shard-wolf-den', pos: { x: 3080, y: 8120 } },
    { id: 'nw-shard-silver-bough', pos: { x: 8260, y: 7420 } },
    { id: 'nw-shard-frost-road', pos: { x: 10100, y: 2050 } }
  ],
  discoveries: [
    { id: 'nw-discovery-moonpool', pos: { x: 7000, y: 5200 }, radius: 380, hint: 'Moonwater hardens under frost.', reveals: 'nw-freeze-moonpool' },
    { id: 'nw-discovery-silver-bough', pos: { x: 8000, y: 7850 }, radius: 360, hint: 'A high bough catches the wind toward a hidden waystone.', reveals: 'nw-waypoint-silver-bough' }
  ],
  elementSources: [
    { id: 'nw-cryo-moonstone', pos: { x: 7020, y: 5060 }, radius: 220, element: 'cryo', carriable: true },
    { id: 'nw-hydro-moonpool', pos: { x: 7420, y: 4920 }, radius: 300, element: 'hydro' },
    { id: 'nw-anemo-seed', pos: { x: 8120, y: 7700 }, radius: 230, element: 'anemo', carriable: true }
  ],
  elementPuzzles: [
    {
      id: 'nw-freeze-moonpool',
      kind: 'freeze-platform',
      nodes: [{ x: 7320, y: 4940 }],
      requires: 'cryo',
      radius: 260,
      reveals: 'nw-chest-frozen-bridge'
    }
  ],
  props: { treeDensity: 1.0, rockDensity: 0.25 },
  gateHint: 'The Frost Road opens after the Lunar Badge.'
};
