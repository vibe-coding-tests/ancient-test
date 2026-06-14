import type { Sim } from '../core/sim';
import type { SimEvent, Vec2 } from '../core/types';

// STORY §7.3 + §6.6 — story detectors live engine/Game-side and read the SimEvent stream
// the renderer already consumes. They never alter an event, a tick, or an outcome, so the
// determinism hash is untouched (same contract as the VFX/audio layers).

const ECHO_SLAM_ID = 'es-echo-slam';
const ECHO_SLAM_RADIUS = 650;
const PIT_RAID_ID = 'roshan-pit';
const HOOK_ID = 'pudge-meat-hook';
const HOOK_WINDOW_SEC = 5;       // a death this long after a hook still counts as "hooked home"
const PHASE_BREAK_PCT = 0.5;     // §6.6: the boss "breaks" at half health

export interface StoryObserveCtx {
  sim: Sim;
  nowSec: number;
  playerTeam: number;
  raidId?: string;       // set inside a raid encounter
  bossHeroId?: string;   // the boss/guardian hero in this encounter
  townPos?: Vec2;        // the player's base/fountain zone (overworld only)
  townRadius?: number;
}

export type StoryTrigger =
  | { kind: 'legend'; legendId: string }
  | { kind: 'boss-phase'; bossHeroId?: string; marqueeRaidId?: string };

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export class StoryDetector {
  private recentHooks: { atSec: number; casterUid: number }[] = [];
  private phaseFired = new Set<number>(); // boss uids whose break already fired this encounter

  /** Reset per-encounter state when a live fight begins. */
  beginEncounter(): void {
    this.phaseFired.clear();
    this.recentHooks = [];
  }

  observe(events: readonly SimEvent[], ctx: StoryObserveCtx): StoryTrigger[] {
    const out: StoryTrigger[] = [];
    // prune stale hook records
    this.recentHooks = this.recentHooks.filter((h) => ctx.nowSec - h.atSec <= HOOK_WINDOW_SEC);

    for (const ev of events) {
      if (ev.t === 'cast') {
        const legend = this.onCast(ev, ctx);
        if (legend) out.push(legend);
      } else if (ev.t === 'death') {
        const legend = this.onDeath(ev, ctx);
        if (legend) out.push(legend);
      }
    }

    // §6.6 boss phase break: poll the encounter boss HP after the events apply.
    out.push(...this.observeBossPhase(ctx));
    return out;
  }

  private onCast(ev: Extract<SimEvent, { t: 'cast' }>, ctx: StoryObserveCtx): StoryTrigger | null {
    const caster = ctx.sim.unit(ev.uid);
    if (!caster || caster.team !== ctx.playerTeam) return null;

    // Hooked Home — record a player Pudge hook; resolution happens on a later death.
    if (ev.abilityId === HOOK_ID) {
      this.recentHooks.push({ atSec: ctx.nowSec, casterUid: ev.uid });
      return null;
    }

    // The Pit Remembers — a player Echo Slam catching 4+ enemies inside Roshan's Pit.
    if (ev.abilityId === ECHO_SLAM_ID && ctx.raidId === PIT_RAID_ID) {
      let caught = 0;
      const r2 = ECHO_SLAM_RADIUS * ECHO_SLAM_RADIUS;
      for (const u of ctx.sim.unitsArr) {
        if (u.alive && u.team !== ctx.playerTeam && dist2(u.pos, caster.pos) <= r2) caught += 1;
      }
      if (caught >= 4) return { kind: 'legend', legendId: 'pit-remembers' };
    }
    return null;
  }

  private onDeath(ev: Extract<SimEvent, { t: 'death' }>, ctx: StoryObserveCtx): StoryTrigger | null {
    if (!ctx.townPos || this.recentHooks.length === 0) return null;
    const victim = ctx.sim.unit(ev.uid);
    if (!victim || victim.team === ctx.playerTeam) return null;
    const r = ctx.townRadius ?? 900;
    // "Hooked home": a recent player Pudge stands in the base/fountain zone as the victim dies.
    const homed = this.recentHooks.some((h) => {
      const pudge = ctx.sim.unit(h.casterUid);
      return !!pudge && pudge.alive && dist2(pudge.pos, ctx.townPos!) <= r * r;
    });
    return homed ? { kind: 'legend', legendId: 'hooked-home' } : null;
  }

  private observeBossPhase(ctx: StoryObserveCtx): StoryTrigger[] {
    const out: StoryTrigger[] = [];
    for (const u of ctx.sim.unitsArr) {
      if (u.team === ctx.playerTeam || u.ctrl.kind !== 'boss') continue;
      if (!u.alive) continue;
      if (this.phaseFired.has(u.uid)) continue;
      const frac = u.hp / Math.max(1, u.stats.maxHp);
      if (frac <= PHASE_BREAK_PCT) {
        this.phaseFired.add(u.uid);
        const marquee = ctx.raidId === 'void-prelate' || ctx.raidId === 'last-eldwurm' ? ctx.raidId : undefined;
        out.push({ kind: 'boss-phase', bossHeroId: ctx.bossHeroId, marqueeRaidId: marquee });
      }
    }
    return out;
  }
}
