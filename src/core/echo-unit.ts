import { TUNING } from '../data/tuning';
import { buildDefaultGambit } from './controllers';
import { autoPicksForLevel, buildHero } from './hero-setup';
import { worldLevelScale } from './progression';
import { REG } from './registry';
import type { Sim } from './sim';
import type { Team, Vec2 } from './types';
import type { Unit } from './unit';

export interface EchoOptions {
  heroId: string;
  team: Team;
  pos: Vec2;
  level: number;
  /** Fraction of max HP shaved off (Phase 2 §3.2 survivability tax). Default 0.4 → ×0.6 HP. */
  hpTaxPct?: number;
  /** Run the gambit controller (echo fidelity) vs a plain creep leash. Default true. */
  gambit?: boolean;
  /** Tether radius for an overworld echo so it does not roam the region. */
  leashRadius?: number;
  /** Mark the unit as an echo (renderer desaturates + makes translucent). Default true. */
  echoFlag?: boolean;
  bountyMult?: number;
  nameSuffix?: string;
  /** Featured World Level (§2.5): scales the echo's HP/damage after the survivability tax. */
  worldLevel?: number;
  /** COMBAT_DEPTH_OVERHAUL: enemyCompetence depth for the gambit controller (smarter at higher tier/WL). */
  aiDepth?: number;
}

/**
 * Build a hero echo from the full hero def (Phase 2 §3.2 / §3.3): same kit via
 * buildHero, on the enemy team, driven by the gambit controller, taxed to ×0.6
 * max HP, with no item slots, flagged for the desaturated/translucent render.
 */
export function spawnHeroEchoUnit(sim: Sim, opts: EchoOptions): Unit {
  const def = REG.hero(opts.heroId);
  const build = buildHero(def, autoPicksForLevel(opts.level), 0);
  const homePos = { ...opts.pos };
  const gambit = opts.gambit ?? true;
  const u = sim.spawnHero(build.def, {
    team: opts.team,
    pos: { ...opts.pos },
    level: opts.level,
    ctrl: gambit
      ? { kind: 'gambit', rules: buildDefaultGambit(def.roles), homePos, leashRadius: opts.leashRadius, aiDepth: opts.aiDepth }
      : { kind: 'creep', homePos, aiDepth: opts.aiDepth }
  });
  for (const k in build.externalMods) u.externalMods[k] = (u.externalMods[k] ?? 0) + build.externalMods[k];

  // Survivability tax: refresh once to learn the natural max HP, then shave it.
  u.markStatsDirty();
  u.refresh(sim.time);
  const tax = opts.hpTaxPct ?? TUNING.echoHpTaxPct;
  if (tax > 0) {
    u.externalMods.maxHp = (u.externalMods.maxHp ?? 0) - u.stats.maxHp * tax;
    u.markStatsDirty();
    u.refresh(sim.time);
  }

  // World Level texture (§2.5): a featured echo at WL>0 is tougher and hits harder,
  // applied *after* the survivability tax so the tax fraction stays meaningful.
  const wl = opts.worldLevel ?? 0;
  if (wl > 0) {
    const scale = worldLevelScale(wl);
    u.externalMods.maxHp = (u.externalMods.maxHp ?? 0) + u.stats.maxHp * (scale.hp - 1);
    u.externalMods.damagePct = (u.externalMods.damagePct ?? 0) + (scale.damage - 1) * 100;
    u.externalMods.spellAmpPct = (u.externalMods.spellAmpPct ?? 0) + (scale.damage - 1) * 100;
    u.markStatsDirty();
    u.refresh(sim.time);
  }

  // Echoes carry no items (no slots to use).
  u.items = [null, null, null, null, null, null];
  u.isEcho = opts.echoFlag ?? true;
  u.name = `${def.name}${opts.nameSuffix ?? ' Echo'}`;
  const mult = opts.bountyMult ?? 1.4;
  u.bounty = { xp: Math.round(def.bounty.xp * mult), gold: Math.round(def.bounty.gold * mult) };
  u.hp = u.stats.maxHp;
  u.mana = u.stats.maxMana;
  return u;
}
