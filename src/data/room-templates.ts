import type { RegionDef, RoomTemplate, RoomType, Vec2 } from '../core/types';

type Biome = RegionDef['biome'];
type Side = 'n' | 's' | 'e' | 'w';

const ALL_ROOM_TYPES: RoomType[] = ['entrance', 'combat', 'elite', 'treasure', 'shrine', 'rest', 'boss'];
const STANDARD_TYPES: RoomType[] = ['combat', 'elite', 'shrine'];
const VAULT_TYPES: RoomType[] = ['elite', 'treasure', 'boss'];

function connector(side: Side, x: number, y: number): { side: Side; at: Vec2 } {
  return { side, at: { x, y } };
}

function room(
  id: string,
  biome: Biome,
  size: Vec2,
  connectors: { side: Side; at: Vec2 }[],
  spawnAnchors: Vec2[],
  allowTypes: RoomType[] = ALL_ROOM_TYPES,
  props: RoomTemplate['props'] = { treeDensity: 0.05, rockDensity: 0.08 }
): RoomTemplate {
  return { id, biome, size, connectors, spawnAnchors, allowTypes, props };
}

function fourDoor(size: Vec2): { side: Side; at: Vec2 }[] {
  return [
    connector('w', 180, size.y / 2),
    connector('e', size.x - 180, size.y / 2),
    connector('n', size.x / 2, 180),
    connector('s', size.x / 2, size.y - 180)
  ];
}

function lineDoors(size: Vec2): { side: Side; at: Vec2 }[] {
  return [connector('w', 180, size.y / 2), connector('e', size.x - 180, size.y / 2)];
}

function anchors(size: Vec2, spread = 0.22): Vec2[] {
  return [
    { x: size.x * 0.58, y: size.y * 0.34 },
    { x: size.x * 0.72, y: size.y * 0.5 },
    { x: size.x * 0.58, y: size.y * 0.66 },
    { x: size.x * (0.5 + spread), y: size.y * 0.22 },
    { x: size.x * (0.5 + spread), y: size.y * 0.78 }
  ];
}

export const FROST_ROOM_TEMPLATES: RoomTemplate[] = [
  room('frost-entry', 'snow', { x: 3600, y: 2600 }, lineDoors({ x: 3600, y: 2600 }), anchors({ x: 3600, y: 2600 }, 0.16), ['entrance', 'combat', 'rest'], { treeDensity: 0.04, rockDensity: 0.1 }),
  room('frost-crossing', 'snow', { x: 4400, y: 3200 }, fourDoor({ x: 4400, y: 3200 }), anchors({ x: 4400, y: 3200 }), STANDARD_TYPES, { treeDensity: 0.03, rockDensity: 0.12 }),
  room('frost-cache', 'snow', { x: 3900, y: 3000 }, [connector('w', 180, 1500), connector('e', 3720, 1500), connector('n', 1950, 180)], anchors({ x: 3900, y: 3000 }, 0.18), VAULT_TYPES, { treeDensity: 0.02, rockDensity: 0.16 })
];

export const VOID_ROOM_TEMPLATES: RoomTemplate[] = [
  room('void-gate', 'grass', { x: 3700, y: 2700 }, lineDoors({ x: 3700, y: 2700 }), anchors({ x: 3700, y: 2700 }, 0.18), ['entrance', 'combat', 'rest'], { treeDensity: 0.02, rockDensity: 0.07 }),
  room('void-crossing', 'grass', { x: 4600, y: 3100 }, fourDoor({ x: 4600, y: 3100 }), anchors({ x: 4600, y: 3100 }), STANDARD_TYPES, { treeDensity: 0.06, rockDensity: 0.05 }),
  room('void-vault', 'grass', { x: 4100, y: 3300 }, [connector('w', 180, 1650), connector('e', 3920, 1650), connector('s', 2050, 3120)], anchors({ x: 4100, y: 3300 }, 0.2), VAULT_TYPES, { treeDensity: 0.01, rockDensity: 0.12 })
];

export const VAULT_ROOM_TEMPLATES: RoomTemplate[] = [
  room('vault-gate', 'wasteland', { x: 3800, y: 2800 }, lineDoors({ x: 3800, y: 2800 }), anchors({ x: 3800, y: 2800 }, 0.15), ['entrance', 'combat', 'rest'], { treeDensity: 0.01, rockDensity: 0.14 }),
  room('vault-crossing', 'wasteland', { x: 4700, y: 3300 }, fourDoor({ x: 4700, y: 3300 }), anchors({ x: 4700, y: 3300 }), STANDARD_TYPES, { treeDensity: 0.01, rockDensity: 0.18 }),
  room('vault-sanctum', 'wasteland', { x: 4300, y: 3400 }, [connector('w', 180, 1700), connector('e', 4120, 1700), connector('n', 2150, 180)], anchors({ x: 4300, y: 3400 }, 0.2), VAULT_TYPES, { treeDensity: 0, rockDensity: 0.22 })
];

export const EMBER_ROOM_TEMPLATES: RoomTemplate[] = [
  room('ember-gate', 'wasteland', { x: 3900, y: 2850 }, lineDoors({ x: 3900, y: 2850 }), anchors({ x: 3900, y: 2850 }, 0.16), ['entrance', 'combat', 'rest'], { treeDensity: 0, rockDensity: 0.16 }),
  room('ember-crossing', 'wasteland', { x: 4800, y: 3400 }, fourDoor({ x: 4800, y: 3400 }), anchors({ x: 4800, y: 3400 }), STANDARD_TYPES, { treeDensity: 0, rockDensity: 0.2 }),
  room('ember-roost', 'wasteland', { x: 4500, y: 3600 }, [connector('w', 180, 1800), connector('e', 4320, 1800), connector('s', 2250, 3420)], anchors({ x: 4500, y: 3600 }, 0.22), VAULT_TYPES, { treeDensity: 0, rockDensity: 0.24 })
];

export const ALL_ROOM_TEMPLATES: RoomTemplate[] = [
  ...FROST_ROOM_TEMPLATES,
  ...VOID_ROOM_TEMPLATES,
  ...VAULT_ROOM_TEMPLATES,
  ...EMBER_ROOM_TEMPLATES
];
