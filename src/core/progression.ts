import { TUNING } from '../data/tuning';
import { xpForLevel } from './stats';
import type { DifficultyTier } from './types';

// ------------------------------------------------------------------
// XP & gold distribution (SPEC §6): active 100%, swapped-in
// participants 75%, bench 50%, +15% last-hit bonus, one shared wallet.
// Pure functions — the systems layer feeds in party state.
// ------------------------------------------------------------------

export interface PartyMemberState {
  heroId: string;
  isActive: boolean;
  /** participated = dealt/took damage within the participant window */
  participated: boolean;
}

export interface KillReward {
  perHeroXp: { heroId: string; xp: number }[];
  gold: number;
}

export function computeKillReward(
  bounty: { xp: number; gold: number },
  party: PartyMemberState[],
  lastHitByPlayer: boolean,
  partyXpAmpPct = 0
): KillReward {
  const bonus = lastHitByPlayer ? 1 + TUNING.lastHitBonusPct : 1;
  const xp = bounty.xp * bonus;
  const gold = Math.round(bounty.gold * bonus);
  // Party XP amp (PROGRESSION §5, Mentor's Standard): lerp the bench/participant
  // share toward the active rate by `partyXpAmpPct/100` (clamped to a full share).
  const amp = Math.max(0, Math.min(1, partyXpAmpPct / 100));
  const lerp = (share: number) => share + (TUNING.xpActivePct - share) * amp;
  const perHeroXp = party.map((m) => {
    const base = m.isActive ? TUNING.xpActivePct : m.participated ? TUNING.xpParticipantPct : TUNING.xpBenchPct;
    return { heroId: m.heroId, xp: Math.round(xp * (m.isActive ? base : lerp(base))) };
  });
  return { perHeroXp, gold };
}

/** Post-cap XP converts to gold (SPEC §5). Returns the full gold-equivalent. */
export function overflowXpToGold(level: number, xp: number, addXp: number): number {
  if (level < TUNING.levelCap) {
    const room = xpForLevel(TUNING.levelCap) - xp;
    const overflow = Math.max(0, addXp - room);
    return Math.round(overflow * TUNING.postCapXpToGold);
  }
  return Math.round(addXp * TUNING.postCapXpToGold);
}

/**
 * Split the post-cap overflow (PROGRESSION_OVERHAUL §4.2): a fraction of the
 * gold-equivalent banks as Trainer XP, the remainder stays gold. Conserves the
 * total value exactly — `gold + trainerXp === overflowXpToGold(...)`.
 */
export function overflowSplit(level: number, xp: number, addXp: number): { gold: number; trainerXp: number } {
  const goldEq = overflowXpToGold(level, xp, addXp);
  const trainerXp = Math.round(goldEq * TUNING.trainer.overflowToTrainerPct);
  return { gold: goldEq - trainerXp, trainerXp };
}

/** Trainer Level from banked Trainer XP over `TUNING.trainer.xpCurve` (1-indexed levels). */
export function trainerLevelForXp(xp: number): number {
  const curve = TUNING.trainer.xpCurve;
  let level = 1;
  for (let i = 1; i < curve.length; i++) {
    if (xp >= curve[i]) level = i + 1;
    else break;
  }
  return level;
}

/** Sum a meta-board effect key across the purchased node defs (a pure dial reader). */
export function metaValue(nodes: { effect: Partial<Record<string, number>> }[], key: string): number {
  let total = 0;
  for (const n of nodes) total += n.effect[key] ?? 0;
  return total;
}

/** Recruit level ceiling by badge count (§3.4); clamps to the last tuning entry. */
export function recruitLevelCap(badgeCount: number): number {
  const arr = TUNING.recruitLevelCap;
  return arr[Math.min(Math.max(0, badgeCount), arr.length - 1)];
}

// ------------------------------------------------------------------
// World Level (PROGRESSION_OVERHAUL §2): pure scaling helpers. The systems
// layer feeds in fielded level + badges; the core only reads numeric terms.
// ------------------------------------------------------------------

export type WorldLevelSource = 'overworld-camp' | 'ley-line' | 'echo' | 'boss' | 'raid';

export function worldLevel(maxFieldedLevel: number, badges: number, dialTier = 0): number {
  return Math.min(TUNING.worldLevel.cap, Math.floor(maxFieldedLevel / 6) + badges + Math.max(0, dialTier));
}

/**
 * The highest ascension-dial tier the player may currently select (§4.3): gated by
 * BOTH badge count and Trainer Level (the stricter wins), then capped by the base
 * ceiling plus any `worldLevelCap` meta nodes.
 */
export function worldLevelDialCap(badges: number, trainerLevel: number, metaWorldLevelCapBonus = 0): number {
  const d = TUNING.worldLevelDial;
  const byBadges = Math.floor(badges / d.badgesPerTier);
  const byTrainer = Math.floor(Math.max(0, trainerLevel - 1) / d.trainerLevelPerTier);
  return Math.max(0, Math.min(Math.min(byBadges, byTrainer), d.defaultCap + Math.max(0, metaWorldLevelCapBonus)));
}

/**
 * Featured encounters take the full World Level; ordinary small/medium overworld
 * trash is capped at `trashCap` so a capped hero can still outgrow it (§2).
 */
export function worldLevelForEncounter(
  wl: number,
  opts: { source: WorldLevelSource; creepTier?: string; packRarity?: 'normal' | 'champion' | 'rare' }
): number {
  const featured =
    opts.source !== 'overworld-camp' ||
    opts.packRarity === 'champion' ||
    opts.packRarity === 'rare' ||
    opts.creepTier === 'large' ||
    opts.creepTier === 'ancient';
  return featured ? wl : Math.min(wl, TUNING.worldLevel.trashCap);
}

export function worldLevelScale(wl: number): { hp: number; damage: number; texture: number } {
  const t = TUNING.worldLevel;
  return { hp: 1 + wl * t.hpPerLevel, damage: 1 + wl * t.damagePerLevel, texture: wl * t.texturePerLevel };
}

/** Elemental-shield fraction for featured World-Level texture. */
export function worldLevelShieldFraction(wl: number): number {
  const t = TUNING.worldLevel;
  return t.shieldBasePct + worldLevelScale(wl).texture * t.shieldTextureMult;
}

// ------------------------------------------------------------------
// Enemy competence (COMBAT_DEPTH_OVERHAUL): one derived "how well this
// enemy fights" scalar in [0,1]. Used as `ctrl.aiDepth` and to gate pack
// coordination, mechanic density, and the reaction (resonance) demand, so
// difficulty + depth make enemies SMARTER, not just tankier. Pure.
// ------------------------------------------------------------------

export interface EnemyCompetenceOpts {
  tier?: DifficultyTier;
  /** featured World Level (0..cap) — already gated by worldLevelForEncounter upstream. */
  worldLevel?: number;
  rarity?: 'normal' | 'champion' | 'rare';
  rank?: 'creep' | 'elite' | 'boss';
}

/**
 * Reuses the `bossTierAiDepth` band as the tier floor, so `normal + WL0` equals
 * `ai.depthRefAiDepth` (today's baseline → `aiDepthBonus` of 0) and the value ramps
 * up with hell / high World Level / pack rarity / rank. Clamped to [0,1].
 */
export function enemyCompetence(opts: EnemyCompetenceOpts = {}): number {
  const c = TUNING.competence;
  const base = TUNING.bossTierAiDepth[opts.tier ?? 'normal'];
  const wl = Math.max(0, opts.worldLevel ?? 0) * c.perWorldLevel;
  const rarity = opts.rarity === 'rare' ? c.rareBonus : opts.rarity === 'champion' ? c.championBonus : 0;
  const rank = opts.rank === 'boss' ? c.bossBonus : opts.rank === 'elite' ? c.eliteBonus : 0;
  const v = base + wl + rarity + rank;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function xpProgress(level: number, xp: number): { current: number; needed: number; pct: number } {
  if (level >= TUNING.levelCap) return { current: 0, needed: 0, pct: 1 };
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { current: xp - cur, needed: next - cur, pct: (xp - cur) / (next - cur) };
}
