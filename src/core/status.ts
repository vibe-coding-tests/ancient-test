import type { AttackModSpec, DamageType, EffectNode, StatusId, StatusParams } from './types';

// ---------------------------------------------------------------
// One shared status list consumed by both combat layers (SPEC §2).
// ---------------------------------------------------------------

export interface StatusMeta {
  debuff: boolean;
  purgeable: boolean;        // removed by basic dispel / purge
  blocksMove?: boolean;
  blocksAttack?: boolean;
  blocksCast?: boolean;
  breaksChannel?: boolean;
}

export const STATUS_META: Record<StatusId, StatusMeta> = {
  stun:           { debuff: true, purgeable: false, blocksMove: true, blocksAttack: true, blocksCast: true, breaksChannel: true },
  root:           { debuff: true, purgeable: true, blocksMove: true },
  silence:        { debuff: true, purgeable: true, blocksCast: true, breaksChannel: true },
  hex:            { debuff: true, purgeable: false, blocksAttack: true, blocksCast: true, breaksChannel: true },
  slow:           { debuff: true, purgeable: true },
  disarm:         { debuff: true, purgeable: true, blocksAttack: true },
  blind:          { debuff: true, purgeable: true },
  fear:           { debuff: true, purgeable: false, blocksAttack: true, blocksCast: true, breaksChannel: true },
  taunt:          { debuff: true, purgeable: false, blocksCast: true, breaksChannel: true },
  invis:          { debuff: false, purgeable: false },
  'magic-immune': { debuff: false, purgeable: false },
  break:          { debuff: true, purgeable: false },
  cyclone:        { debuff: true, purgeable: false, blocksMove: true, blocksAttack: true, blocksCast: true, breaksChannel: true },
  sleep:          { debuff: true, purgeable: true, blocksMove: true, blocksAttack: true, blocksCast: true, breaksChannel: true },
  frozen:         { debuff: true, purgeable: false, blocksMove: true, blocksAttack: true, blocksCast: true, breaksChannel: true },
  buff:           { debuff: false, purgeable: true } // carrier; debuff-ness derived from source team
};

export interface StatusInstance {
  status: StatusId;
  tag: string;               // stacking key (abilityId/itemId based); reapply refreshes
  sourceUid: number;
  sourceTeam: number;
  until: number;             // sim time, Infinity = permanent until removed
  isDebuff: boolean;         // resolved at apply (buff carrier from enemy = debuff)
  // resolved numeric params (no ValueRefs at runtime):
  mods?: Record<string, number>;
  dotDps?: number;
  dotType?: DamageType;
  moveSlowPct?: number;
  attackSlowPct?: number;
  fadeTime?: number;
  fadeAt?: number;           // invis becomes active at this time
  breakOnDamage?: boolean;
  periodic?: { interval: number; effects: EffectNode[]; nextAt: number };
  attackMod?: AttackModSpec; // already resolved to numbers
  consumeOnAttack?: boolean;
}

/** Aggregated view of a unit's statuses, recomputed each tick. */
export interface StatusSummary {
  stunned: boolean;
  rooted: boolean;
  silenced: boolean;
  disarmed: boolean;
  hexed: boolean;
  feared: number | null;     // source uid to flee from
  taunted: number | null;    // source uid to attack
  invisible: boolean;
  fading: boolean;           // invis granted but fade time not elapsed
  magicImmune: boolean;
  broken: boolean;
  cycloned: boolean;
  sleeping: boolean;
  frozen: boolean;
  untargetable: boolean;
  invulnerable: boolean;
  moveSlowFactor: number;    // multiplicative product, 1 = no slow
  attackSlowTotal: number;   // flat IAS reduction
  blindPct: number;
  msOverride: number | null; // hex forces 140
  mods: Record<string, number>;
}

export function summarize(statuses: StatusInstance[], now: number): StatusSummary {
  const s: StatusSummary = {
    stunned: false, rooted: false, silenced: false, disarmed: false, hexed: false,
    feared: null, taunted: null, invisible: false, fading: false, magicImmune: false,
    broken: false, cycloned: false, sleeping: false, frozen: false,
    untargetable: false, invulnerable: false,
    moveSlowFactor: 1, attackSlowTotal: 0, blindPct: 0, msOverride: null, mods: {}
  };
  for (const st of statuses) {
    switch (st.status) {
      case 'stun': s.stunned = true; break;
      case 'root': s.rooted = true; break;
      case 'silence': s.silenced = true; break;
      case 'disarm': s.disarmed = true; break;
      case 'hex': s.hexed = true; s.msOverride = 140; break;
      case 'fear': s.feared = st.sourceUid; break;
      case 'taunt': s.taunted = st.sourceUid; break;
      case 'magic-immune': s.magicImmune = true; break;
      case 'break': s.broken = true; break;
      case 'sleep': s.sleeping = true; break;
      case 'frozen': s.frozen = true; break;
      case 'cyclone': s.cycloned = true; s.untargetable = true; s.invulnerable = true; break;
      case 'invis':
        if (st.fadeAt !== undefined && now >= st.fadeAt) s.invisible = true;
        else s.fading = true;
        break;
      case 'blind': break;
      case 'slow': break;
      case 'buff': break;
    }
    if (st.moveSlowPct) s.moveSlowFactor *= 1 - Math.min(0.95, st.moveSlowPct / 100);
    if (st.attackSlowPct) s.attackSlowTotal += st.attackSlowPct;
    if (st.status === 'blind' && st.mods?.blindPct) s.blindPct = Math.max(s.blindPct, st.mods.blindPct);
    if (st.mods) {
      for (const k in st.mods) {
        if (k === 'blindPct') continue;
        if (k === 'untargetable') { if (st.mods[k]) s.untargetable = true; continue; }
        if (k === 'invulnerable') { if (st.mods[k]) s.invulnerable = true; continue; }
        s.mods[k] = (s.mods[k] ?? 0) + st.mods[k];
      }
    }
  }
  return s;
}

export function isDisabled(s: StatusSummary): boolean {
  return s.stunned || s.hexed || s.cycloned || s.sleeping || s.frozen;
}
export function cannotMove(s: StatusSummary): boolean {
  return s.stunned || s.rooted || s.cycloned || s.sleeping || s.frozen;
}
export function cannotAttack(s: StatusSummary): boolean {
  return s.stunned || s.hexed || s.disarmed || s.cycloned || s.sleeping || s.frozen || s.feared !== null;
}
export function cannotCast(s: StatusSummary): boolean {
  return s.stunned || s.hexed || s.silenced || s.cycloned || s.sleeping || s.frozen || s.feared !== null || s.taunted !== null;
}

let statusSeq = 1;
export function statusTagAuto(): string {
  return `st${statusSeq++}`;
}
