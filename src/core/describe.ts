// ============================================================
// ANCIENTS description layer.
// Turns the closed effect/stat vocabulary (types.ts) into the
// human-facing tooltip card: a flavor blurb, a plain-language
// "what it does" summary, the numeric stats, and meta chips.
// DOM-free: the HUD renders the returned TooltipCard; tests and
// the codex consume the same structured data.
// ============================================================

import type {
  AbilityDef, AttackModSpec, AuraSpec, EffectNode, HeroDef, ItemDef, NeutralItemDef,
  StatModMap, StatusId, TriggerEvent, TriggerSpec, ValueRef, ZoneSpec
} from './types';

export interface TooltipCard {
  name: string;
  /** Short type label: "Ultimate", "Passive", "Active", rarity/tier label, etc. */
  kind: string;
  /** Flavor blurb (lore). */
  blurb?: string;
  /** "What it does" — one or more plain-language sentences. */
  effect: string[];
  /** Numeric stat lines (e.g. "+5 STR"). */
  stats: string[];
  /** Compact chips: cooldown / mana / range / cost / charges. */
  meta: string[];
}

// ---------- Stat labels & formatting (shared with the HUD) ----------

export const STAT_LABELS: Partial<Record<keyof StatModMap, string>> = {
  str: 'STR',
  agi: 'AGI',
  int: 'INT',
  damage: 'Damage',
  damagePct: 'Damage',
  armor: 'Armor',
  attackSpeed: 'Attack speed',
  moveSpeed: 'Move speed',
  moveSpeedPct: 'Move speed',
  hpRegen: 'HP regen',
  manaRegen: 'Mana regen',
  manaRegenPctMax: 'Mana % regen',
  maxHp: 'Max HP',
  maxMana: 'Max mana',
  magicResistPct: 'Magic resist',
  spellAmpPct: 'Spell amp',
  statusResistPct: 'Status resist',
  evasionPct: 'Evasion',
  lifestealPct: 'Lifesteal',
  attackRange: 'Attack range',
  hpRegenPctMax: 'HP % regen',
  damageTakenReductionPct: 'Damage taken',
  attackDamageTakenReductionPct: 'Attack damage taken',
  castRange: 'Cast range',
  visionPct: 'Vision',
  swapCdReductionPct: 'Swap CD',
  swapInDamagePct: 'Swap-in damage',
  swapInHealPct: 'Swap-in heal',
  tagBoonAmpPct: 'Tag boon amp',
  tagGaugeReductionPct: 'Tag gauge CD',
  tagChainWindowBonusSec: 'Tag chain window',
  reactionAmpPct: 'Reaction amp',
  elementalGaugeSec: 'Element gauge',
  staminaBonus: 'Stamina'
};

export function statLabel(key: keyof StatModMap): string {
  return STAT_LABELS[key] ?? key;
}

export function fmtStatValue(key: keyof StatModMap, value: number, signed = true): string {
  const sign = signed && value > 0 ? '+' : '';
  const pct = key.toLowerCase().includes('pct') ? '%' : '';
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${sign}${rounded}${pct}`;
}

export function statLines(mods: StatModMap, limit = 6): string[] {
  return (Object.entries(mods) as [keyof StatModMap, number][])
    .filter(([, value]) => Math.abs(value) > 0.0001)
    .sort(([a], [b]) => statLabel(a).localeCompare(statLabel(b)))
    .slice(0, limit)
    .map(([key, value]) => `${fmtStatValue(key, value)} ${statLabel(key)}`);
}

// ---------- Number / value-ref helpers ----------

function num(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
  return String(rounded);
}

/** Resolve a ValueRef to a single number at a given level (level 1 / first entry when omitted). */
function refNum(def: AbilityDef, ref: ValueRef | undefined, level?: number): number {
  if (ref === undefined) return 0;
  if (typeof ref === 'number') return ref;
  const arr = def.values?.[ref];
  if (!arr || arr.length === 0) return 0;
  if (level && level > 0) return arr[Math.min(arr.length - 1, level - 1)];
  return arr[0];
}

/** Render a ValueRef as a display string. With no level and a varying per-level table, joins "a/b/c". */
function refStr(def: AbilityDef, ref: ValueRef | undefined, level?: number): string {
  if (ref === undefined) return '';
  if (typeof ref === 'number') return num(ref);
  const arr = def.values?.[ref];
  if (!arr || arr.length === 0) return ref;
  if (level && level > 0) return num(arr[Math.min(arr.length - 1, level - 1)]);
  const uniq = [...new Set(arr)];
  return uniq.length === 1 ? num(uniq[0]) : arr.map(num).join('/');
}

function arrChip(label: string, arr: number[] | undefined, level: number | undefined, suffix = ''): string | null {
  if (!arr || arr.length === 0) return null;
  const uniq = [...new Set(arr)];
  const s = level && level > 0 ? num(arr[Math.min(arr.length - 1, level - 1)]) : uniq.length === 1 ? num(uniq[0]) : arr.map(num).join('/');
  return `${label} ${s}${suffix}`;
}

function cap(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

function resolveMods(def: AbilityDef, mods: Record<string, ValueRef> | undefined, level?: number): StatModMap {
  const out: StatModMap = {};
  for (const [key, ref] of Object.entries(mods ?? {})) {
    out[key as keyof StatModMap] = refNum(def, ref, level);
  }
  return out;
}

// Boolean "flag" mods that read as adjectives, not numbers.
const FLAG_KEYS: Record<string, string> = {
  untargetable: 'untargetable',
  invulnerable: 'invulnerable',
  magicImmune: 'spell-immune',
  rooted: 'rooted',
  ethereal: 'ethereal'
};

/** Split a mod map into flag adjectives and numeric stat lines. */
function modText(def: AbilityDef, mods: Record<string, ValueRef> | undefined, level?: number): { flags: string[]; stats: string[] } {
  const resolved: StatModMap = {};
  const flags: string[] = [];
  for (const [key, ref] of Object.entries(mods ?? {})) {
    const value = refNum(def, ref, level);
    if (FLAG_KEYS[key]) {
      if (value) flags.push(FLAG_KEYS[key]);
    } else {
      resolved[key as keyof StatModMap] = value;
    }
  }
  return { flags, stats: statLines(resolved, 6) };
}

// ---------- Effect → text ----------

const STATUS_VERB: Record<StatusId, string> = {
  stun: 'stuns',
  root: 'roots',
  silence: 'silences',
  hex: 'hexes',
  slow: 'slows',
  disarm: 'disarms',
  blind: 'blinds',
  fear: 'fears',
  taunt: 'taunts',
  invis: 'turns invisible',
  'magic-immune': 'becomes spell-immune',
  break: 'breaks the passives of',
  cyclone: 'cyclones',
  sleep: 'puts to sleep',
  frozen: 'freezes',
  buff: 'affects'
};

function targetPhrase(def: AbilityDef, target: string, radius: ValueRef | undefined, level?: number): string {
  const rad = radius !== undefined ? refStr(def, radius, level) : '';
  switch (target) {
    case 'self': return 'you';
    case 'target': return 'the target';
    case 'point': return 'the area';
    case 'enemies-in-radius': return rad ? `enemies within ${rad}` : 'nearby enemies';
    case 'allies-in-radius': return rad ? `allies within ${rad}` : 'nearby allies';
    case 'units-in-radius': return rad ? `units within ${rad}` : 'nearby units';
    case 'random-enemy-in-radius': return 'a random nearby enemy';
    case 'lowest-hp-ally-in-radius': return 'the lowest-health nearby ally';
    default: return 'the target';
  }
}

function describeNode(def: AbilityDef, node: EffectNode, level?: number): string {
  switch (node.kind) {
    case 'damage': {
      const amount = refStr(def, node.amount, level);
      const tgt = targetPhrase(def, node.target, node.radius, level);
      let s = `deals ${amount} ${node.dtype} damage to ${tgt}`;
      if (node.perUnitBonus !== undefined) s += ` (plus ${refStr(def, node.perUnitBonus, level)} per enemy in range)`;
      if (node.attackDamagePct !== undefined) s += ` plus ${refStr(def, node.attackDamagePct, level)}% of attack damage`;
      return s;
    }
    case 'heal': {
      const amount = refStr(def, node.amount, level);
      const tgt = targetPhrase(def, node.target, node.radius, level);
      return `restores ${amount}${node.pctMaxHp ? '% max' : ''} health to ${tgt}`;
    }
    case 'mana': {
      const amount = refStr(def, node.amount, level);
      const tgt = targetPhrase(def, node.target, node.radius, level);
      let s = node.op === 'burn' ? `burns ${amount} mana from ${tgt}` : `restores ${amount} mana to ${tgt}`;
      if (node.burnedAsDamagePct) s += `, dealing ${node.burnedAsDamagePct}% of it as damage`;
      return s;
    }
    case 'status': {
      const dur = refStr(def, node.duration, level);
      const tgt = targetPhrase(def, node.target, node.radius, level);
      if (node.status === 'buff') return describeBuff(def, node, level, tgt, dur);
      if (node.status === 'slow') {
        const move = node.params?.moveSlowPct !== undefined ? `${refStr(def, node.params.moveSlowPct, level)}%` : '';
        const atk = node.params?.attackSlowPct !== undefined ? `${refStr(def, node.params.attackSlowPct, level)}% attack` : '';
        const by = [move, atk].filter(Boolean).join(' / ');
        return `slows ${tgt}${by ? ` by ${by}` : ''}${dur ? ` for ${dur}s` : ''}`;
      }
      const isSelf = node.target === 'self';
      const forDur = dur ? ` for ${dur}s` : '';
      if (node.status === 'invis') {
        return isSelf ? `grants invisibility${forDur}` : `turns ${tgt} invisible${forDur}`;
      }
      if (node.status === 'magic-immune') {
        return isSelf
          ? `grants spell immunity (blocks magic, not physical)${forDur}`
          : `makes ${tgt} spell-immune (blocks magic, not physical)${forDur}`;
      }
      return `${STATUS_VERB[node.status]} ${tgt}${forDur}`;
    }
    case 'displace': {
      const dist = node.distance !== undefined ? refStr(def, node.distance, level) : '';
      const tgt = targetPhrase(def, node.target, node.radius, level);
      switch (node.mode) {
        case 'blink': {
          if (!dist) {
            const dest = node.toward === 'target-unit' ? 'to the target' : node.toward === 'point' ? 'to the target point' : 'a short distance';
            return `teleports ${tgt} ${dest}`;
          }
          return `teleports ${tgt} up to ${dist} units`;
        }
        case 'knockback': return `knocks back ${tgt}${dist ? ` ${dist} units` : ''}`;
        case 'pull': return `pulls ${tgt}${dist ? ` ${dist} units` : ''}`;
        case 'forced': return `force-moves ${tgt}${dist ? ` ${dist} units` : ''}`;
        default: return `displaces ${tgt}`;
      }
    }
    case 'zone': return describeZone(def, node.zone, level);
    case 'summon': {
      const count = node.count !== undefined ? refStr(def, node.count, level) : '1';
      const life = refStr(def, node.summon.lifetime, level);
      return `summons ${count} ${node.summon.name}${life ? ` for ${life}s` : ''}`;
    }
    case 'statmod': {
      const { flags, stats } = modText(def, node.mods, level);
      const dur = refStr(def, node.duration, level);
      const forDur = dur ? ` for ${dur}s` : '';
      const isSelf = node.target === 'self';
      const tgt = targetPhrase(def, node.target, node.radius, level);
      const statTxt = stats.join(', ');
      if (isSelf) {
        if (flags.length > 0 && stats.length > 0) return `you become ${flags.join(' and ')} and gain ${statTxt}${forDur}`;
        if (flags.length > 0) return `you become ${flags.join(' and ')}${forDur}`;
        return `grants you ${statTxt || 'a bonus'}${forDur}`;
      }
      const flagTxt = flags.length > 0 ? `, making them ${flags.join(' and ')}` : '';
      return `applies ${statTxt || 'a buff'} to ${tgt}${flagTxt}${forDur}`;
    }
    case 'projectile': {
      const onHit = node.proj.onHit.map((n) => describeNode(def, n, level)).join(' and ');
      return `launches a projectile that ${onHit || 'strikes its target'}`;
    }
    case 'repeat': {
      const inner = node.effects.map((n) => describeNode(def, n, level)).join(' and ');
      return `repeats ${refStr(def, node.count, level)} times every ${node.interval}s: ${inner}`;
    }
    case 'purge': return `purges ${targetPhrase(def, node.target, undefined, level)}`;
    case 'capture-channel': return 'channels to bind the target creep';
    case 'exotic': return 'triggers a special effect';
    default: return '';
  }
}

function describeBuff(def: AbilityDef, node: Extract<EffectNode, { kind: 'status' }>, level: number | undefined, tgt: string, dur: string): string {
  const parts: string[] = [];
  const p = node.params;
  if (p?.mods) {
    const { flags, stats } = modText(def, p.mods, level);
    if (stats.length > 0) parts.push(stats.join(', '));
    if (flags.length > 0) parts.push(flags.join(' and '));
  }
  if (p?.attackMod) parts.push(describeAttackMod(def, p.attackMod, level));
  if (p?.dotDps !== undefined) parts.push(`${refStr(def, p.dotDps, level)} ${p.dotType ?? 'magical'} damage per second`);
  if (p?.moveSlowPct !== undefined) parts.push(`${refStr(def, p.moveSlowPct, level)}% slow`);
  const body = parts.filter(Boolean).join('; ');
  const isSelf = node.target === 'self';
  const lead = isSelf ? 'grants you' : `applies to ${tgt}`;
  return `${lead}${body ? ` ${body}` : ' a buff'}${dur ? ` for ${dur}s` : ''}`;
}

const STATUS_PASSIVE: Partial<Record<StatusId, string>> = {
  stun: 'stunned',
  root: 'rooted',
  silence: 'silenced',
  hex: 'hexed',
  disarm: 'disarmed',
  blind: 'blinded',
  fear: 'feared',
  taunt: 'taunted',
  break: 'broken',
  sleep: 'put to sleep',
  frozen: 'frozen'
};

/** Describe an effect from the victim's perspective ("enemies ... take/are ..."). */
function describeVictimEffect(def: AbilityDef, node: EffectNode, level?: number): string {
  if (node.kind === 'damage') return `take ${refStr(def, node.amount, level)} ${node.dtype} damage`;
  if (node.kind === 'status') {
    const dur = refStr(def, node.duration, level);
    if (node.status === 'slow') {
      const move = node.params?.moveSlowPct !== undefined ? `${refStr(def, node.params.moveSlowPct, level)}%` : '';
      return `are slowed${move ? ` by ${move}` : ''}${dur ? ` for ${dur}s` : ''}`;
    }
    const passive = STATUS_PASSIVE[node.status];
    if (passive) return `are ${passive}${dur ? ` for ${dur}s` : ''}`;
  }
  return describeNode(def, node, level);
}

function describeZone(def: AbilityDef, zone: ZoneSpec, level?: number): string {
  const dur = refStr(def, zone.duration, level);
  const durTxt = dur ? ` for ${dur}s` : '';
  const parts: string[] = [];
  if (zone.wall) parts.push(`raises an impassable ${zone.shape === 'line' ? 'wall' : 'barrier'}${durTxt}`);
  else parts.push(`creates a ${zone.shape === 'line' ? 'line' : 'zone'}${durTxt}`);
  if (zone.onEnter) {
    const inner = zone.onEnter.effects.map((n) => describeVictimEffect(def, n, level)).join(' and ');
    if (inner) parts.push(`${zone.onEnter.affects} entering it ${inner}`);
  }
  if (zone.tick) {
    const inner = zone.tick.effects.map((n) => describeNode(def, n, level)).join(' and ');
    if (inner) parts.push(`every ${zone.tick.interval}s it ${inner}`);
  }
  if (zone.auraMods) {
    const lines = statLines(resolveMods(def, zone.auraMods.mods, level), 4).join(', ');
    if (lines) parts.push(`grants ${lines} to ${zone.auraMods.affects}`);
  }
  return parts.join('; ');
}

function describeAttackMod(def: AbilityDef, mod: AttackModSpec, level?: number): string {
  const parts: string[] = [];
  if (mod.critChance !== undefined) parts.push(`${refStr(def, mod.critChance, level)}% chance to crit for ${refStr(def, mod.critMult, level)}%`);
  if (mod.procChance !== undefined && mod.procDamage !== undefined) parts.push(`${refStr(def, mod.procChance, level)}% chance to deal ${refStr(def, mod.procDamage, level)} bonus magic damage`);
  if (mod.bonusDamage !== undefined) parts.push(`+${refStr(def, mod.bonusDamage, level)} attack damage`);
  if (mod.bonusDamagePct !== undefined) parts.push(`+${refStr(def, mod.bonusDamagePct, level)}% attack damage`);
  if (mod.lifestealPct !== undefined) parts.push(`${refStr(def, mod.lifestealPct, level)}% lifesteal`);
  if (mod.cleave) parts.push(`cleaves ${refStr(def, mod.cleave.pct, level)}% in a ${refStr(def, mod.cleave.radius, level)} radius`);
  if (mod.manaBurnPerHit !== undefined) {
    const asDmg = mod.manaBurnAsDamagePct ? `, dealing ${mod.manaBurnAsDamagePct}% as damage` : '';
    parts.push(`burns ${refStr(def, mod.manaBurnPerHit, level)} mana per hit${asDmg}`);
  }
  return parts.join('; ');
}

const TRIGGER_LEAD: Record<TriggerEvent, string> = {
  'on-cast': 'When you cast a spell',
  'on-damage-taken': 'When you take damage',
  'on-attack-land': 'On attack',
  'on-kill': 'On kill',
  'on-nearby-death': 'When a nearby unit dies',
  'on-nearby-enemy-cast': 'When a nearby enemy casts'
};

function describeTrigger(def: AbilityDef, trig: TriggerSpec, level?: number): string {
  const lead = TRIGGER_LEAD[trig.on] ?? 'On trigger';
  const parts: string[] = [];
  if (trig.effects && trig.effects.length > 0) parts.push(trig.effects.map((n) => describeNode(def, n, level)).join(' and '));
  if (trig.statStack) {
    const lines = statLines(resolveMods(def, trig.statStack.mods, level), 4).join(', ');
    parts.push(`permanently gains ${lines}${trig.statStack.max ? ` (max ${trig.statStack.max} stacks)` : ''}`);
  }
  if (trig.chargeGain) parts.push(`gains ${trig.chargeGain} charge${trig.chargeGain === 1 ? '' : 's'}`);
  const body = parts.filter(Boolean).join(', ');
  return body ? `${lead}, ${body}.` : '';
}

function describeAura(def: AbilityDef, aura: AuraSpec): string {
  const { flags, stats } = modText(def, aura.mods);
  const granted = [...stats, ...flags].join(', ');
  const where = aura.radius === 'global'
    ? aura.affects === 'allies' ? 'all allies' : 'all enemies'
    : `${aura.affects} within ${aura.radius}`;
  return `Aura: grants ${granted || 'a bonus'} to ${where}.`;
}

// ---------- Channel / toggle ----------

function describeChannel(def: AbilityDef, channel: NonNullable<AbilityDef['channel']>, level?: number): string {
  const dur = refStr(def, channel.duration, level);
  const parts = [`channels for ${dur}s`];
  if (channel.tick) {
    const inner = channel.tick.effects.map((n) => describeNode(def, n, level)).join(' and ');
    if (inner) parts.push(`every ${channel.tick.interval}s it ${inner}`);
  }
  if (channel.onEnd && channel.onEnd.length > 0) {
    const inner = channel.onEnd.map((n) => describeNode(def, n, level)).join(' and ');
    if (inner) parts.push(`on completion it ${inner}`);
  }
  return cap(parts.join('; ')) + '.';
}

function describeToggle(def: AbilityDef, toggle: NonNullable<AbilityDef['toggle']>, level?: number): string {
  const inner = toggle.effects.map((n) => describeNode(def, n, level)).join(' and ');
  const cost: string[] = [];
  if (toggle.manaPerSec !== undefined) cost.push(`${refStr(def, toggle.manaPerSec, level)} mana/s`);
  if (toggle.selfDamagePerSec !== undefined) cost.push(`${refStr(def, toggle.selfDamagePerSec, level)} self damage/s`);
  return `While active, every ${toggle.interval}s it ${inner || 'pulses'}${cost.length ? ` (${cost.join(', ')})` : ''}.`;
}

// ---------- Public builders ----------

function abilityKind(def: AbilityDef): string {
  if (def.ult) return 'Ultimate';
  switch (def.targeting) {
    case 'passive': return 'Passive';
    case 'aura': return 'Aura';
    case 'attack-modifier': return 'Attack modifier';
    case 'toggle': return 'Toggle';
    default: return 'Active';
  }
}

function describeAbilityEffects(def: AbilityDef, level?: number): string[] {
  if (def.description) return [def.description];
  const out: string[] = [];
  if (def.effects && def.effects.length > 0) {
    const joined = def.effects.map((n) => describeNode(def, n, level)).filter(Boolean).join(', then ');
    if (joined) out.push(cap(joined) + '.');
  }
  if (def.channel) out.push(describeChannel(def, def.channel, level));
  if (def.toggle) out.push(describeToggle(def, def.toggle, level));
  if (def.aura) out.push(describeAura(def, def.aura));
  if (def.attackMod) {
    const am = describeAttackMod(def, def.attackMod, level);
    if (am) out.push(cap(am) + '.');
  }
  for (const trig of def.triggers ?? []) {
    const t = describeTrigger(def, trig, level);
    if (t) out.push(t);
  }
  if (def.passiveMods && Object.keys(def.passiveMods).length > 0) {
    const lines = statLines(resolveMods(def, def.passiveMods, level), 6).join(', ');
    if (lines) out.push(`Passively grants ${lines}.`);
  }
  if (out.length === 0) out.push('No direct effect.');
  return out;
}

function abilityMeta(def: AbilityDef, level?: number): string[] {
  const chips: (string | null)[] = [];
  if (def.targeting && !['passive', 'aura', 'attack-modifier'].includes(def.targeting)) {
    chips.push(`Target: ${def.targeting.replace('-', ' ')}`);
  }
  chips.push(arrChip('CD', def.cooldown, level, 's'));
  chips.push(arrChip('Mana', def.manaCost, level));
  if (def.castRange !== undefined) {
    const r = refStr(def, def.castRange, level);
    if (r && Number(r) < 9000) chips.push(`Range ${r}`);
  }
  return chips.filter((c): c is string => !!c);
}

export function buildAbilityCard(def: AbilityDef, level?: number): TooltipCard {
  const lvl = level && level > 0 ? level : undefined;
  return {
    name: def.name,
    kind: abilityKind(def),
    blurb: def.lore,
    effect: describeAbilityEffects(def, lvl),
    stats: [],
    meta: abilityMeta(def, lvl)
  };
}

const ITEM_TIER_LABEL: Record<ItemDef['tier'], string> = {
  consumable: 'Consumable',
  component: 'Component',
  basic: 'Basic item',
  t1: 'Tier 1',
  t2: 'Tier 2',
  t3: 'Tier 3',
  t4: 'Tier 4',
  special: 'Special'
};

function itemEffectLines(def: ItemDef | NeutralItemDef): string[] {
  const out: string[] = [];
  const description = (def as ItemDef).description;
  if (description) {
    out.push(description);
  } else if (def.active) {
    const card = buildAbilityCard(def.active);
    const body = card.effect.join(' ');
    out.push(`Active — ${def.active.name}: ${body}`);
  }
  if (!description && def.attackMod) {
    const am = describeAttackMod(def.active ?? ({ values: {} } as AbilityDef), def.attackMod);
    if (am) out.push(cap(am) + '.');
  }
  if (!description && def.aura) out.push(describeAura(def.active ?? ({ values: {} } as AbilityDef), def.aura));
  if (!description && 'triggers' in def && def.triggers) {
    for (const trig of def.triggers) {
      const t = describeTrigger(def.active ?? ({ values: {} } as AbilityDef), trig);
      if (t) out.push(t);
    }
  }
  if (!description && 'damageLockoutSec' in def && def.damageLockoutSec) {
    out.push(`Disabled for ${def.damageLockoutSec}s after taking enemy damage.`);
  }
  return out;
}

function itemMeta(def: ItemDef | NeutralItemDef): string[] {
  const chips: (string | null)[] = [];
  if ('cost' in def && def.cost > 0) chips.push(`${def.cost} g`);
  if (def.active) {
    chips.push(arrChip('CD', def.active.cooldown, undefined, 's'));
    chips.push(arrChip('Mana', def.active.manaCost, undefined));
  }
  if ('charges' in def && def.charges) chips.push(`${def.charges} charges`);
  return chips.filter((c): c is string => !!c);
}

export interface ItemCardOpts {
  /** Resolved instance mods (passive + rolled affixes). Falls back to def.passiveMods. */
  mods?: StatModMap;
}

export function buildItemCard(def: ItemDef, opts: ItemCardOpts = {}): TooltipCard {
  const kind = def.rarity ? cap(def.rarity) : ITEM_TIER_LABEL[def.tier];
  const effect = itemEffectLines(def);
  const stats = statLines(opts.mods ?? def.passiveMods ?? {}, 12);
  if (effect.length === 0 && stats.length === 0) {
    effect.push(def.tier === 'component' ? 'A crafting component, built into stronger items.' : 'No inherent bonuses.');
  }
  return { name: def.name, kind, blurb: def.lore, effect, stats, meta: itemMeta(def) };
}

export interface HeroCardOpts {
  /** Owned-hero level, shown as a meta chip when present. */
  level?: number | null;
  /** Limit how many abilities to list (Compendium can show all; hover can trim). */
  abilityLimit?: number;
}

function heroStatLines(hero: HeroDef): string[] {
  const s = hero.baseStats;
  const primary = hero.attribute;
  const star = (attr: 'str' | 'agi' | 'int') => (primary === attr ? ' (primary)' : '');
  return [
    `STR ${s.str} +${s.strGain}${star('str')}`,
    `AGI ${s.agi} +${s.agiGain}${star('agi')}`,
    `INT ${s.int} +${s.intGain}${star('int')}`,
    `Damage ${s.baseDamage}`,
    `Armor ${s.baseArmor}`,
    `Move ${s.moveSpeed}`,
    `Attack ${s.attackRange <= 150 ? 'melee' : `${s.attackRange} range`}`
  ];
}

export function buildHeroCard(hero: HeroDef, opts: HeroCardOpts = {}): TooltipCard {
  const roles = hero.roles.slice(0, 4).join(' / ');
  const tagLine = hero.tagBoon ? [hero.tagBoon.tooltip] : [];
  const abilities = (opts.abilityLimit ? hero.abilities.slice(0, opts.abilityLimit) : hero.abilities)
    .map((a) => `${a.ult ? '\u2605 ' : ''}${a.name} \u2014 ${abilityKind(a)}`);
  const meta = [
    `${hero.attribute.toUpperCase()}${hero.attribute === 'uni' ? '' : ' core'}`,
    hero.baseStats.attackRange <= 150 ? 'Melee' : 'Ranged'
  ];
  if (opts.level != null) meta.push(`Lv ${opts.level}`);
  return {
    name: hero.name,
    kind: roles || 'Hero',
    blurb: hero.blurb ?? hero.lore,
    effect: [...tagLine, ...abilities],
    stats: heroStatLines(hero),
    meta
  };
}

export function buildNeutralItemCard(def: NeutralItemDef): TooltipCard {
  return {
    name: def.name,
    kind: `Neutral · Tier ${def.tier}`,
    blurb: def.lore,
    effect: itemEffectLines(def),
    stats: statLines(def.passiveMods ?? {}, 12),
    meta: itemMeta(def)
  };
}

/** Flatten a card to plain text (native-title fallback / tests). */
export function cardToText(card: TooltipCard): string {
  return [
    card.name + (card.kind ? ` (${card.kind})` : ''),
    ...card.effect,
    ...card.stats,
    card.meta.join(' · '),
    card.blurb ? `"${card.blurb}"` : ''
  ].filter(Boolean).join('\n');
}
