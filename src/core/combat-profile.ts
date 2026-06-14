import { TUNING } from '../data/tuning';
import { REG } from './registry';
import type { ItemArchetype } from './item-archetype';
import type { Attribute } from './types';
import type { Unit } from './unit';

// ============================================================
// CombatProfile (AI_OVERHAUL §3): a unit's fighting character,
// derived once from data it already carries — role tags, primary
// attribute, and attack range. The utility scorer reads these
// weights so a hero plays like itself without any per-hero code.
// Pure, deterministic, cached by unit identity.
// ============================================================

export type CombatRole =
  | 'carry'
  | 'nuker'
  | 'support'
  | 'initiator'
  | 'durable'
  | 'disabler'
  | 'pusher'
  | 'escape'
  | 'generalist';

export type Posture = 'frontline' | 'midline' | 'backline';

export interface ProfileWeights {
  aggression: number;   // readiness to commit / dive
  survival: number;     // value placed on its own life
  saveAllies: number;   // peel, heal, and protective casts
  burst: number;        // value of bursting one high-value target
  aoe: number;          // value of catching several targets
  control: number;      // value of landing a disable
  focusFollow: number;  // how strongly it converges on the team focus
}

export interface ItemPlaybook {
  reach: ItemArchetype[];
  aimAt?: CombatRole;
}

export interface CombatProfile {
  role: CombatRole;
  posture: Posture;
  ranged: boolean;
  attribute: Attribute;
  weights: ProfileWeights;
  playbook: ItemPlaybook;
  kiteDistance: number; // 0 means it does not kite
  retreatHpPct: number; // hp fraction below which survival actions are preferred
}

const CACHE = new WeakMap<Unit, CombatProfile>();

/** Most behavior-defining role wins the label when a hero carries several tags. */
const ROLE_PRIORITY: CombatRole[] = [
  'support',
  'initiator',
  'carry',
  'nuker',
  'disabler',
  'durable',
  'pusher',
  'escape'
];

export function combatProfile(u: Unit): CombatProfile {
  const cached = CACHE.get(u);
  if (cached) return cached;
  const p = derive(u);
  CACHE.set(u, p);
  return p;
}

function rolesOf(u: Unit): string[] {
  if (!u.heroId) return [];
  const def = REG.heroes.get(u.heroId);
  return def ? def.roles : [];
}

function derive(u: Unit): CombatProfile {
  const roles = rolesOf(u);
  const has = (r: string) => roles.includes(r);
  const ranged = u.base.attackRange >= TUNING.ai.rangedThreshold;
  const longRanged = u.base.attackRange >= 500;

  const w: ProfileWeights = {
    aggression: 1,
    survival: 0.8,
    saveAllies: 0.2,
    burst: 0.7,
    aoe: 0.7,
    control: 0.7,
    focusFollow: 1
  };

  if (has('carry')) {
    w.burst += 0.3; w.survival += 0.3; w.focusFollow += 0.3; w.aggression += 0.1;
  }
  if (has('nuker')) {
    w.burst += 0.6; w.aoe += 0.4; w.aggression += 0.1;
  }
  if (has('support')) {
    w.saveAllies += 0.9; w.survival += 0.4; w.control += 0.2; w.aggression -= 0.4;
  }
  if (has('disabler')) {
    w.control += 0.7; w.aoe += 0.2;
  }
  if (has('initiator')) {
    w.aoe += 0.5; w.control += 0.5; w.aggression += 0.4; w.focusFollow += 0.2;
  }
  if (has('durable')) {
    w.aggression += 0.3; w.survival += 0.4; w.saveAllies += 0.2;
  }
  if (has('pusher')) {
    w.aoe += 0.3;
  }
  if (has('escape')) {
    w.survival += 0.4;
  }

  // attribute lean (the third axis of identity): strength bodies and soaks, agility
  // rides the carry and kites, intelligence bursts and zones from the back.
  if (u.attribute === 'str') {
    w.survival += 0.25; w.aggression += 0.1;
  } else if (u.attribute === 'agi') {
    w.burst += 0.15; w.focusFollow += 0.1;
  } else if (u.attribute === 'int') {
    w.burst += 0.2; w.aoe += 0.15; w.control += 0.1; w.survival -= 0.1;
  }

  // clamp into a sane band so no single hero is wildly off the others
  for (const k of Object.keys(w) as (keyof ProfileWeights)[]) {
    w[k] = Math.max(0, Math.min(2.2, Number(w[k].toFixed(3))));
  }

  const role = pickRole(roles);
  const posture = pickPosture(roles, ranged, longRanged, u.attribute);
  const kites = ranged && (has('carry') || has('nuker') || has('support') || has('escape') || u.attribute === 'agi');
  const kiteDistance = kites ? clamp(u.base.attackRange * 0.85, 350, 760) : 0;
  let retreat = has('support') || has('escape') ? 0.36 : has('carry') ? 0.26 : 0.2;
  if (u.attribute === 'str') retreat -= 0.04;
  else if (u.attribute === 'int') retreat += 0.05;
  const retreatHpPct = clamp(retreat, 0.12, 0.45);

  return {
    role,
    posture,
    ranged,
    attribute: u.attribute,
    weights: w,
    playbook: deriveItemPlaybook(role, u.attribute),
    kiteDistance,
    retreatHpPct
  };
}

function deriveItemPlaybook(role: CombatRole, attribute: Attribute): ItemPlaybook {
  const base = ROLE_ITEM_PLAYBOOK[role] ?? ROLE_ITEM_PLAYBOOK.generalist;
  const reach = [...base.reach];

  if (attribute === 'str') include(reach, 'field', 'sustain');
  else if (attribute === 'agi') include(reach, 'escape', 'immunity');
  else if (attribute === 'int') include(reach, 'amplify', 'nuke');

  return { reach, aimAt: base.aimAt };
}

/** Dominant combat role from a hero's tags (most behavior-defining wins). Exported so
 *  buildDefaultGambit derives role-true defaults from the same priority the profile uses. */
export function dominantRole(roles: string[]): CombatRole {
  return pickRole(roles);
}

function pickRole(roles: string[]): CombatRole {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return 'generalist';
}

function pickPosture(roles: string[], ranged: boolean, longRanged: boolean, attribute: Attribute): Posture {
  if (roles.includes('support')) return 'backline';
  if (roles.includes('durable') || roles.includes('initiator')) return 'frontline';
  if (!ranged) return 'frontline';                              // melee fights in front
  if (longRanged || roles.includes('nuker') || attribute === 'int') return 'backline';
  return 'midline';                                             // ranged agi carries hold the midline
}

const ROLE_ITEM_PLAYBOOK: Record<CombatRole, ItemPlaybook> = {
  initiator: { reach: ['initiation', 'lockdown', 'immunity'], aimAt: 'carry' },
  nuker: { reach: ['amplify', 'nuke', 'lockdown'], aimAt: 'carry' },
  disabler: { reach: ['lockdown', 'amplify'], aimAt: 'carry' },
  carry: { reach: ['immunity', 'sustain', 'escape'], aimAt: 'support' },
  support: { reach: ['save', 'sustain', 'cleanse', 'lockdown'], aimAt: 'carry' },
  durable: { reach: ['field', 'sustain', 'immunity', 'lockdown'], aimAt: 'nuker' },
  pusher: { reach: ['nuke', 'field'], aimAt: 'support' },
  escape: { reach: ['escape', 'lockdown', 'save'], aimAt: 'carry' },
  generalist: { reach: ['lockdown', 'nuke', 'save', 'sustain'] }
};

function include(reach: ItemArchetype[], ...items: ItemArchetype[]): void {
  for (const item of items) {
    if (!reach.includes(item)) reach.push(item);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
