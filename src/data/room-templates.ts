import { capsuleBody, circleBody } from '../core/collision';
import type { CollisionBody, CollisionLayer, DungeonDoorBody, RegionDef, RoomCollisionBody, RoomTemplate, RoomType, Vec2 } from '../core/types';

type Biome = RegionDef['biome'];
type Side = 'n' | 's' | 'e' | 'w';

const ALL_ROOM_TYPES: RoomType[] = ['entrance', 'combat', 'elite', 'treasure', 'shrine', 'rest', 'boss'];
const STANDARD_TYPES: RoomType[] = ['combat', 'elite', 'shrine'];
const VAULT_TYPES: RoomType[] = ['elite', 'treasure', 'boss'];
const WALL_RADIUS = 55;
const DOOR_CLEAR_WIDTH = 680;

function connector(side: Side, x: number, y: number): { side: Side; at: Vec2 } {
  return { side, at: { x, y } };
}

function roomBody(id: string, pos: Vec2, radius: number, layer: CollisionLayer, blocksMovement: boolean, label: string): RoomCollisionBody {
  return {
    id,
    pos,
    source: 'data/room-templates',
    body: circleBody(radius, {
      layer,
      blocksMovement,
      blocksProjectiles: blocksMovement,
      blocksVision: blocksMovement,
      feedback: { stopSound: blocksMovement ? 'stone' : 'magic', impactVfx: blocksMovement ? 'dust' : 'spark', label }
    })
  };
}

function shapedRoomBody(id: string, pos: Vec2, body: CollisionBody): RoomCollisionBody {
  return {
    id,
    pos,
    source: 'data/room-templates',
    body
  };
}

function capsuleRoomBody(
  id: string,
  pos: Vec2,
  halfLength: number,
  radius: number,
  angle: number,
  layer: CollisionLayer,
  blocksMovement: boolean,
  label: string
): RoomCollisionBody {
  const body = capsuleBody(halfLength, radius, {
    layer,
    blocksMovement,
    blocksProjectiles: blocksMovement,
    blocksVision: blocksMovement,
    feedback: { stopSound: blocksMovement ? 'stone' : 'magic', impactVfx: blocksMovement ? 'dust' : 'spark', label }
  });
  if (body.shape.kind === 'capsule') body.shape.angle = angle;
  return shapedRoomBody(id, pos, body);
}

function defaultBlockers(id: string, size: Vec2): RoomCollisionBody[] {
  return [
    roomBody(`${id}:pillar-west`, { x: size.x * 0.42, y: size.y * 0.5 }, 105, 'static', true, 'Dungeon pillar'),
    roomBody(`${id}:pillar-east`, { x: size.x * 0.56, y: size.y * 0.5 }, 95, 'static', true, 'Dungeon pillar')
  ];
}

function sideWallSegments(id: string, size: Vec2, side: Side, connectors: { side: Side; at: Vec2 }[]): RoomCollisionBody[] {
  const horizontal = side === 'n' || side === 's';
  const length = horizontal ? size.x : size.y;
  const fixed = side === 'n' ? WALL_RADIUS : side === 's' ? size.y - WALL_RADIUS : side === 'w' ? WALL_RADIUS : size.x - WALL_RADIUS;
  const openings = connectors
    .filter((c) => c.side === side)
    .map((c) => horizontal ? c.at.x : c.at.y)
    .sort((a, b) => a - b);
  const segments: RoomCollisionBody[] = [];
  let cursor = 0;
  let idx = 0;
  const pushSegment = (a: number, b: number): void => {
    const span = b - a;
    if (span < 320) return;
    const center = (a + b) / 2;
    const pos = horizontal ? { x: center, y: fixed } : { x: fixed, y: center };
    segments.push(capsuleRoomBody(
      `${id}:wall-${side}-${idx++}`,
      pos,
      span / 2,
      WALL_RADIUS,
      horizontal ? 0 : Math.PI / 2,
      'wall',
      true,
      'Dungeon wall'
    ));
  };
  for (const opening of openings) {
    pushSegment(cursor, Math.max(cursor, opening - DOOR_CLEAR_WIDTH / 2));
    cursor = Math.min(length, opening + DOOR_CLEAR_WIDTH / 2);
  }
  pushSegment(cursor, length);
  return segments;
}

function roomWalls(id: string, size: Vec2, connectors: { side: Side; at: Vec2 }[]): RoomCollisionBody[] {
  return (['n', 's', 'e', 'w'] as Side[]).flatMap((side) => sideWallSegments(id, size, side, connectors));
}

function roomDoors(id: string, connectors: { side: Side; at: Vec2 }[]): DungeonDoorBody[] {
  return connectors.map((c, i) => {
    const horizontal = c.side === 'n' || c.side === 's';
    const body = capsuleRoomBody(
      `${id}:door-${i}`,
      c.at,
      DOOR_CLEAR_WIDTH / 2,
      WALL_RADIUS,
      horizontal ? 0 : Math.PI / 2,
      'door',
      true,
      'Dungeon door'
    );
    const openBody = capsuleRoomBody(
      `${id}:door-${i}:open`,
      c.at,
      DOOR_CLEAR_WIDTH / 2,
      WALL_RADIUS,
      horizontal ? 0 : Math.PI / 2,
      'trigger',
      false,
      'Open doorway'
    );
    return {
      id: `${id}:door-${i}`,
      connectorIndex: i,
      body,
      openBody,
      clearWidth: DOOR_CLEAR_WIDTH
    };
  });
}

function connectorNoSpawnZones(id: string, connectors: { side: Side; at: Vec2 }[]): RoomCollisionBody[] {
  return connectors.map((c, i) => roomBody(`${id}:door-clear-${i}`, c.at, 300, 'trigger', false, 'Door clear space'));
}

function entranceSafeZone(id: string, size: Vec2): RoomCollisionBody[] {
  return [roomBody(`${id}:entrance-safe`, { x: Math.max(420, size.x * 0.18), y: size.y / 2 }, 420, 'trigger', false, 'Entrance safe zone')];
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
  return {
    id,
    biome,
    size,
    connectors,
    spawnAnchors,
    walls: roomWalls(id, size, connectors),
    blockers: defaultBlockers(id, size),
    doors: roomDoors(id, connectors),
    noSpawnZones: connectorNoSpawnZones(id, connectors),
    safeZones: entranceSafeZone(id, size),
    allowTypes,
    props
  };
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
