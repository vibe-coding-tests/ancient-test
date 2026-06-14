import type { Vec2 } from './types';

export const DUNGEON_PACK_RING_RADIUS = 115;

export function dungeonPackSpawnPositions(center: Vec2, count: number, ringRadius = DUNGEON_PACK_RING_RADIUS): Vec2[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * ringRadius,
      y: center.y + Math.sin(angle) * ringRadius
    };
  });
}
