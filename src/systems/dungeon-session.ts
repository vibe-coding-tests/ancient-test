import { generateDungeon } from '../core/dungeon';
import { execEffects, type EffectCtx } from '../core/effects';
import { buildHero } from '../core/hero-setup';
import { heroesAlive } from '../core/macro';
import { v2 } from '../core/math2d';
import { tierScale } from '../core/phase3';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import { makeItemState, sortInventory } from '../core/items';
import { TUNING } from '../data/tuning';
import type { AffixDef, BossDef, DifficultyTier, DungeonDef, DungeonLayout, DungeonRoom, MacroHeroSetup, PlannedPack, RoomTemplate } from '../core/types';
import type { Unit } from '../core/unit';

const FALLBACK_ROOM_SIZE = { x: 4200, y: 3000 };
type DungeonPacingPhase = 'idle' | 'build-up' | 'peak' | 'relax';

const PACK_PROGRESS_WEIGHT: Record<PlannedPack['rarity'], number> = { normal: 1, champion: 3, rare: 6 };

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

export class DungeonSession {
  readonly def: DungeonDef;
  readonly tier: DifficultyTier;
  readonly layout: DungeonLayout;
  readonly sim: Sim;
  readonly partyUids: number[] = [];
  enemyUids: number[] = [];
  private readonly maxTicks: number;
  private readonly affixes: Map<string, AffixDef>;
  private readonly roomTemplates: Map<string, RoomTemplate>;
  private currentRoomIndex = 0;
  private readonly cleared = new Set<number>();
  private readonly completedRooms: DungeonRoom[] = [];
  private awaitingExit = false;
  private guardianUid: number | null = null;
  private guardianBossDef: BossDef | null = null;
  private readonly guardianPhaseKeys = new Set<string>();
  private roomPackCursor = 0;
  private roomSpawnedPacks = 0;
  private nextPackAt = 0;
  private pacingPhase: DungeonPacingPhase = 'idle';
  private readonly enemyWeight = new Map<number, number>();

  driverIdx = 0;
  done = false;
  result: DungeonSessionResult | null = null;
  guardianMechanicsFired: string[] = [];

  constructor(def: DungeonDef, party: MacroHeroSetup[], tier: DifficultyTier, seed: number, opts?: { maxSec?: number; modifiers?: string[]; endless?: boolean; endlessLevel?: number }) {
    this.def = def;
    this.tier = tier;
    const templates = registeredTemplates(def);
    this.layout = generateDungeon(def, tier, seed, { modifiers: opts?.modifiers, roomTemplates: templates, endless: opts?.endless, endlessLevel: opts?.endlessLevel });
    this.roomTemplates = templateMap(def, templates);
    this.sim = new Sim({ seed, bounds: roomBounds(this.roomTemplateFor(this.layout.rooms[0])) });
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
    return true;
  }

  exitsUnlocked(): boolean {
    return this.awaitingExit;
  }

  availableExits(): DungeonRoom[] {
    if (!this.awaitingExit) return [];
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

  chooseExit(index: number): boolean {
    if (this.done || !this.awaitingExit || !this.room.exits.includes(index)) return false;
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
      u.refresh(this.sim.time);
      u.hp = u.stats.maxHp;
      u.mana = u.stats.maxMana;
      this.partyUids.push(u.uid);
    });
  }

  private enterNextPlayableRoom(): void {
    while (!this.done && !this.awaitingExit) {
      const room = this.room;
      this.sim.bounds = roomBounds(this.roomTemplateFor(room));
      this.repositionParty();
      this.enemyUids = [];
      this.guardianUid = null;
      this.guardianBossDef = null;
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

  private spawnNextPack(): void {
    const pack = this.room.packs[this.roomPackCursor];
    if (!pack) return;
    const anchors = this.roomTemplateFor().spawnAnchors;
    const center = anchors[pack.anchorIndex % Math.max(1, anchors.length)] ?? { x: this.sim.bounds.w * 0.7, y: this.sim.bounds.h / 2 };
    const spawned: Unit[] = [];
    const weight = PACK_PROGRESS_WEIGHT[pack.rarity] ?? 1;
    pack.cards.forEach((card, i) => {
      const angle = (i / Math.max(1, pack.cards.length)) * Math.PI * 2;
      const pos = {
        x: center.x + Math.cos(angle) * 115,
        y: center.y + Math.sin(angle) * 115
      };
      const u = this.sim.spawnCreep(REG.creep(card.creepId), { team: 1, pos, star: card.star, wild: true, homePos: { ...center }, combatTier: this.tier });
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
        boss: { depth: TUNING.bossTierAiDepth[this.tier], enrageSec: 90 }
      }
    });
    for (const [k, v] of Object.entries(build.externalMods)) u.externalMods[k] = (u.externalMods[k] ?? 0) + v;
    u.items[0] = makeItemState(REG.item('black-king-bar'));
    u.items[1] = makeItemState(REG.item('assault-cuirass'));
    u.externalMods.maxHp = (u.externalMods.maxHp ?? 0) + u.stats.maxHp * (TUNING.raidBossHpScale * scale.hp - 1);
    u.externalMods.damagePct = (u.externalMods.damagePct ?? 0) + (TUNING.raidBossDamageScale * scale.damage - 1) * 100;
    if (TUNING.applyBossArmorTier) {
      u.externalMods.armor = (u.externalMods.armor ?? 0) + u.base.baseArmor * (scale.armor - 1);
    }
    u.radius = TUNING.unitRadiusHero * TUNING.raidBossRadiusScale;
    u.markStatsDirty();
    u.refresh(this.sim.time);
    u.hp = u.stats.maxHp;
    u.mana = u.stats.maxMana;
    u.facing = Math.PI;
    this.guardianUid = u.uid;
    this.enemyUids.push(u.uid);
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
