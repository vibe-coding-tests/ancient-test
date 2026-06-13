// ============================================================
// All global tunables. The sim reads Dota-baseline numbers from
// data and scales them through here. Rebalance centrally.
// ============================================================
export const TUNING = {
  // --- simulation ---
  tickRate: 30,
  dt: 1 / 30,

  // --- global scales (Dota numbers are the baseline) ---
  rangeScale: 1.0,
  speedScale: 1.0,
  damageScale: 1.0,
  cooldownScale: 0.8,        // action-RPG pacing: slightly faster cds than Dota
  manaCostScale: 0.9,

  // --- attributes (Dota-flavored) ---
  hpPerStr: 22,
  hpRegenPerStr: 0.1,
  manaPerInt: 12,
  manaRegenPerInt: 0.05,
  armorPerAgi: 1 / 6,
  attackSpeedPerAgi: 1,
  damagePerPrimary: 1,
  universalDamagePerStat: 0.45,
  baseHp: 120,
  baseMana: 75,
  baseMagicResist: 25,

  // --- combat ---
  armorFactor: 0.06,
  attackFacingDeg: 24,        // must roughly face target to attack
  turnRateToRadPerSec: 15,    // dota turnRate 0.6 -> 9 rad/s
  meleeRangeBuffer: 32,
  projectileHitRadius: 48,
  attackDamageVariance: 0.08, // +-8%
  attackMoveAcquireRadius: 850,
  aiAutoAcquireRadius: 650,
  creepThinkTicks: 5,
  gambitThinkTicks: 5,
  bossThinkTicks: 4,

  // --- xp / gold (trainer-level wallet) ---
  startingGold: 2600,
  xpCurve: [0, 0, 230, 600, 1080, 1660, 2260, 2980, 3730, 4620, 5550, 6520, 7530, 8580, 9805, 11055, 12330, 13630, 14955, 16455, 18045, 19645, 21495, 23595, 25945, 28545, 31395, 34495, 37845, 41445, 45295],
  levelCap: 30,
  postCapXpToGold: 0.25,      // gold per excess xp
  xpActivePct: 1.0,
  xpParticipantPct: 0.75,
  xpBenchPct: 0.5,
  lastHitBonusPct: 0.15,      // gold AND xp bonus for player-controlled last hit
  participantWindowSec: 10,
  deathGoldLossPct: 0.10,

  // --- hero swap (SPEC §6) ---
  swapCooldownSec: 4,
  swapCdFloorPct: 0.5,        // swapped-in hero cooldowns floored at 50% of remaining

  // --- capture (deterministic, SPEC §5) ---
  capture: {
    small:   { hpPct: 0.30, channelSec: 2.5 },
    medium:  { hpPct: 0.25, channelSec: 3.0 },
    large:   { hpPct: 0.20, channelSec: 3.5 },
    ancient: { hpPct: 0.15, channelSec: 4.5 }
  },
  captureRange: 250,

  // --- creeps / entourage ---
  starStatMult: [1, 1.85, 3.2],     // 1/2/3 star
  starDamageMult: [1, 1.7, 2.8],
  entourageMax: 3,
  entourageAncientMax: 1,
  entourageFaintSec: 90,
  creepAggroRadius: 650,
  entourageGuardRadius: 900,
  entourageChaseRadius: 650,
  entourageFollowStart: 280,
  entourageFollowStop: 135,
  creepLeashRadius: 1800,
  creepWanderRadius: 220,

  // --- raids/bosses (schema-level now, used from Phase 3) ---
  raidAssembledDropPct: { normal: 0.10, nightmare: 0.20, hell: 0.35 },
  raidBadLuckPity: 8,
  raidBossHpScale: 5,
  raidBossDamageScale: 1.25,
  raidBossRadiusScale: 1.7,

  // --- macro arena ---
  arenaWidth: 4200,
  arenaHeight: 3000,
  macroTeamXInset: 950,
  macroFormationDepth: 240,
  macroMaxSec: 300,
  captainCallsPerFight: 3,
  captainCallSec: 5,

  // --- items ---
  activeItemSlots: 4,         // Z/X/C/V; slots 5-6 passive-only
  itemSlots: 6,
  sellRatio: 0.5,

  // --- day/night ---
  dayLengthSec: 480,
  nightVisionMult: 0.7,

  // --- movement ---
  unitRadiusHero: 24,
  unitRadiusCreep: { small: 18, medium: 24, large: 32, ancient: 44 },
  separationStrength: 0.9,

  // --- world / region ---
  townSafeRadius: 900,
  campResetDist: 2400,
  shrineHealPctPerSec: 0.04,
  autosaveSec: 60,
  combatLockSec: 3.0          // no saving within N sec of taking/dealing damage
};
export type Tuning = typeof TUNING;
