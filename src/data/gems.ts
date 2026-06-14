import type { ItemGrade, StatModMap } from '../core/types';

export type GemGrade = 'chipped' | 'flawed' | 'standard' | 'flawless' | 'perfect';
export type GemKind = 'ruby' | 'topaz' | 'sapphire' | 'emerald' | 'diamond';

export interface GemDef {
  id: string;
  name: string;
  kind: GemKind;
  grade: GemGrade;
  mods: StatModMap;
}

export const GEM_GRADES: GemGrade[] = ['chipped', 'flawed', 'standard', 'flawless', 'perfect'];
const GRADE_MULT: Record<GemGrade, number> = { chipped: 1, flawed: 1.7, standard: 2.5, flawless: 3.5, perfect: 5 };

const BASE_GEMS: Record<GemKind, { name: string; mods: StatModMap }> = {
  ruby: { name: 'Ruby', mods: { maxHp: 45 } },
  topaz: { name: 'Topaz', mods: { damage: 4 } },
  sapphire: { name: 'Sapphire', mods: { maxMana: 55 } },
  emerald: { name: 'Emerald', mods: { armor: 1.5 } },
  diamond: { name: 'Diamond', mods: { str: 1.5, agi: 1.5, int: 1.5 } }
};

function scaleMods(mods: StatModMap, mult: number): StatModMap {
  const out: StatModMap = {};
  for (const [key, value] of Object.entries(mods) as [keyof StatModMap, number][]) {
    out[key] = Math.round(value * mult * 10) / 10;
  }
  return out;
}

export const GEM_DEFS: GemDef[] = Object.entries(BASE_GEMS).flatMap(([kind, base]) =>
  GEM_GRADES.map((grade) => ({
    id: `${grade}-${kind}`,
    name: `${grade[0].toUpperCase() + grade.slice(1)} ${base.name}`,
    kind: kind as GemKind,
    grade,
    mods: scaleMods(base.mods, GRADE_MULT[grade])
  }))
);

const GEMS = new Map(GEM_DEFS.map((gem) => [gem.id, gem]));

export function gemDef(id: string): GemDef | undefined {
  return GEMS.get(id);
}

export function isGemId(id: string): boolean {
  return GEMS.has(id);
}

export function gemMods(id: string | null): StatModMap {
  return id ? { ...(GEMS.get(id)?.mods ?? {}) } : {};
}

export function socketsForDrop(grade: ItemGrade, socketCap: number, roll: number): (string | null)[] {
  if (socketCap <= 0) return [];
  const chance = grade === 'pristine' ? 0.6 : grade === 'refined' ? 0.35 : grade === 'sharp' ? 0.15 : 0;
  if (roll >= chance) return [];
  const count = grade === 'pristine' && socketCap >= 2 && roll < chance * 0.35 ? 2 : 1;
  return new Array(Math.min(socketCap, count)).fill(null);
}

export function fuseGems(ids: string[]): GemDef | null {
  if (ids.length !== 3) return null;
  const gems = ids.map((id) => GEMS.get(id));
  if (gems.some((gem) => !gem)) return null;
  const [first] = gems as GemDef[];
  if (!gems.every((gem) => gem!.kind === first.kind && gem!.grade === first.grade)) return null;
  const nextGrade = GEM_GRADES[GEM_GRADES.indexOf(first.grade) + 1];
  return nextGrade ? GEMS.get(`${nextGrade}-${first.kind}`) ?? null : null;
}
