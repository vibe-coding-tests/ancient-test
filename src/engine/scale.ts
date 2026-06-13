// Sim runs in raw Dota units; the renderer divides by WORLD_SCALE (DECISIONS).
export const WORLD_SCALE = 100;

export const toWorld = (v: number): number => v / WORLD_SCALE;

/** Sim (x, y) plane maps to three.js (x, z); y-up. */
export function simToWorld(x: number, y: number): { x: number; z: number } {
  return { x: x / WORLD_SCALE, z: y / WORLD_SCALE };
}
