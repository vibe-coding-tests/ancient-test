import { TUNING } from '../data/tuning';
import { REG } from './registry';
import { Sim } from './sim';
import { buildDefaultGambit } from './controllers';
import { autoPicksForLevel, buildHero } from './hero-setup';
import { makeItemState } from './items';
import type { GambitRule } from './types';
import type { Unit } from './unit';

// ------------------------------------------------------------------
// Macro layer (SPEC §7): 5v5 on a small arena, auto-resolving on the
// shared core. Headless-runnable to completion inside a test.
// ------------------------------------------------------------------

export interface MacroHeroSetup {
  heroId: string;
  level?: number;
  items?: string[];
  gambits?: GambitRule[];
}

export interface MacroSetup {
  seed: number;
  teamA: MacroHeroSetup[];
  teamB: MacroHeroSetup[];
  maxSec?: number;
}

export interface MacroResult {
  winner: 0 | 1 | -1;
  timeSec: number;
  ticks: number;
  survivors: { heroId: string; team: number; hpPct: number }[];
  hash: string;
  sim: Sim;
}

export function setupMacroSim(setup: MacroSetup): Sim {
  const sim = new Sim({
    seed: setup.seed,
    bounds: { w: TUNING.arenaWidth, h: TUNING.arenaHeight }
  });
  const placeTeam = (team: 0 | 1, list: MacroHeroSetup[]) => {
    const x = team === 0 ? 500 : TUNING.arenaWidth - 500;
    const spacing = TUNING.arenaHeight / (list.length + 1);
    list.forEach((h, i) => {
      const level = h.level ?? 10;
      const build = buildHero(REG.hero(h.heroId), autoPicksForLevel(level), 0);
      const u = sim.spawnHero(build.def, {
        team,
        pos: { x, y: spacing * (i + 1) },
        level,
        ctrl: {
          kind: 'gambit',
          rules: h.gambits ?? buildDefaultGambit(build.def.roles),
          homePos: { x, y: spacing * (i + 1) }
        }
      });
      for (const k in build.externalMods) {
        u.externalMods[k] = (u.externalMods[k] ?? 0) + build.externalMods[k];
      }
      u.facing = team === 0 ? 0 : Math.PI;
      for (const itemId of h.items ?? []) {
        const slot = u.items.findIndex((s) => s === null);
        if (slot >= 0) u.items[slot] = makeItemState(REG.item(itemId));
      }
      u.refresh(0);
      u.hp = u.stats.maxHp;
      u.mana = u.stats.maxMana;
    });
  };
  placeTeam(0, setup.teamA);
  placeTeam(1, setup.teamB);
  return sim;
}

export function heroesAlive(sim: Sim, team: number): Unit[] {
  return sim.unitsArr.filter((u) => u.alive && u.team === team && u.kind === 'hero');
}

export function runMacroBattle(setup: MacroSetup): MacroResult {
  const sim = setupMacroSim(setup);
  const maxSec = setup.maxSec ?? TUNING.macroMaxSec;
  const maxTicks = Math.round(maxSec / sim.dt);

  let winner: 0 | 1 | -1 = -1;
  while (sim.tickCount < maxTicks) {
    sim.tick();
    const a = heroesAlive(sim, 0).length;
    const b = heroesAlive(sim, 1).length;
    if (a === 0 || b === 0) {
      winner = a > 0 ? 0 : b > 0 ? 1 : -1;
      break;
    }
  }
  if (winner === -1) {
    // timeout: higher surviving hp% total wins
    const score = (team: number) => heroesAlive(sim, team).reduce((acc, u) => acc + u.hp / u.stats.maxHp, 0);
    const sa = score(0);
    const sb = score(1);
    winner = sa > sb ? 0 : sb > sa ? 1 : -1;
  }

  return {
    winner,
    timeSec: sim.time,
    ticks: sim.tickCount,
    survivors: sim.unitsArr
      .filter((u) => u.alive && u.kind === 'hero')
      .map((u) => ({ heroId: u.heroId ?? '?', team: u.team, hpPct: u.hp / u.stats.maxHp })),
    hash: sim.hash(),
    sim
  };
}
