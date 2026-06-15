import { TUNING } from '../data/tuning';
import { REG } from './registry';
import type { ItemArchetype } from './item-archetype';
import type { AbilityDef, Attribute, CreepDef, EffectNode, StatusId, TargetSel } from './types';
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
  if (u.heroId) {
    const def = REG.heroes.get(u.heroId);
    return def ? def.roles : [];
  }
  // COMBAT_DEPTH_OVERHAUL: a wild creep plays its kit, not a flat 'generalist'.
  // Infer the same role vocabulary heroes use from the creep's authored abilities,
  // so the shared scorer weights a summoner, aura-totem, ranged nuker, stunner, or
  // brute body each like itself. Pure + cached by creepId.
  if (u.creepId) return creepRolesOf(u.creepId);
  return [];
}

const CREEP_ROLE_CACHE = new Map<string, string[]>();

function creepRolesOf(creepId: string): string[] {
  const cached = CREEP_ROLE_CACHE.get(creepId);
  if (cached) return cached;
  const def = REG.creeps.get(creepId);
  const roles = def ? deriveCreepRoles(def) : [];
  CREEP_ROLE_CACHE.set(creepId, roles);
  return roles;
}

/** Hard disables that read as control (mirrors ability-archetype's set). */
const CREEP_HARD_CC: ReadonlySet<StatusId> = new Set<StatusId>([
  'stun', 'root', 'hex', 'fear', 'sleep', 'frozen', 'cyclone'
]);

interface CreepKit {
  summon: boolean;       // raises bodies (a pusher)
  allyBuff: boolean;     // an ACTIVE heal/shield/buff cast onto an ally (a support)
  passiveAura: boolean;  // an always-on ally aura (a buff-totem leans support)
  attackMod: boolean;    // an on-hit weapon enchant (a sustained-DPS body)
  damageEnemy: boolean;  // any damage dealt to enemies via a cast
  aoeDamage: boolean;    // that damage catches an area (a cluster nuker)
  aoeHardCC: boolean;    // a hard disable lands on an area (an initiator)
  singleHardCC: boolean; // a hard disable lands on one target (a disabler)
}

function deriveCreepRoles(def: CreepDef): string[] {
  const k = creepKit(def);
  const ranged = def.stats.attackRange >= TUNING.ai.rangedThreshold;
  const bigBody = def.tier === 'large' || def.tier === 'ancient';
  const roles: string[] = [];
  if (k.allyBuff) roles.push('support');
  if (k.summon) roles.push('pusher');
  if (k.aoeHardCC) roles.push('initiator');
  else if (k.singleHardCC) roles.push('disabler');
  if (k.aoeDamage || (k.damageEnemy && ranged)) roles.push('nuker');
  // a large/ancient melee body is a frontline tank regardless of an incidental aura
  if (bigBody && !ranged) roles.push('durable');
  if (roles.length === 0) {
    if (k.passiveAura) roles.push('support');        // a pure buff-totem holds near its pack
    else if (k.attackMod || k.damageEnemy) roles.push('carry'); // a DPS body (kites if ranged)
    else roles.push(ranged ? 'carry' : 'durable');   // ranged auto-attacker vs melee brute
  }
  return roles;
}

function creepKit(def: CreepDef): CreepKit {
  const k: CreepKit = {
    summon: false, allyBuff: false, passiveAura: false, attackMod: false,
    damageEnemy: false, aoeDamage: false, aoeHardCC: false, singleHardCC: false
  };
  for (const ab of def.abilities) {
    if (ab.attackMod) k.attackMod = true;
    if (ab.targeting === 'aura' || (ab.aura && ab.aura.affects === 'allies')) k.passiveAura = true;
    scanCreepEffects(ab, ab.effects, k);
    if (ab.channel?.tick) scanCreepEffects(ab, ab.channel.tick.effects, k);
    if (ab.channel?.onEnd) scanCreepEffects(ab, ab.channel.onEnd, k);
    if (ab.toggle) scanCreepEffects(ab, ab.toggle.effects, k);
  }
  return k;
}

function isEnemyTargetSel(t: TargetSel): boolean {
  return t === 'target' || t === 'enemies-in-radius' || t === 'random-enemy-in-radius' || t === 'units-in-radius';
}

function isAllyTargetSel(t: TargetSel): boolean {
  return t === 'allies-in-radius' || t === 'lowest-hp-ally-in-radius' || t === 'units-in-radius' || t === 'target';
}

function isAoeSel(t: TargetSel): boolean {
  return t === 'enemies-in-radius' || t === 'allies-in-radius' || t === 'units-in-radius' || t === 'random-enemy-in-radius';
}

function scanCreepEffects(ab: AbilityDef, nodes: EffectNode[] | undefined, k: CreepKit): void {
  if (!nodes) return;
  for (const n of nodes) {
    switch (n.kind) {
      case 'damage': {
        if (isEnemyTargetSel(n.target)) {
          k.damageEnemy = true;
          if (n.radius !== undefined || isAoeSel(n.target)) k.aoeDamage = true;
        }
        break;
      }
      case 'status': {
        const aoe = n.radius !== undefined || isAoeSel(n.target);
        if (CREEP_HARD_CC.has(n.status) && isEnemyTargetSel(n.target)) {
          if (aoe) k.aoeHardCC = true;
          else if (n.target === 'target') k.singleHardCC = true;
        }
        if ((n.status === 'buff' || n.params?.mods) && n.target !== 'self' && !isEnemyTargetSel(n.target) && isAllyTargetSel(n.target)) {
          k.allyBuff = true;
        }
        if (n.params?.periodic) scanCreepEffects(ab, n.params.periodic.effects, k);
        break;
      }
      case 'displace': {
        if (n.mode !== 'blink' && isEnemyTargetSel(n.target)) {
          if (n.radius !== undefined || isAoeSel(n.target)) k.aoeHardCC = true;
          else if (n.target === 'target') k.singleHardCC = true;
        }
        break;
      }
      case 'heal':
        if (n.target !== 'self' && isAllyTargetSel(n.target)) k.allyBuff = true;
        break;
      case 'mana':
        if (n.op === 'restore' && n.target !== 'self' && isAllyTargetSel(n.target)) k.allyBuff = true;
        break;
      case 'statmod':
        if (n.target !== 'self' && isAllyTargetSel(n.target)) k.allyBuff = true;
        break;
      case 'purge':
        if (!isEnemyTargetSel(n.target)) k.allyBuff = true;
        break;
      case 'summon':
        k.summon = true;
        break;
      case 'zone': {
        const tick = n.zone.tick;
        if (tick && tick.affects !== 'allies') {
          if (tick.effects.some((e) => e.kind === 'damage')) k.aoeDamage = true;
          if (tick.effects.some((e) => e.kind === 'status' && CREEP_HARD_CC.has((e as Extract<EffectNode, { kind: 'status' }>).status))) k.aoeHardCC = true;
        }
        scanCreepEffects(ab, n.zone.tick?.effects, k);
        scanCreepEffects(ab, n.zone.onEnter?.effects, k);
        break;
      }
      case 'projectile':
        scanCreepEffects(ab, n.proj.onHit, k);
        break;
      case 'repeat':
        scanCreepEffects(ab, n.effects, k);
        break;
    }
  }
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
