import { TUNING } from '../data/tuning';
import { clamp } from './math2d';
import type { Attribute, HeroBaseStats, StatModMap } from './types';

/** Final derived combat stats for a unit, recomputed each tick. */
export interface DerivedStats {
  str: number; agi: number; int: number;
  maxHp: number;
  maxMana: number;
  hpRegen: number;
  manaRegen: number;
  damage: number;            // average attack damage before variance
  armor: number;
  magicResistPct: number;
  spellAmpPct: number;
  statusResistPct: number;
  attackInterval: number;    // seconds between attacks
  attackPoint: number;
  attackRange: number;
  moveSpeed: number;
  evasionPct: number;
  lifestealPct: number;
  castRangeBonus: number;
  hpRegenPctMax: number;
  damageTakenReductionPct: number;
  attackDamageTakenReductionPct: number;
}

export interface StatInputs {
  attribute: Attribute;
  base: HeroBaseStats;
  level: number;
  mods: Record<string, number>;   // aggregated from items, statuses, auras, talents, facets, stacks
  moveSlowFactor: number;
  attackSlowTotal: number;
  msOverride: number | null;
}

const M = (mods: Record<string, number>, k: keyof StatModMap): number => mods[k as string] ?? 0;

/** Dota-style armor multiplier on physical damage taken. */
export function armorMultiplier(armor: number): number {
  const red = (TUNING.armorFactor * armor) / (1 + TUNING.armorFactor * Math.abs(armor));
  return 1 - red;
}

export function deriveStats(inp: StatInputs): DerivedStats {
  const { base, mods } = inp;
  const lvl = Math.max(1, inp.level);
  const str = base.str + base.strGain * (lvl - 1) + M(mods, 'str');
  const agi = base.agi + base.agiGain * (lvl - 1) + M(mods, 'agi');
  const int = base.int + base.intGain * (lvl - 1) + M(mods, 'int');

  let primaryDamage: number;
  switch (inp.attribute) {
    case 'str': primaryDamage = str * TUNING.damagePerPrimary; break;
    case 'agi': primaryDamage = agi * TUNING.damagePerPrimary; break;
    case 'int': primaryDamage = int * TUNING.damagePerPrimary; break;
    case 'uni': primaryDamage = (str + agi + int) * TUNING.universalDamagePerStat; break;
  }

  const damageFlat = base.baseDamage + primaryDamage + M(mods, 'damage');
  const damage = damageFlat * (1 + M(mods, 'damagePct') / 100) * TUNING.damageScale;

  const maxHp = TUNING.baseHp + str * TUNING.hpPerStr + M(mods, 'maxHp');
  const maxMana = TUNING.baseMana + int * TUNING.manaPerInt + M(mods, 'maxMana');

  const ias = clamp(agi * TUNING.attackSpeedPerAgi + M(mods, 'attackSpeed') - inp.attackSlowTotal, -80, 500);
  const attackInterval = base.baseAttackTime / (1 + ias / 100);

  let moveSpeed = (base.moveSpeed + M(mods, 'moveSpeed')) * (1 + M(mods, 'moveSpeedPct') / 100);
  moveSpeed *= inp.moveSlowFactor;
  if (inp.msOverride !== null) moveSpeed = inp.msOverride;
  moveSpeed = clamp(moveSpeed * TUNING.speedScale, 100, 650);

  return {
    str, agi, int,
    maxHp,
    maxMana,
    hpRegen: base.hpRegen + str * TUNING.hpRegenPerStr + M(mods, 'hpRegen'),
    manaRegen: base.manaRegen + int * TUNING.manaRegenPerInt + M(mods, 'manaRegen'),
    damage,
    armor: base.baseArmor + agi * TUNING.armorPerAgi + M(mods, 'armor'),
    magicResistPct: clamp(TUNING.baseMagicResist + M(mods, 'magicResistPct'), 0, 85),
    spellAmpPct: M(mods, 'spellAmpPct'),
    statusResistPct: clamp(M(mods, 'statusResistPct'), 0, 80),
    attackInterval,
    attackPoint: base.attackPoint,
    attackRange: (base.attackRange + M(mods, 'attackRange')) * TUNING.rangeScale,
    moveSpeed,
    evasionPct: clamp(M(mods, 'evasionPct'), 0, 95),
    lifestealPct: M(mods, 'lifestealPct'),
    castRangeBonus: M(mods, 'castRange'),
    hpRegenPctMax: M(mods, 'hpRegenPctMax'),
    damageTakenReductionPct: clamp(M(mods, 'damageTakenReductionPct'), -100, 90),
    attackDamageTakenReductionPct: clamp(M(mods, 'attackDamageTakenReductionPct'), 0, 95)
  };
}

export function xpForLevel(level: number): number {
  const c = TUNING.xpCurve;
  if (level <= 1) return 0;
  if (level - 1 < c.length) return c[level - 1];
  return c[c.length - 1] + (level - c.length) * 4000;
}

export function levelFromXp(xp: number): number {
  let lvl = 1;
  while (lvl < TUNING.levelCap && xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}
