import { generateDungeon } from '../core/dungeon';
import { execEffects, type EffectCtx } from '../core/effects';
import { buildHero } from '../core/hero-setup';
import { createRaidMechanicRunner, heroesAlive, type RaidMechanicRunner } from '../core/macro';
import { bossBkbItemOverrides, tierScale } from '../core/phase3';
import { enemyCompetence } from '../core/progression';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import { makeItemState, sortInventory } from '../core/items';
import { collisionBodyPushOut, normalizeCollisionObstacle, roomCollisionObstacle } from '../core/collision';
import { DUNGEON_PACK_RING_RADIUS, dungeonPackSpawnPositions } from '../core/dungeon-spawn';
import { footprintToRadius } from '../engine/scale';
import { bossVisualScale, bossWorldSize } from '../engine/world-size';
import { TUNING } from '../data/tuning';
import type { AffixDef, BossDef, CollisionObstacle, CollisionObstacleInput, CreepInstanceSave, DifficultyTier, DungeonDef, DungeonLayout, DungeonRoom, EffectNode, MacroHeroSetup, PlannedPack, RaidDef, RoomTemplate, SeasonalModeKind, SummonSpec, Vec2, ZoneSpec } from '../core/types';
import type { Unit } from '../core/unit';

const FALLBACK_ROOM_SIZE = { x: 4200, y: 3000 };
type DungeonPacingPhase = 'idle' | 'build-up' | 'peak' | 'relax';

const PACK_PROGRESS_WEIGHT: Record<PlannedPack['rarity'], number> = { normal: 1, champion: 3, rare: 6 };

const GUARDIAN_THRALL: SummonSpec = {
  id: 'dungeon-guardian-thrall',
  name: 'Guardian Thrall',
  lifetime: 34,
  stats: { maxHp: 460, damage: 30, armor: 1, moveSpeed: 325, attackRange: 120, baseAttackTime: 1.45 },
  silhouette: { build: 'biped', scale: 0.7, weapon: 'sword', head: 'horned' },
  palette: ['#6f3fb5', '#170b25', '#d5a7ff']
};

const GUARDIAN_ZONE: ZoneSpec = {
  shape: 'circle',
  radius: 360,
  duration: 7,
  auraMods: { affects: 'enemies', mods: { moveSpeedPct: -22, attackSpeed: -18 } },
  tick: { interval: 0.75, affects: 'enemies', effects: [{ kind: 'damage', dtype: 'magical', amount: 46, target: 'target' }] }
};

function guardianRaidDef(def: DungeonDef, boss: BossDef): RaidDef {
  const phases = boss.phases && boss.phases.length > 0
    ? boss.phases
    : [{ atHpPct: 65, onEnter: [] }, { atHpPct: 35, onEnter: [] }];
  return {
    id: `dungeon-${def.id}-${boss.id}`,
    name: `${def.name} Guardian`,
    title: 'Dungeon Guardian',
    location: def.name,
    unlockQuest: def.unlockQuest ?? 'dungeon',
    boss: { heroId: boss.heroId, level: boss.rank === 'boss' ? 30 : 26, items: ['black-king-bar'], hpScale: 1, damageScale: 1 },
    addWaves: phases.map((phase, i) => ({ atHpPct: Math.max(10, phase.atHpPct - 8), summon: GUARDIAN_THRALL, count: 2 + Math.min(3, i) })),
    zones: phases.map((phase, i) => ({ atHpPct: phase.atHpPct, zone: { ...GUARDIAN_ZONE, radius: 320 + i * 70 } })),
    enrageSec: 95,
    loot: boss.loot,
    signatureExotic: `dungeon-guardian-${boss.id}`,
    dialogue: boss.dialogue
  };
}

function syntheticTemplate(id: string, biome: DungeonDef['biome']): RoomTemplate {
  return {
    id,
    biome,
    size: { ...FALLBACK_ROOM_SIZE },
    connectors: [
      { side: 'w', at: { x: 180, y: FALLBACK_ROOM_SIZE.y / 2 } },
      { side: 'e', at: { x: FALLBACK_ROOM_SIZE.x - 180, y: FALLBACK_ROOM_SIZE.y / 2 } }
    ],
    spawnAnchors: [
      { x: FALLBACK_ROOM_SIZE.x * 0.62, y: FALLBACK_ROOM_SIZE.y * 0.34 },
      { x: FALLBACK_ROOM_SIZE.x * 0.74, y: FALLBACK_ROOM_SIZE.y * 0.5 },
      { x: FALLBACK_ROOM_SIZE.x * 0.62, y: FALLBACK_ROOM_SIZE.y * 0.66 }
    ],
    allowTypes: ['entrance', 'combat', 'elite', 'treasure', 'shrine', 'rest', 'boss'],
    props: { treeDensity: 0, rockDensity: 0 }
  };
}

function registeredTemplates(def: DungeonDef): RoomTemplate[] | undefined {
  const templates: RoomTemplate[] = [];
  for (const id of def.templates) {
    const t = REG.roomTemplates.get(id);
    if (!t) return undefined;
    templates.push(t);
  }
  return templates;
}

function templateMap(def: DungeonDef, templates: RoomTemplate[] | undefined): Map<string, RoomTemplate> {
  return new Map((templates ?? def.templates.map((id) => syntheticTemplate(id, def.biome))).map((t) => [t.id, t]));
}

function roomBounds(template: RoomTemplate): { w: number; h: number } {
  return { w: template.size.x, h: template.size.y };
}

function roomObstacleInputs(template: RoomTemplate): CollisionObstacleInput[] {
  const bodies = [
    ...(template.walls ?? []),
    ...(template.blockers ?? []),
    ...(template.doors ?? []).map((door) => door.body)
  ];
  return bodies.map(roomCollisionObstacle).filter((body) => body.radius > 0);
}

function roomObstacles(template: RoomTemplate): CollisionObstacle[] {
  return roomObstacleInputs(template).map(normalizeCollisionObstacle);
}

function roomSpawnForbiddenBodies(template: RoomTemplate): { pos: Vec2; body: import('../core/types').CollisionBody }[] {
  return [
    ...(template.walls ?? []),
    ...(template.blockers ?? []),
    ...(template.doors ?? []).map((door) => door.body),
    ...(template.noSpawnZones ?? []),
    ...(template.safeZones ?? [])
  ];
}

export interface DungeonSessionResult {
  cleared: boolean;
  wiped: boolean;
  timeSec: number;
  roomIndex: number;
  clearedRooms: number[];
  guardianCleared: boolean;
  endless: boolean;
  endlessLevel: number;
  progress: number;
  hash: string;
}

export interface DungeonFestivalObjective {
  mode: SeasonalModeKind;
  pulses: number;
  choiceRooms: number;
  actRooms: number;
  timerSec: number;
  nextPressureAt: number;
}

export class DungeonSession {
  readonly def: DungeonDef;
  readonly tier: DifficultyTier;
  readonly layout: DungeonLayout;
  readonly sim: Sim;
  readonly partyUids: number[] = [];
  readonly entourageUids: number[] = [];
  enemyUids: number[] = [];
  private readonly maxTicks: number;
  private readonly affixes: Map<string, AffixDef>;
  private readonly roomTemplates: Map<string, RoomTemplate>;
  private readonly festivalMode?: SeasonalModeKind;
  private currentRoomIndex = 0;
  private readonly cleared = new Set<number>();
  private readonly completedRooms: DungeonRoom[] = [];
  private awaitingExit = false;
  private guardianUid: number | null = null;
  private guardianBossDef: BossDef | null = null;
  private guardianRaidMechanics: RaidMechanicRunner | null = null;
  private guardianRaidFiredCount = 0;
  private readonly guardianPhaseKeys = new Set<string>();
  private readonly entourageUnits = new Map<string, number>();
  private roomPackCursor = 0;
  private roomSpawnedPacks = 0;
  private nextPackAt = 0;
  private pacingPhase: DungeonPacingPhase = 'idle';
  private readonly enemyWeight = new Map<number, number>();
  private festivalPulses = 0;
  private festivalChoiceRooms = 0;
  private festivalActRooms = 0;
  private nextFestivalPressureAt = 12;
  private readonly festivalChoiceSeen = new Set<number>();
  private readonly festivalActSeen = new Set<number>();

  driverIdx = 0;
  done = false;
  result: DungeonSessionResult | null = null;
  guardianMechanicsFired: string[] = [];

  constructor(def: DungeonDef, party: MacroHeroSetup[], tier: DifficultyTier, seed: number, opts?: { maxSec?: number; modifiers?: string[]; endless?: boolean; endlessLevel?: number; festivalMode?: SeasonalModeKind }) {
    this.def = def;
    this.tier = tier;
    this.festivalMode = opts?.festivalMode;
    const templates = registeredTemplates(def);
    this.layout = generateDungeon(def, tier, seed, { modifiers: opts?.modifiers, roomTemplates: templates, endless: opts?.endless, endlessLevel: opts?.endlessLevel });
    this.roomTemplates = templateMap(def, templates);
    const firstTemplate = this.roomTemplateFor(this.layout.rooms[0]);
    this.sim = new Sim({ seed, bounds: roomBounds(firstTemplate), obstacles: roomObstacleInputs(firstTemplate) });
    // COMBAT_DEPTH_OVERHAUL: dungeons are micro real-time PvE like the overworld, so
    // reactions resolve here too — a shielded pack demands its weakness element rather
    // than dissolving to any damage. (Macro gym/Elite sims stay pure-Dota with it off.)
    this.sim.resonanceEnabled = true;
    this.maxTicks = Math.round((opts?.maxSec ?? this.layout.depth * 75) / this.sim.dt);
    this.affixes = new Map((def.affixes ?? []).map((affix) => [affix.id, affix]));
    this.spawnParty(party);
    this.sim.playerActiveUid = this.partyUids[0] ?? -1;
    this.enterNextPlayableRoom();
    this.checkDone();
  }

  get room(): DungeonRoom {
    return this.layout.rooms[this.currentRoomIndex] ?? this.layout.rooms[this.layout.rooms.length - 1];
  }

  roomTemplate(room = this.room): RoomTemplate {
    return this.roomTemplateFor(room);
  }

  drivenUnit(): Unit | null {
    const u = this.sim.unit(this.partyUids[this.driverIdx]);
    if (u?.alive) return u;
    return heroesAlive(this.sim, 0)[0] ?? null;
  }

  cameraFollow(): Unit | null {
    return this.drivenUnit() ?? heroesAlive(this.sim, 0)[0] ?? this.sim.unit(this.enemyUids[0]) ?? null;
  }

  selectDriver(idx: number): boolean {
    const uid = this.partyUids[idx];
    const u = uid !== undefined ? this.sim.unit(uid) : undefined;
    if (!u || !u.alive) return false;
    this.driverIdx = idx;
    this.sim.playerActiveUid = u.uid;
    this.retargetEntourage(u.uid);
    return true;
  }

  exitsUnlocked(): boolean {
    return this.awaitingExit;
  }

  availableExits(): DungeonRoom[] {
    if (!this.awaitingExit) return [];
    if (this.guardianReady()) return [this.layout.rooms[this.layout.depth - 1]].filter((room): room is DungeonRoom => !!room);
    return this.room.exits
      .map((index) => this.layout.rooms[index])
      .filter((room): room is DungeonRoom => !!room);
  }

  selectedModifiers(): string[] {
    return [...this.layout.modifiers];
  }

  pacingInfo(): { phase: DungeonPacingPhase; spawnedPacks: number; plannedPacks: number; remainingPacks: number; nextPackIn: number } {
    return {
      phase: this.pacingPhase,
      spawnedPacks: this.roomSpawnedPacks,
      plannedPacks: this.room.packs.length,
      remainingPacks: Math.max(0, this.room.packs.length - this.roomPackCursor),
      nextPackIn: Math.max(0, this.nextPackAt - this.sim.time)
    };
  }

  /** Rarity-weighted kill progress (Diablo III greater-rift meter). 1 = guardian summoned. */
  endlessProgress(): number {
    const target = this.layout.progressTarget;
    if (!target || target <= 0) return this.layout.endless ? 0 : 1;
    let accrued = 0;
    for (const [uid, weight] of this.enemyWeight) {
      if (!this.sim.unit(uid)?.alive) accrued += weight;
    }
    return Math.min(1, accrued / target);
  }

  endlessInfo(): { active: boolean; level: number; progress: number } {
    return { active: !!this.layout.endless, level: this.layout.endlessLevel ?? 0, progress: this.endlessProgress() };
  }

  festivalObjective(): DungeonFestivalObjective | null {
    if (!this.festivalMode) return null;
    return {
      mode: this.festivalMode,
      pulses: this.festivalPulses,
      choiceRooms: this.festivalChoiceRooms,
      actRooms: this.festivalActRooms,
      timerSec: Math.max(0, this.maxTicks * this.sim.dt - this.sim.time),
      nextPressureAt: this.nextFestivalPressureAt
    };
  }

  chooseExit(index: number): boolean {
    const canChooseGuardian = this.guardianReady() && index === this.layout.depth - 1;
    if (this.done || !this.awaitingExit || (!this.room.exits.includes(index) && !canChooseGuardian)) return false;
    this.awaitingExit = false;
    this.currentRoomIndex = index;
    this.enterNextPlayableRoom();
    this.checkDone();
    return true;
  }

  drainCompletedRooms(): DungeonRoom[] {
    const rooms = [...this.completedRooms];
    this.completedRooms.length = 0;
    return rooms;
  }

  step(dt: number): void {
    if (this.done) return;
    const ticks = Math.max(1, Math.round(dt / this.sim.dt));
    for (let i = 0; i < ticks && !this.done; i++) {
      this.sim.tick();
      this.tickGuardianMechanics();
      this.tickFestivalPressure();
      this.checkDone();
    }
  }

  private spawnParty(party: MacroHeroSetup[]): void {
    const template = this.roomTemplateFor(this.layout.rooms[0]);
    const x = Math.max(220, Math.min(720, template.size.x * 0.18));
    const y = template.size.y / 2;
    party.slice(0, 5).forEach((setup, i) => {
      const base = REG.hero(setup.heroId);
      const build = buildHero(base);
      const pos = { x, y: y + (i - 2) * 180 };
      const u = this.sim.spawnHero(build.def, {
        team: 0,
        pos,
        level: setup.level,
        ctrl: i === 0 ? { kind: 'player' } : { kind: 'gambit', rules: setup.gambits }
      });
      for (const [k, v] of Object.entries(build.externalMods)) u.externalMods[k] = (u.externalMods[k] ?? 0) + v;
      setup.items?.slice(0, 6).forEach((id, slot) => {
        u.items[slot] = makeItemState(REG.item(id));
      });
      u.items = sortInventory(u.items);
      u.markStatsDirty();
      u.markVisualDirty();
      u.refresh(this.sim.time);
      u.hp = u.stats.maxHp;
      u.mana = u.stats.maxMana;
      this.partyUids.push(u.uid);
    });
  }

  spawnEntourage(instances: CreepInstanceSave[]): void {
    const owner = this.drivenUnit();
    if (!owner) return;
    const template = this.roomTemplateFor(this.layout.rooms[0]);
    instances.forEach((inst, i) => {
      if (this.entourageUnits.has(inst.uid)) return;
      const def = REG.creep(inst.creepId);
      const pos = {
        x: Math.max(120, Math.min(template.size.x - 120, owner.pos.x - 160 - (i % 2) * 120)),
        y: Math.max(120, Math.min(template.size.y - 120, owner.pos.y + (i - 1) * 140))
      };
      const u = this.sim.spawnCreep(def, {
        team: 0,
        pos,
        star: inst.star,
        ownerUid: owner.uid
      });
      u.visual = { silhouette: def.silhouette, palette: def.palette };
      this.entourageUnits.set(inst.uid, u.uid);
      this.entourageUids.push(u.uid);
    });
  }

  removeEntourage(instanceUid: string): void {
    const uid = this.entourageUnits.get(instanceUid);
    if (uid === undefined) return;
    const u = this.sim.unit(uid);
    if (u?.alive) this.sim.removeUnit(uid);
    this.entourageUnits.delete(instanceUid);
    const idx = this.entourageUids.indexOf(uid);
    if (idx >= 0) this.entourageUids.splice(idx, 1);
  }

  private retargetEntourage(ownerUid = this.drivenUnit()?.uid): void {
    if (ownerUid === undefined) return;
    for (const uid of this.entourageUids) {
      const u = this.sim.unit(uid);
      if (u?.alive) u.ownerUid = ownerUid;
    }
  }

  private enterNextPlayableRoom(): void {
    while (!this.done && !this.awaitingExit) {
      const room = this.room;
      const template = this.roomTemplateFor(room);
      this.sim.bounds = roomBounds(template);
      this.sim.obstacles = roomObstacles(template);
      this.repositionParty();
      this.enemyUids = [];
      this.guardianUid = null;
      this.guardianBossDef = null;
      this.guardianRaidMechanics = null;
      this.guardianRaidFiredCount = 0;
      this.guardianPhaseKeys.clear();
      this.roomPackCursor = 0;
      this.roomSpawnedPacks = 0;
      this.nextPackAt = this.sim.time;
      this.pacingPhase = 'idle';

      if (room.type === 'rest') this.healParty();
      if (room.type === 'boss') this.spawnGuardian();
      else this.startRoomPacing();

      if (this.enemyUids.length > 0 || this.roomPackCursor < this.room.packs.length) return;
      this.completeCurrentRoom();
      if (this.done) return;
    }
  }

  private repositionParty(): void {
    const template = this.roomTemplateFor();
    const x = Math.max(220, Math.min(720, template.size.x * 0.18));
    const y = template.size.y / 2;
    const alive = this.partyUids
      .map((uid) => this.sim.unit(uid))
      .filter((u): u is Unit => !!u && u.alive);
    alive.forEach((u, i) => {
      u.pos = { x, y: y + (i - 2) * 180 };
      u.prevPos = { ...u.pos };
      u.facing = 0;
      u.order = { kind: 'stop' };
    });
    const driver = this.drivenUnit();
    if (driver) this.sim.playerActiveUid = driver.uid;
    this.repositionEntourage();
  }

  private repositionEntourage(): void {
    const owner = this.drivenUnit();
    if (!owner) return;
    const template = this.roomTemplateFor();
    const alive = this.entourageUids
      .map((uid) => this.sim.unit(uid))
      .filter((u): u is Unit => !!u && u.alive);
    alive.forEach((u, i) => {
      u.ownerUid = owner.uid;
      u.pos = {
        x: Math.max(u.radius, Math.min(template.size.x - u.radius, owner.pos.x - 180 - (i % 2) * 120)),
        y: Math.max(u.radius, Math.min(template.size.y - u.radius, owner.pos.y + (i - 1) * 145))
      };
      u.prevPos = { ...u.pos };
      u.order = { kind: 'stop' };
    });
  }

  private healParty(): void {
    for (const uid of this.partyUids) {
      const u = this.sim.unit(uid);
      if (!u?.alive) continue;
      u.hp = u.stats.maxHp;
      u.mana = u.stats.maxMana;
    }
  }

  private startRoomPacing(): void {
    if (this.room.packs.length === 0) {
      this.pacingPhase = 'idle';
      return;
    }
    this.pacingPhase = 'build-up';
    this.spawnNextPack();
  }

  private packSpawnPointClear(template: RoomTemplate, point: Vec2, radius: number): boolean {
    if (point.x < radius || point.y < radius || point.x > template.size.x - radius || point.y > template.size.y - radius) return false;
    return roomSpawnForbiddenBodies(template).every((body) => !collisionBodyPushOut(body.pos, body.body, point, radius));
  }

  private packSpawnPositions(center: Vec2, count: number, radius: number): Vec2[] {
    const template = this.roomTemplateFor();
    for (let attempt = 0; attempt < 8; attempt++) {
      const ring = DUNGEON_PACK_RING_RADIUS + attempt * 35;
      const rotate = attempt * 0.47;
      const positions = dungeonPackSpawnPositions(center, count, ring).map((p) => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const c = Math.cos(rotate);
        const s = Math.sin(rotate);
        return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
      });
      if (positions.every((p) => this.packSpawnPointClear(template, p, radius))) return positions;
    }
    return dungeonPackSpawnPositions(center, count).map((p) => ({
      x: Math.max(radius, Math.min(template.size.x - radius, p.x)),
      y: Math.max(radius, Math.min(template.size.y - radius, p.y))
    }));
  }

  private spawnNextPack(): void {
    const pack = this.room.packs[this.roomPackCursor];
    if (!pack) return;
    const anchors = this.roomTemplateFor().spawnAnchors;
    const center = anchors[pack.anchorIndex % Math.max(1, anchors.length)] ?? { x: this.sim.bounds.w * 0.7, y: this.sim.bounds.h / 2 };
    const spawned: Unit[] = [];
    const weight = PACK_PROGRESS_WEIGHT[pack.rarity] ?? 1;
    const positions = this.packSpawnPositions(center, pack.cards.length, Math.max(...Object.values(TUNING.unitRadiusCreep)));
    const packRarity: 'normal' | 'champion' | 'rare' = pack.rarity === 'rare' ? 'rare' : pack.rarity === 'champion' ? 'champion' : 'normal';
    const packDepth = enemyCompetence({ tier: this.tier, rarity: packRarity });
    pack.cards.forEach((card, i) => {
      const pos = positions[i] ?? center;
      const u = this.sim.spawnCreep(REG.creep(card.creepId), { team: 1, pos, star: card.star, wild: true, homePos: { ...center }, combatTier: this.tier, aiDepth: packDepth });
      spawned.push(u);
      this.enemyUids.push(u.uid);
      this.enemyWeight.set(u.uid, weight);
    });
    this.applyPackAffixes(pack, spawned, center);
    this.roomPackCursor += 1;
    this.roomSpawnedPacks += 1;
    this.pacingPhase = 'peak';
  }

  private applyPackAffixes(pack: PlannedPack, units: Unit[], point: { x: number; y: number }): void {
    if (units.length === 0 || pack.affixes.length === 0) return;
    for (const affixId of pack.affixes) {
      const affix = this.affixes.get(affixId);
      if (!affix || affix.apply.length === 0) continue;
      for (const u of units) {
        execEffects(this.sim, u, this.affixCtx(affixId, u), affix.apply, { target: u, point });
      }
    }
  }

  private affixCtx(affixId: string, caster: Unit): EffectCtx {
    return {
      defId: `dungeon-affix:${affixId}`,
      level: caster.level,
      vfx: { archetype: 'ground-aoe', color: '#8ec5ff', color2: '#dce8ff' }
    };
  }

  private spawnGuardian(): void {
    const boss = REG.boss(this.def.guardian);
    this.guardianBossDef = boss;
    const level = boss.rank === 'boss' ? 30 : 26;
    const build = buildHero(REG.hero(boss.heroId));
    const scale = tierScale(this.tier);
    const template = this.roomTemplateFor();
    const pos = template.spawnAnchors.at(-1) ?? { x: template.size.x * 0.72, y: template.size.y / 2 };
    const u = this.sim.spawnHero(build.def, {
      team: 1,
      pos,
      level,
      ctrl: {
        kind: 'boss',
        threat: {},
        homePos: { ...pos },
        boss: { depth: TUNING.bossTierAiDepth[this.tier], enrageSec: 90 },
        aiDepth: enemyCompetence({ tier: this.tier, rank: 'boss' })
      }
    });
    for (const [k, v] of Object.entries(build.externalMods)) u.externalMods[k] = (u.externalMods[k] ?? 0) + v;
    u.items[0] = makeItemState(REG.item('black-king-bar'), bossBkbItemOverrides(this.tier)['black-king-bar']);
    u.items[1] = makeItemState(REG.item('assault-cuirass'));
    u.externalMods.maxHp = (u.externalMods.maxHp ?? 0) + u.stats.maxHp * (TUNING.raidBossHpScale * scale.hp - 1);
    u.externalMods.damagePct = (u.externalMods.damagePct ?? 0) + (TUNING.raidBossDamageScale * scale.damage - 1) * 100;
    if (TUNING.applyBossArmorTier) {
      u.externalMods.armor = (u.externalMods.armor ?? 0) + u.base.baseArmor * (scale.armor - 1);
    }
    u.radius = TUNING.unitRadiusHero * TUNING.raidBossRadiusScale;
    const bossSize = bossWorldSize(boss, REG.hero(boss.heroId));
    const footprintRadius = footprintToRadius(bossSize.footprintM);
    u.visualScale = bossVisualScale(boss, REG.hero(boss.heroId));
    u.footprintDecoupled = bossSize.footprintDecoupled;
    u.visualFootprintRadius = footprintRadius;
    u.hitRadius = Math.max(u.radius, footprintRadius);
    u.targetRadius = u.hitRadius;
    u.pickRadius = u.hitRadius;
    u.markStatsDirty();
    u.refresh(this.sim.time);
    u.hp = u.stats.maxHp;
    u.mana = u.stats.maxMana;
    u.facing = Math.PI;
    this.guardianUid = u.uid;
    this.enemyUids.push(u.uid);
    this.guardianRaidMechanics = createRaidMechanicRunner(guardianRaidDef(this.def, boss), this.sim, u);
    this.guardianRaidFiredCount = 0;
  }

  private tickGuardianMechanics(): void {
    if (this.room.type !== 'boss' || this.guardianUid === null || !this.guardianBossDef) return;
    const boss = this.sim.unit(this.guardianUid);
    if (!boss?.alive) return;
    const hpPct = 100 * boss.hp / Math.max(1, boss.stats.maxHp);
    for (let i = 0; i < (this.guardianBossDef.phases ?? []).length; i++) {
      const phase = this.guardianBossDef.phases![i];
      const key = `phase-${i}`;
      if (this.guardianPhaseKeys.has(key) || hpPct > phase.atHpPct) continue;
      execEffects(this.sim, boss, this.guardianCtx(boss), phase.onEnter, { target: boss, point: boss.pos });
      this.guardianPhaseKeys.add(key);
      this.guardianMechanicsFired.push(key);
    }
    if (this.guardianRaidMechanics) {
      this.guardianRaidMechanics.tick(this.sim);
      const fired = this.guardianRaidMechanics.fired.slice(this.guardianRaidFiredCount);
      for (const ev of fired) this.guardianMechanicsFired.push(`raid-${ev.kind}:${ev.id}`);
      this.guardianRaidFiredCount = this.guardianRaidMechanics.fired.length;
    }
  }

  private tickFestivalPressure(): void {
    if (!this.festivalMode) return;
    if (this.awaitingExit && this.festivalMode === 'endless-descent' && !this.festivalChoiceSeen.has(this.room.index)) {
      this.festivalChoiceSeen.add(this.room.index);
      this.festivalChoiceRooms += Math.max(1, this.room.exits.length);
    }
    if (this.festivalMode === 'act-trials' && !this.festivalActSeen.has(this.room.index) && this.room.type !== 'entrance') {
      this.festivalActSeen.add(this.room.index);
      this.festivalActRooms += 1;
    }
    if (this.sim.time < this.nextFestivalPressureAt) return;

    if (this.festivalMode === 'hazard-survival') {
      this.spawnFestivalHazard('hazard');
      this.nextFestivalPressureAt += 14;
    } else if (this.festivalMode === 'act-trials') {
      this.spawnFestivalHazard('sigil');
      this.nextFestivalPressureAt += 18;
    } else if (this.festivalMode === 'endless-descent') {
      this.applyContinuumPulse();
      this.nextFestivalPressureAt += 20;
    }
  }

  private festivalCaster(): Unit | null {
    return this.enemyUids
      .map((uid) => this.sim.unit(uid))
      .find((u): u is Unit => !!u?.alive)
      ?? this.drivenUnit();
  }

  private partyCenter(): Vec2 {
    const alive = this.partyUids
      .map((uid) => this.sim.unit(uid))
      .filter((u): u is Unit => !!u?.alive);
    if (alive.length === 0) return { x: this.sim.bounds.w * 0.5, y: this.sim.bounds.h * 0.5 };
    return {
      x: alive.reduce((sum, u) => sum + u.pos.x, 0) / alive.length,
      y: alive.reduce((sum, u) => sum + u.pos.y, 0) / alive.length
    };
  }

  private spawnFestivalHazard(kind: 'hazard' | 'sigil'): void {
    const caster = this.festivalCaster();
    if (!caster) return;
    const isEnemyCaster = caster.team !== 0;
    const effects: EffectNode[] = [{
      kind: 'zone',
      at: 'point',
      zone: {
        shape: 'circle',
        radius: kind === 'hazard' ? 360 : 430,
        duration: kind === 'hazard' ? 6 : 7,
        tick: {
          interval: 1,
          affects: isEnemyCaster ? 'enemies' : 'all',
          effects: [{ kind: 'damage', dtype: 'magical', amount: kind === 'hazard' ? 22 : 16, target: 'target' }]
        },
        auraMods: kind === 'sigil' ? { affects: isEnemyCaster ? 'allies' : 'enemies', mods: { damagePct: 12, armor: 3 } } : undefined
      }
    }];
    execEffects(this.sim, caster, this.festivalCtx(kind), effects, { point: this.partyCenter() });
    this.festivalPulses += 1;
  }

  private applyContinuumPulse(): void {
    this.festivalPulses += 1;
    const caster = this.festivalCaster();
    if (!caster) return;
    const target = this.enemyUids
      .map((uid) => this.sim.unit(uid))
      .find((u): u is Unit => !!u?.alive);
    if (!target) return;
    execEffects(this.sim, caster, this.festivalCtx('continuum'), [{
      kind: 'statmod',
      target: 'self',
      duration: 8,
      mods: { moveSpeedPct: 18, attackSpeed: 24 }
    }], { target });
  }

  private festivalCtx(kind: string): EffectCtx {
    return {
      defId: `festival:${this.festivalMode}:${kind}`,
      level: 30,
      vfx: {
        archetype: kind === 'continuum' ? 'global-mark' : 'ground-aoe',
        color: this.festivalMode === 'hazard-survival' ? '#ff9d3a' : this.festivalMode === 'act-trials' ? '#ffd86a' : '#b88cff'
      }
    };
  }

  private guardianCtx(boss: Unit): EffectCtx {
    return {
      defId: `dungeon-guardian:${this.def.guardian}`,
      level: boss.level,
      vfx: { archetype: 'ground-aoe', color: '#ff7a3a', color2: '#ffd27a' }
    };
  }

  private completeCurrentRoom(): void {
    const completed = this.room;
    this.cleared.add(completed.index);
    this.completedRooms.push(completed);
    if (completed.index >= this.layout.depth - 1) {
      this.done = true;
      this.result = this.buildResult(true, false);
      return;
    }

    if (completed.type !== 'entrance' && completed.exits.length > 0) {
      this.awaitingExit = true;
      return;
    }

    const next = completed.exits[0] ?? completed.index + 1;
    this.currentRoomIndex = Math.min(next, this.layout.depth - 1);
    this.enterNextPlayableRoom();
  }

  private guardianReady(): boolean {
    return !!this.layout.endless && this.room.index < this.layout.depth - 1 && this.endlessProgress() >= 1;
  }

  private updatePacing(enemiesAlive: boolean): boolean {
    if (this.room.type === 'boss' || this.room.packs.length === 0 || this.awaitingExit || this.done) return false;
    if (enemiesAlive) {
      this.pacingPhase = 'peak';
      return true;
    }
    if (this.roomPackCursor >= this.room.packs.length) {
      this.pacingPhase = 'idle';
      return false;
    }
    if (this.pacingPhase !== 'relax') {
      this.pacingPhase = 'relax';
      this.nextPackAt = this.sim.time + 0.55;
      return true;
    }
    if (this.sim.time >= this.nextPackAt) {
      this.pacingPhase = 'build-up';
      this.spawnNextPack();
    }
    return true;
  }

  private buildResult(cleared: boolean, wiped: boolean): DungeonSessionResult {
    return {
      cleared,
      wiped,
      timeSec: this.sim.time,
      roomIndex: this.room.index,
      clearedRooms: [...this.cleared].sort((a, b) => a - b),
      guardianCleared: cleared && this.cleared.has(this.layout.depth - 1),
      endless: !!this.layout.endless,
      endlessLevel: this.layout.endlessLevel ?? 0,
      progress: this.endlessProgress(),
      hash: this.sim.hash()
    };
  }

  private roomTemplateFor(room = this.room): RoomTemplate {
    return this.roomTemplates.get(room.templateId) ?? syntheticTemplate(room.templateId, this.def.biome);
  }

  private checkDone(): void {
    if (this.awaitingExit) return;
    const partyAlive = heroesAlive(this.sim, 0).length;
    const enemiesAlive = this.enemyUids.some((uid) => this.sim.unit(uid)?.alive);
    if (partyAlive > 0 && this.updatePacing(enemiesAlive)) return;
    if (partyAlive > 0 && enemiesAlive && this.sim.tickCount < this.maxTicks) return;
    if (partyAlive > 0 && !enemiesAlive) {
      this.completeCurrentRoom();
      return;
    }
    this.done = true;
    this.result = this.buildResult(false, partyAlive === 0);
  }
}
