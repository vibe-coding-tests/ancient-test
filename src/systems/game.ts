import { TUNING } from '../data/tuning';
import { REG } from '../core/registry';
import { Sim } from '../core/sim';
import { Unit } from '../core/unit';
import { buildHero } from '../core/hero-setup';
import { computeKillReward, overflowXpToGold } from '../core/progression';
import { mergeCreeps, newCreepInstanceId, validateEntourage } from '../core/capture';
import { computeBuyPlan, executeBuy, itemSaveOf, itemStateFromSave, sellValue, sortInventory } from '../core/items';
import { levelFromXp, xpForLevel } from '../core/stats';
import { dist } from '../core/math2d';
import type { CreepInstanceSave, GameSave, ItemSave, RegionDef, SimEvent, Vec2 } from '../core/types';
import { GameScene } from '../engine/scene';

// ------------------------------------------------------------------
// Overworld orchestration (SPEC layout: /src/systems/): party, swap,
// camps, capture/entourage, shop, shrine, day clock, save/load.
// ------------------------------------------------------------------

export const SAVE_VERSION = 1;
const SLOT_KEYS = ['ancients.save.1', 'ancients.save.2', 'ancients.save.3'];
const AUTO_KEY = 'ancients.save.auto';

export interface RosterEntry {
  heroId: string;
  level: number;
  xp: number;
  talentPicks: (0 | 1 | null)[];
  facetIdx: number;
  hpPct: number;
  manaPct: number;
  items: (ItemSave | null)[];
  abilityCooldowns: number[]; // remaining sec at serialize time
  benchedAt: number;          // game time at swap-out
  respawnAt: number;          // 0 = alive
  lastCombatAt: number;
  fleshStacks?: Record<string, number>;
  unit: Unit | null;
}

export interface Toast {
  text: string;
  kind: 'info' | 'good' | 'bad' | 'bark';
  at: number;
}

interface CampState {
  uids: number[];
  respawnAt: number; // 0 = alive/occupied
}

export function newGameSave(starterHeroId: string): GameSave {
  const region = REG.region('tranquil-vale');
  return {
    version: SAVE_VERSION,
    name: REG.hero(starterHeroId).name,
    createdAt: Date.now(),
    savedAt: Date.now(),
    playtimeSec: 0,
    worldSeed: region.seed,
    dayTime: 0.06, // just after dawn
    gold: TUNING.startingGold,
    regionId: region.id,
    playerPos: { x: region.town.pos.x, y: region.town.pos.y + 500 },
    party: [starterHeroId],
    activeIdx: 0,
    roster: [
      {
        heroId: starterHeroId,
        level: 1,
        xp: 0,
        items: [null, null, null, null, null, null],
        talentPicks: [null, null, null, null],
        facetIdx: 0,
        hpPct: 1,
        manaPct: 1,
        abilityCooldowns: [0, 0, 0, 0]
      }
    ],
    stash: [],
    caught: [],
    fielded: [],
    recruited: [starterHeroId],
    campRespawn: {},
    settings: { quickcast: true }
  };
}

export class Game {
  sim: Sim;
  scene: GameScene;
  region: RegionDef;

  gold = 0;
  dayTime = 0.06;
  playtime = 0;

  party: RosterEntry[] = [];
  activeIdx = 0;
  swapReadyAt = 0;

  caught: CreepInstanceSave[] = [];
  fielded: string[] = [];
  /** caught instance uid -> live sim uid */
  fieldedUnits = new Map<string, number>();
  recruited = new Set<string>();
  /** npc sim uid -> heroId */
  private npcHeroes = new Map<number, string>();

  private camps = new Map<string, CampState>();
  private accumulator = 0;
  private autosaveAt = TUNING.autosaveSec;
  private wasInTown = false;
  private faintTickAt = 0;
  private createdAt = 0;

  toasts: Toast[] = [];
  /** events the HUD wants this frame (damage floaters, gold, barks) */
  frameEvents: SimEvent[] = [];
  paused = false;

  constructor(canvas: HTMLCanvasElement, save: GameSave) {
    this.region = REG.region(save.regionId);
    this.scene = new GameScene(canvas, this.region);
    this.sim = new Sim({
      seed: save.worldSeed,
      bounds: { w: this.region.size, h: this.region.size },
      obstacles: this.scene.terrain.obstacles
    });

    this.gold = save.gold;
    this.dayTime = save.dayTime;
    this.playtime = save.playtimeSec;
    this.createdAt = save.createdAt;
    this.caught = save.caught.map((c) => ({ ...c }));
    this.recruited = new Set(save.recruited);

    this.party = save.party.map((heroId) => {
      const hs = save.roster.find((r) => r.heroId === heroId)!;
      return {
        heroId,
        level: hs.level,
        xp: hs.xp,
        talentPicks: [...hs.talentPicks],
        facetIdx: hs.facetIdx,
        hpPct: hs.hpPct,
        manaPct: hs.manaPct,
        items: hs.items.map((i) => (i ? { ...i } : null)),
        abilityCooldowns: [...hs.abilityCooldowns],
        benchedAt: 0,
        respawnAt: 0,
        lastCombatAt: -999,
        fleshStacks: hs.fleshStacks ? { ...hs.fleshStacks } : undefined,
        unit: null
      };
    });
    this.activeIdx = Math.min(save.activeIdx, this.party.length - 1);

    // world
    this.spawnCamps(save.campRespawn);
    this.spawnRecruitNpcs();

    // active hero
    const rec = this.party[this.activeIdx];
    const u = this.spawnHeroFromRecord(rec, save.playerPos);
    rec.unit = u;
    this.sim.playerActiveUid = u.uid;
    this.scene.selectedUid = u.uid;

    // entourage
    for (const instUid of save.fielded) {
      this.fieldCreep(instUid, true);
    }

    this.settings = { ...save.settings };
  }

  settings: { quickcast: boolean } = { quickcast: true };

  // ---------- helpers ----------

  activeUnit(): Unit | null {
    return this.party[this.activeIdx]?.unit ?? null;
  }

  msg(text: string, kind: Toast['kind'] = 'info'): void {
    this.toasts.push({ text, kind, at: performance.now() / 1000 });
    if (this.toasts.length > 60) this.toasts.splice(0, this.toasts.length - 60);
  }

  isNight(): boolean {
    return this.dayTime >= 0.5;
  }

  inTown(): boolean {
    const u = this.activeUnit();
    return !!u && dist(u.pos, this.region.town.pos) <= this.region.town.radius;
  }

  inCombat(): boolean {
    const u = this.activeUnit();
    if (!u) return false;
    return (
      this.sim.time - u.lastEnemyDamageAt < TUNING.combatLockSec ||
      this.sim.time - u.lastDealtDamageAt < TUNING.combatLockSec
    );
  }

  // ---------- world spawning ----------

  private spawnCamps(savedRespawn: Record<string, number>): void {
    for (const camp of this.region.camps) {
      const remaining = savedRespawn[camp.id];
      if (remaining !== undefined && remaining > 0) {
        this.camps.set(camp.id, { uids: [], respawnAt: this.sim.time + remaining });
      } else {
        this.camps.set(camp.id, { uids: this.spawnCampCreeps(camp.id), respawnAt: 0 });
      }
    }
  }

  private spawnCampCreeps(campId: string): number[] {
    const camp = this.region.camps.find((c) => c.id === campId)!;
    const def = REG.creep(camp.creepId);
    const uids: number[] = [];
    for (let i = 0; i < camp.count; i++) {
      const a = (i / camp.count) * Math.PI * 2;
      const r = camp.radius * 0.55;
      const pos = { x: camp.pos.x + Math.cos(a) * r, y: camp.pos.y + Math.sin(a) * r };
      const u = this.sim.spawnCreep(def, { team: 1, pos, wild: true, homePos: { ...camp.pos } });
      uids.push(u.uid);
    }
    return uids;
  }

  private spawnRecruitNpcs(): void {
    for (const spawn of this.region.heroSpawns) {
      if (this.recruited.has(spawn.heroId)) continue;
      const def = REG.hero(spawn.heroId);
      const u = new Unit({
        kind: 'npc',
        team: 0,
        name: def.name,
        attribute: def.attribute,
        base: { ...def.baseStats },
        pos: { ...spawn.pos },
        radius: TUNING.unitRadiusHero
      });
      u.visual = { silhouette: def.silhouette, palette: def.palette };
      u.ctrl = { kind: 'none' };
      u.refresh(0);
      u.hp = u.stats.maxHp;
      this.sim.addUnit(u);
      this.npcHeroes.set(u.uid, spawn.heroId);
    }
  }

  npcAt(uid: number): string | undefined {
    return this.npcHeroes.get(uid);
  }

  // ---------- hero spawn/serialize ----------

  private spawnHeroFromRecord(rec: RosterEntry, pos: Vec2): Unit {
    const build = buildHero(REG.hero(rec.heroId), rec.talentPicks, rec.facetIdx);
    const u = this.sim.spawnHero(build.def, {
      team: 0,
      pos: { ...pos },
      level: rec.level,
      ctrl: { kind: 'player' }
    });
    for (const k in build.externalMods) {
      u.externalMods[k] = (u.externalMods[k] ?? 0) + build.externalMods[k];
    }
    u.xp = Math.max(rec.xp, xpForLevel(rec.level));
    rec.items.forEach((s, i) => {
      u.items[i] = s ? itemStateFromSave(s, this.sim.time) : null;
    });
    u.items = sortInventory(u.items);
    if (rec.fleshStacks) {
      for (const k in rec.fleshStacks) u.triggerStacks.set(k, rec.fleshStacks[k]);
    }
    u.refresh(this.sim.time);
    u.hp = u.stats.maxHp * Math.max(0.05, rec.hpPct);
    u.mana = u.stats.maxMana * rec.manaPct;
    // bench cooldown rule: remaining = max(half of remaining-at-swap-out, remaining - benched time)
    const benched = rec.benchedAt > 0 ? this.sim.time - rec.benchedAt : 1e9;
    rec.abilityCooldowns.forEach((cd, i) => {
      if (!u.abilities[i] || cd <= 0) return;
      const remaining = Math.max(cd * TUNING.swapCdFloorPct, cd - benched);
      u.abilities[i].cooldownUntil = this.sim.time + remaining;
    });
    return u;
  }

  private serializeHero(rec: RosterEntry): void {
    const u = rec.unit;
    if (!u) return;
    rec.level = u.level;
    rec.xp = u.xp;
    rec.hpPct = u.alive ? u.hp / u.stats.maxHp : 0.5;
    rec.manaPct = u.stats.maxMana > 0 ? u.mana / u.stats.maxMana : 0;
    rec.items = u.items.map((it) => itemSaveOf(it, this.sim.time));
    rec.abilityCooldowns = u.abilities.map((a) =>
      a.cooldownUntil > this.sim.time ? a.cooldownUntil - this.sim.time : 0
    );
    rec.benchedAt = this.sim.time;
    if (u.triggerStacks.size > 0) {
      rec.fleshStacks = {};
      for (const [k, v] of u.triggerStacks) rec.fleshStacks[k] = v;
    }
  }

  // ---------- swap (1-5) ----------

  trySwap(idx: number): boolean {
    if (idx === this.activeIdx) return false;
    const rec = this.party[idx];
    if (!rec) return false;
    if (rec.respawnAt > this.sim.time) {
      this.msg(`${REG.hero(rec.heroId).name} respawns in ${Math.ceil(rec.respawnAt - this.sim.time)}s`, 'bad');
      return false;
    }
    if (this.sim.time < this.swapReadyAt) {
      this.msg(`Swap on cooldown (${(this.swapReadyAt - this.sim.time).toFixed(1)}s)`, 'bad');
      return false;
    }
    const cur = this.party[this.activeIdx];
    const pos: Vec2 = cur.unit
      ? { ...cur.unit.pos }
      : this.pendingSpawnPos ?? { ...this.region.shrine.pos };
    const facing = cur.unit?.facing ?? 0;

    if (cur.unit) {
      this.serializeHero(cur);
      cur.lastCombatAt = Math.max(
        cur.unit.lastDealtDamageAt,
        cur.unit.lastEnemyDamageAt,
        cur.lastCombatAt
      );
      this.sim.removeUnit(cur.unit.uid);
      cur.unit = null;
    }

    const u = this.spawnHeroFromRecord(rec, pos);
    u.facing = facing;
    rec.unit = u;
    rec.respawnAt = 0;
    this.activeIdx = idx;
    this.swapReadyAt = this.sim.time + TUNING.swapCooldownSec;
    this.sim.playerActiveUid = u.uid;
    this.scene.selectedUid = u.uid;
    this.retargetEntourage();
    return true;
  }

  private retargetEntourage(): void {
    const u = this.activeUnit();
    if (!u) return;
    for (const [, simUid] of this.fieldedUnits) {
      const c = this.sim.unit(simUid);
      if (c) c.ownerUid = u.uid;
    }
  }

  // ---------- orders from input ----------

  orderMove(point: Vec2): void {
    const u = this.activeUnit();
    if (!u || !u.alive) return;
    this.sim.order(u.uid, { kind: 'move', point });
  }

  orderAttack(uid: number): void {
    const u = this.activeUnit();
    if (!u || !u.alive) return;
    this.sim.order(u.uid, { kind: 'attack-unit', uid });
  }

  orderStop(): void {
    const u = this.activeUnit();
    if (!u) return;
    this.sim.order(u.uid, { kind: 'stop' });
  }

  castAbility(slot: number, opts: { uid?: number; point?: Vec2 }): void {
    const u = this.activeUnit();
    if (!u || !u.alive) return;
    const a = u.abilities[slot];
    if (!a || a.level <= 0) {
      this.msg('Ability not learned', 'bad');
      return;
    }
    const ready = u.abilityReady(slot, this.sim.time);
    if (!ready.ok) {
      this.msg(ready.reason === 'mana' ? 'Not enough mana' : ready.reason === 'cooldown' ? 'On cooldown' : `Cannot cast (${ready.reason})`, 'bad');
      return;
    }
    this.sim.order(u.uid, { kind: 'cast', slot, uid: opts.uid, point: opts.point });
  }

  useItem(invSlot: number, opts: { uid?: number; point?: Vec2 }): void {
    const u = this.activeUnit();
    if (!u || !u.alive) return;
    this.sim.order(u.uid, { kind: 'item', invSlot, uid: opts.uid, point: opts.point });
  }

  // ---------- capture ----------

  captureEligible(target: Unit): { ok: boolean; reason?: string } {
    if (!target.alive || !target.capturable || !target.tier) return { ok: false, reason: 'not capturable' };
    const cfg = TUNING.capture[target.tier];
    if (target.hp / target.stats.maxHp > cfg.hpPct) {
      return { ok: false, reason: `weaken below ${Math.round(cfg.hpPct * 100)}% HP` };
    }
    return { ok: true };
  }

  tryCapture(uid: number): void {
    const u = this.activeUnit();
    const target = this.sim.unit(uid);
    if (!u || !target) return;
    const elig = this.captureEligible(target);
    if (!elig.ok) {
      this.msg(`Cannot capture: ${elig.reason}`, 'bad');
      return;
    }
    this.sim.order(u.uid, { kind: 'capture', uid });
    this.msg(`Binding ${target.name}...`, 'info');
  }

  // ---------- recruitment (P1 placeholder, DECISIONS) ----------

  tryRecruit(uid: number): void {
    const heroId = this.npcHeroes.get(uid);
    const u = this.activeUnit();
    const npc = this.sim.unit(uid);
    if (!heroId || !u || !npc) return;
    if (dist(u.pos, npc.pos) > 350) {
      this.orderMove({ ...npc.pos });
      return;
    }
    if (this.party.length >= 5) {
      this.msg('Party is full (5 heroes)', 'bad');
      return;
    }
    this.sim.removeUnit(uid);
    this.npcHeroes.delete(uid);
    this.recruited.add(heroId);
    this.party.push({
      heroId,
      level: 1,
      xp: 0,
      talentPicks: [null, null, null, null],
      facetIdx: 0,
      hpPct: 1,
      manaPct: 1,
      items: [null, null, null, null, null, null],
      abilityCooldowns: [0, 0, 0, 0],
      benchedAt: 0,
      respawnAt: 0,
      lastCombatAt: -999,
      unit: null
    });
    const def = REG.hero(heroId);
    this.msg(`${def.name} joins the party! (key ${this.party.length})`, 'good');
    if (def.barks.length > 0) this.msg(`${def.name}: "${def.barks[0]}"`, 'bark');
    this.autosave('recruitment');
  }

  // ---------- entourage ----------

  fieldCreep(instanceUid: string, silent = false): boolean {
    const inst = this.caught.find((c) => c.uid === instanceUid);
    if (!inst) return false;
    if (this.fielded.includes(instanceUid)) return false;
    const next = [...this.fielded, instanceUid];
    const check = validateEntourage(next, this.caught, (id) => REG.creep(id).tier);
    if (!check.ok) {
      if (!silent) this.msg(`Cannot field: ${check.reason}`, 'bad');
      return false;
    }
    const owner = this.activeUnit();
    const def = REG.creep(inst.creepId);
    const pos = owner
      ? { x: owner.pos.x + 80 + Math.random() * 60, y: owner.pos.y + 80 + Math.random() * 60 }
      : { ...this.region.shrine.pos };
    const u = this.sim.spawnCreep(def, {
      team: 0,
      pos,
      star: inst.star,
      ownerUid: owner?.uid
    });
    u.visual = { silhouette: def.silhouette, palette: def.palette };
    this.fielded = next;
    this.fieldedUnits.set(instanceUid, u.uid);
    if (!silent) this.msg(`${def.name}${'★'.repeat(inst.star)} fielded`, 'good');
    return true;
  }

  unfieldCreep(instanceUid: string): void {
    const simUid = this.fieldedUnits.get(instanceUid);
    if (simUid !== undefined) {
      const u = this.sim.unit(simUid);
      if (u && u.alive) this.sim.removeUnit(simUid);
    }
    this.fieldedUnits.delete(instanceUid);
    this.fielded = this.fielded.filter((id) => id !== instanceUid);
  }

  // ---------- shop ----------

  shopOpen = false;

  canShop(): boolean {
    return this.inTown();
  }

  buyItem(itemId: string): void {
    const u = this.activeUnit();
    if (!u) return;
    const def = REG.item(itemId);
    const plan = computeBuyPlan(def, u, this.gold);
    if (!plan.affordable) {
      this.msg('Not enough gold', 'bad');
      return;
    }
    if (!plan.fits) {
      this.msg('Inventory full', 'bad');
      return;
    }
    const newGold = executeBuy(def, u, this.gold);
    if (newGold === null) {
      this.msg('Cannot buy', 'bad');
      return;
    }
    this.gold = newGold;
    this.msg(`Bought ${def.name}`, 'good');
  }

  sellItem(invSlot: number): void {
    const u = this.activeUnit();
    if (!u) return;
    const it = u.items[invSlot];
    if (!it) return;
    const def = REG.item(it.defId);
    u.items[invSlot] = null;
    u.items = sortInventory(u.items);
    this.gold += sellValue(def);
    this.msg(`Sold ${def.name} (+${sellValue(def)}g)`, 'info');
  }

  // ---------- talents ----------

  pendingTalentTier(rec: RosterEntry): number {
    const levels = [10, 15, 20, 25];
    for (let i = 0; i < 4; i++) {
      if (rec.level >= levels[i] && rec.talentPicks[i] === null) return i;
    }
    return -1;
  }

  applyTalent(recIdx: number, tier: number, pick: 0 | 1): void {
    const rec = this.party[recIdx];
    if (!rec || rec.talentPicks[tier] !== null) return;
    rec.talentPicks[tier] = pick;
    const def = REG.hero(rec.heroId);
    this.msg(`${def.name}: ${def.talents[tier].options[pick].name}`, 'good');
    // rebuild live unit in place to apply the patched def
    if (rec.unit) {
      const pos = { ...rec.unit.pos };
      const facing = rec.unit.facing;
      this.serializeHero(rec);
      this.sim.removeUnit(rec.unit.uid);
      const u = this.spawnHeroFromRecord(rec, pos);
      u.facing = facing;
      rec.unit = u;
      if (recIdx === this.activeIdx) {
        this.sim.playerActiveUid = u.uid;
        this.scene.selectedUid = u.uid;
        this.retargetEntourage();
      }
    }
  }

  // ---------- save / load ----------

  canSave(): { ok: boolean; reason?: string } {
    if (this.inCombat()) return { ok: false, reason: 'Cannot save in combat' };
    const u = this.activeUnit();
    if (!u || !u.alive) return { ok: false, reason: 'Active hero is down' };
    return { ok: true };
  }

  buildSave(): GameSave {
    const active = this.party[this.activeIdx];
    if (active.unit) this.serializeHero(active);
    return {
      version: SAVE_VERSION,
      name: REG.hero(this.party[0].heroId).name,
      createdAt: this.createdAt,
      savedAt: Date.now(),
      playtimeSec: Math.round(this.playtime),
      worldSeed: this.region.seed,
      dayTime: this.dayTime,
      gold: Math.round(this.gold),
      regionId: this.region.id,
      playerPos: active.unit ? { ...active.unit.pos } : { ...this.region.shrine.pos },
      party: this.party.map((r) => r.heroId),
      activeIdx: this.activeIdx,
      roster: this.party.map((r) => ({
        heroId: r.heroId,
        level: r.level,
        xp: r.xp,
        items: r.items.map((i) => (i ? { ...i } : null)),
        talentPicks: [...r.talentPicks],
        facetIdx: r.facetIdx,
        hpPct: r.hpPct,
        manaPct: r.manaPct,
        abilityCooldowns: [...r.abilityCooldowns],
        fleshStacks: r.fleshStacks ? { ...r.fleshStacks } : undefined
      })),
      stash: [],
      caught: this.caught.map((c) => ({ ...c })),
      fielded: [...this.fielded],
      recruited: [...this.recruited],
      campRespawn: this.campRespawnMap(),
      settings: { ...this.settings }
    };
  }

  private campRespawnMap(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, st] of this.camps) {
      if (st.respawnAt > this.sim.time) out[id] = st.respawnAt - this.sim.time;
    }
    return out;
  }

  saveToSlot(slot: number): boolean {
    const check = this.canSave();
    if (!check.ok) {
      this.msg(check.reason!, 'bad');
      return false;
    }
    localStorage.setItem(SLOT_KEYS[slot], JSON.stringify(this.buildSave()));
    this.msg(`Saved to slot ${slot + 1}`, 'good');
    return true;
  }

  autosave(reason: string): void {
    const u = this.activeUnit();
    if (!u || !u.alive) return;
    try {
      localStorage.setItem(AUTO_KEY, JSON.stringify(this.buildSave()));
      this.msg(`Autosaved (${reason})`, 'info');
    } catch {
      /* storage full/blocked: skip */
    }
  }

  static slotInfo(slot: number | 'auto'): { name: string; level: number; playtime: number; savedAt: number } | null {
    const key = slot === 'auto' ? AUTO_KEY : SLOT_KEYS[slot];
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as GameSave;
      const lead = s.roster[s.activeIdx] ?? s.roster[0];
      return { name: s.name, level: lead?.level ?? 1, playtime: s.playtimeSec, savedAt: s.savedAt };
    } catch {
      return null;
    }
  }

  static loadSlot(slot: number | 'auto'): GameSave | null {
    const key = slot === 'auto' ? AUTO_KEY : SLOT_KEYS[slot];
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as unknown;
      if (!Game.validateSave(s)) return null;
      return s;
    } catch {
      return null;
    }
  }

  static validateSave(s: unknown): s is GameSave {
    if (!s || typeof s !== 'object') return false;
    const v = s as Partial<GameSave>;
    if (v.version !== SAVE_VERSION) return false;
    if (typeof v.name !== 'string' || typeof v.createdAt !== 'number' || typeof v.savedAt !== 'number') return false;
    if (typeof v.playtimeSec !== 'number' || typeof v.worldSeed !== 'number' || typeof v.dayTime !== 'number') return false;
    if (typeof v.gold !== 'number' || typeof v.regionId !== 'string' || !REG.regions.has(v.regionId)) return false;
    if (!v.playerPos || typeof v.playerPos.x !== 'number' || typeof v.playerPos.y !== 'number') return false;
    if (!Array.isArray(v.party) || v.party.length < 1 || v.party.length > 5) return false;
    if (!Array.isArray(v.roster) || !Array.isArray(v.recruited) || !Array.isArray(v.caught) || !Array.isArray(v.fielded)) return false;
    if (typeof v.activeIdx !== 'number' || v.activeIdx < 0 || v.activeIdx >= v.party.length) return false;
    if (!v.settings || typeof v.settings.quickcast !== 'boolean') return false;
    for (const heroId of v.party) {
      if (typeof heroId !== 'string' || !REG.heroes.has(heroId)) return false;
      if (!v.roster.some((r) => r.heroId === heroId)) return false;
    }
    for (const r of v.roster) {
      if (!r || typeof r.heroId !== 'string' || !REG.heroes.has(r.heroId)) return false;
      if (!Array.isArray(r.items) || r.items.length !== TUNING.itemSlots) return false;
      if (!Array.isArray(r.talentPicks) || r.talentPicks.length !== 4) return false;
      if (!Array.isArray(r.abilityCooldowns)) return false;
    }
    for (const c of v.caught) {
      if (!c || typeof c.uid !== 'string' || typeof c.creepId !== 'string' || !REG.creeps.has(c.creepId)) return false;
      if (![1, 2, 3].includes(c.star)) return false;
    }
    return true;
  }

  exportSave(): void {
    const blob = new Blob([JSON.stringify(this.buildSave(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ancients-save-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- death / respawn ----------

  /** where the next swap-in should appear when the previous hero is already gone */
  private pendingSpawnPos: Vec2 | null = null;

  private handleHeroDeath(rec: RosterEntry): void {
    const respawnSec = 15 + rec.level * 3;
    rec.respawnAt = this.sim.time + respawnSec;
    this.serializeHero(rec);
    rec.hpPct = 0.5;
    rec.manaPct = 0.5;
    if (rec.unit) {
      this.pendingSpawnPos = { ...rec.unit.pos };
      const deadUid = rec.unit.uid;
      // let the death animation play, then clean up
      setTimeout(() => this.sim.removeUnit(deadUid), 2500);
      rec.unit = null;
    }

    const recIdx = this.party.indexOf(rec);
    const aliveIdx = this.party.findIndex((r, i) => i !== recIdx && r.respawnAt <= this.sim.time);
    if (aliveIdx >= 0) {
      this.msg(`${REG.hero(rec.heroId).name} has fallen! Swapping...`, 'bad');
      this.swapReadyAt = 0; // death swap is free
      this.trySwap(aliveIdx);
    } else {
      this.partyWipe();
    }
    this.pendingSpawnPos = null;
  }

  private partyWipe(): void {
    const tax = Math.round(this.gold * TUNING.deathGoldLossPct);
    this.gold -= tax;
    this.msg(`Party wiped! Lost ${tax} gold. Waking at the shrine...`, 'bad');
    for (const rec of this.party) {
      rec.respawnAt = 0;
      rec.hpPct = Math.max(rec.hpPct, 0.6);
      rec.manaPct = Math.max(rec.manaPct, 0.6);
    }
    // unfield entourage units (they re-field at the shrine)
    const fieldedNow = [...this.fielded];
    for (const id of fieldedNow) this.unfieldCreep(id);
    const rec = this.party[this.activeIdx];
    const u = this.spawnHeroFromRecord(rec, {
      x: this.region.shrine.pos.x + 120,
      y: this.region.shrine.pos.y + 120
    });
    rec.unit = u;
    this.sim.playerActiveUid = u.uid;
    this.scene.selectedUid = u.uid;
    for (const id of fieldedNow) this.fieldCreep(id, true);
  }

  // ---------- kill rewards ----------

  private handleKillCredit(ev: Extract<SimEvent, { t: 'kill-credit' }>): void {
    const killer = this.sim.unit(ev.killerUid);
    if (!killer || killer.team !== 0) return; // only player-team kills pay
    const states = this.party.map((rec, i) => ({
      heroId: rec.heroId,
      isActive: i === this.activeIdx,
      participated:
        i === this.activeIdx ||
        this.sim.time - rec.lastCombatAt <= TUNING.participantWindowSec
    }));
    const reward = computeKillReward(ev.bounty, states, ev.lastHitByPlayer);
    this.gold += reward.gold;
    for (const r of reward.perHeroXp) {
      const rec = this.party.find((p) => p.heroId === r.heroId)!;
      this.gold += overflowXpToGold(rec.level, rec.unit ? rec.unit.xp : rec.xp, r.xp);
      if (rec.unit) {
        const gained = rec.unit.addXp(r.xp);
        if (gained > 0) {
          rec.unit.autoLevelAbilities(REG.hero(rec.heroId).skillOrder);
          rec.unit.refresh(this.sim.time);
          // level-up heals the gained stats portion
          rec.unit.hp = Math.min(rec.unit.stats.maxHp, rec.unit.hp + gained * 80);
          this.scene.pushEvent({ t: 'levelup', uid: rec.unit.uid, level: rec.unit.level }, this.sim);
          this.msg(`${REG.hero(rec.heroId).name} reached level ${rec.unit.level}!`, 'good');
        }
        rec.level = rec.unit.level;
        rec.xp = rec.unit.xp;
      } else {
        rec.xp = Math.min(rec.xp + r.xp, xpForLevel(TUNING.levelCap));
        const newLevel = levelFromXp(rec.xp);
        if (newLevel > rec.level) {
          rec.level = newLevel;
          this.msg(`${REG.hero(rec.heroId).name} reached level ${newLevel}!`, 'good');
        }
      }
    }
  }

  private handleCaptureComplete(ev: Extract<SimEvent, { t: 'capture-complete' }>): void {
    const inst: CreepInstanceSave = { uid: newCreepInstanceId(), creepId: ev.creepId, star: 1 };
    this.caught.push(inst);
    const def = REG.creep(ev.creepId);
    this.msg(`Captured ${def.name}!`, 'good');
    const { list, merges } = mergeCreeps(this.caught);
    this.caught = list;
    for (const m of merges) {
      this.msg(`Merge! 3× ${REG.creep(m.creepId).name} → ${'★'.repeat(m.toStar)}`, 'good');
      // merged-away instances may have been fielded; clean up stale fielded refs
      this.fielded = this.fielded.filter((id) => this.caught.some((c) => c.uid === id));
      for (const [instId, simUid] of [...this.fieldedUnits]) {
        if (!this.caught.some((c) => c.uid === instId)) {
          const u = this.sim.unit(simUid);
          if (u && u.alive) this.sim.removeUnit(simUid);
          this.fieldedUnits.delete(instId);
        }
      }
    }
    this.autosave('capture');
  }

  // ---------- camps ----------

  private updateCamps(): void {
    for (const [id, st] of this.camps) {
      if (st.respawnAt > 0) {
        if (this.sim.time >= st.respawnAt) {
          const camp = this.region.camps.find((c) => c.id === id)!;
          const u = this.activeUnit();
          // don't respawn on the player's head
          if (u && dist(u.pos, camp.pos) < camp.radius + 600) {
            st.respawnAt = this.sim.time + 10;
            continue;
          }
          st.uids = this.spawnCampCreeps(id);
          st.respawnAt = 0;
        }
        continue;
      }
      // all dead (or captured) -> start respawn timer
      const anyAlive = st.uids.some((uid) => {
        const u = this.sim.unit(uid);
        return u && u.alive;
      });
      if (!anyAlive && st.uids.length > 0) {
        const camp = this.region.camps.find((c) => c.id === id)!;
        st.uids = [];
        st.respawnAt = this.sim.time + camp.respawnSec;
      }
    }
  }

  // ---------- shrine ----------

  private updateShrine(dt: number): void {
    const u = this.activeUnit();
    if (!u || !u.alive || this.inCombat()) return;
    if (dist(u.pos, this.region.shrine.pos) > 500) return;
    const rate = TUNING.shrineHealPctPerSec;
    u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.maxHp * rate * dt);
    u.mana = Math.min(u.stats.maxMana, u.mana + u.stats.maxMana * rate * dt);
    for (const [, simUid] of this.fieldedUnits) {
      const c = this.sim.unit(simUid);
      if (c && c.alive && dist(c.pos, this.region.shrine.pos) <= 500) {
        c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.maxHp * rate * dt);
      }
    }
  }

  // ---------- main update ----------

  update(realDt: number): void {
    if (this.paused) {
      this.scene.update(this.sim, this.activeUnit(), 0, this.dayTime);
      return;
    }
    const dt = Math.min(realDt, 0.1);
    this.playtime += dt;
    this.dayTime = (this.dayTime + dt / TUNING.dayLengthSec) % 1;

    // fixed-step sim
    this.accumulator += dt;
    while (this.accumulator >= this.sim.dt) {
      this.sim.tick();
      this.accumulator -= this.sim.dt;
    }

    // participation tracking for the active hero
    const activeRec = this.party[this.activeIdx];
    if (activeRec?.unit) {
      const u = activeRec.unit;
      if (this.sim.time - u.lastDealtDamageAt < 1 || this.sim.time - u.lastEnemyDamageAt < 1) {
        activeRec.lastCombatAt = this.sim.time;
      }
    }

    // drain + route events
    this.frameEvents = this.sim.events.drain();
    for (const ev of this.frameEvents) {
      this.scene.pushEvent(ev, this.sim);
      switch (ev.t) {
        case 'kill-credit':
          this.handleKillCredit(ev);
          break;
        case 'capture-complete':
          this.handleCaptureComplete(ev);
          break;
        case 'death': {
          // party hero?
          const rec = this.party.find((r) => r.unit && r.unit.uid === ev.uid);
          if (rec) {
            this.handleHeroDeath(rec);
            break;
          }
          // entourage creep?
          for (const [instId, simUid] of this.fieldedUnits) {
            if (simUid === ev.uid) {
              const inst = this.caught.find((c) => c.uid === instId);
              if (inst) {
                inst.faintedFor = TUNING.entourageFaintSec;
                this.msg(`${REG.creep(inst.creepId).name} fainted (back in ${TUNING.entourageFaintSec}s)`, 'bad');
              }
              this.fieldedUnits.delete(instId);
              this.fielded = this.fielded.filter((id) => id !== instId);
            }
          }
          break;
        }
        default:
          break;
      }
    }

    // faint timers (1 Hz)
    if (this.sim.time >= this.faintTickAt) {
      const step = this.sim.time - (this.faintTickAt - 1);
      this.faintTickAt = this.sim.time + 1;
      for (const c of this.caught) {
        if (c.faintedFor && c.faintedFor > 0) {
          c.faintedFor = Math.max(0, c.faintedFor - step);
          if (c.faintedFor === 0) {
            c.faintedFor = undefined;
            this.msg(`${REG.creep(c.creepId).name} recovered`, 'info');
          }
        }
      }
    }

    this.updateCamps();
    this.updateShrine(dt);

    // town-entry autosave
    const inTownNow = this.inTown();
    if (inTownNow && !this.wasInTown) this.autosave('town');
    this.wasInTown = inTownNow;

    // timer autosave
    if (this.playtime >= this.autosaveAt) {
      this.autosaveAt = this.playtime + TUNING.autosaveSec;
      if (!this.inCombat()) this.autosave('timer');
    }

    this.scene.update(this.sim, this.activeUnit(), dt, this.dayTime);
  }
}
