import type { AbilityDef, ValueRef } from './types';

/** Resolve a ValueRef against an ability's per-level values table. */
export function resolveVal(
  ref: ValueRef | undefined,
  values: Record<string, number[]> | undefined,
  level: number,
  fallback = 0
): number {
  if (ref === undefined) return fallback;
  if (typeof ref === 'number') return ref;
  const arr = values?.[ref];
  if (!arr || arr.length === 0) return fallback;
  const idx = Math.max(0, Math.min(arr.length - 1, level - 1));
  return arr[idx];
}

export function abilityVal(def: AbilityDef, ref: ValueRef | undefined, level: number, fallback = 0): number {
  return resolveVal(ref, def.values, level, fallback);
}

export function levelArr(arr: number[] | undefined, level: number, fallback = 0): number {
  if (!arr || arr.length === 0) return fallback;
  return arr[Math.max(0, Math.min(arr.length - 1, level - 1))];
}

export function abilityMaxLevel(def: AbilityDef): number {
  return def.maxLevel ?? (def.ult ? 3 : 4);
}
