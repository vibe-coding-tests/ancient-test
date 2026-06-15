import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { REG } from '../core/registry';
import { TUNING } from '../data/tuning';
import { WORLD_SCALE } from '../engine/scale';
import { Game, newGameSave } from '../systems/game';
import type { GameSave } from '../core/types';
import type { Unit } from '../core/unit';

// ============================================================
// SWAP POSITIONING — the sim contract behind the "feet clip into
// the ground after a swap" bug.
//
// The visual fix lives in the renderer (snap the rig instead of
// lerping when a sim position jumps far). But the renderer only has
// to snap because the SIM teleports a returning off-field hero to
// the tag point in a single tick. If that teleport ever quietly
// became a glide (prevPos != pos, or a small delta), the render
// snap would stop firing and the clipping would silently return.
//
// These pin the sim invariant the renderer depends on: a swap-in
// places the hero AT the tag point with prevPos == pos (no stale
// interpolation source to drag a rig through terrain).
// ============================================================

beforeAll(() => registerAllContent());

const SNAP_SIM_DIST = 1.5 * WORLD_SCALE; // the renderer's teleport-snap threshold, in sim units

function bench(active: string, ...benched: string[]): GameSave {
  const save = newGameSave(active);
  for (const id of benched) {
    save.recruited.push(id);
    save.party.push(id);
    save.roster.push(newGameSave(id).roster[0]);
  }
  return save;
}

function engage(game: Game): void {
  const u = game.activeUnit();
  if (u) u.lastEnemyDamageAt = game.sim.time;
}

function spawnDummy(game: Game, dx = 120): Unit {
  const a = game.activeUnit()!;
  const e = game.sim.spawnCreep(REG.creep('kobold'), { team: 1, pos: { x: a.pos.x + dx, y: a.pos.y } });
  e.ctrl = { kind: 'none' };
  e.hp = e.stats.maxHp;
  return e;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('a swap-in lands the hero exactly at the tag point', () => {
  it('a returning off-field hero teleports to the tag point (far jump, prevPos == pos)', () => {
    const game = Game.headless(bench('warlock', 'juggernaut'));
    engage(game);
    spawnDummy(game, 120);

    // Bench Warlock off-field; it keeps its position on the bench.
    expect(game.trySwap(1)).toBe(true);
    const benched = game.party[0].unit!;
    expect(benched.offFieldUntil).toBeGreaterThan(game.sim.time);
    const benchedPos = { ...benched.pos };

    // Walk the active hero far away from where Warlock is sitting.
    const active = game.activeUnit()!;
    active.pos = { x: benchedPos.x + 4000, y: benchedPos.y + 1500 };
    active.prevPos = { ...active.pos };
    spawnDummy(game, 120); // keep combat hot near the new spot

    // Clear the swap floor, keep combat eligible, then swap BACK into Warlock.
    for (let t = 0; t < TUNING.resonanceSwapFloorSec + 0.1; t += 0.05) game.update(0.05);
    engage(game);
    const tagPoint = { ...game.activeUnit()!.pos };

    expect(game.trySwap(0)).toBe(true);
    const returned = game.party[0].unit!;

    // It must land AT the tag point (small walkable nudge tolerated), far from the bench.
    expect(dist(returned.pos, tagPoint), 'lands at the tag point').toBeLessThan(200);
    expect(dist(returned.pos, benchedPos), 'the move is a real teleport the renderer must snap').toBeGreaterThan(SNAP_SIM_DIST);

    // No stale interpolation source — prevPos must equal pos so the rig can't be
    // dragged through terrain on the first rendered frame.
    expect(returned.prevPos.x).toBe(returned.pos.x);
    expect(returned.prevPos.y).toBe(returned.pos.y);
  });

  it('a fresh (not off-field) swap also spawns the hero at the tag point with prevPos == pos', () => {
    const game = Game.headless(bench('juggernaut', 'axe'));
    const tagPoint = { ...game.activeUnit()!.pos };

    expect(game.trySwap(1)).toBe(true);
    const axe = game.activeUnit()!;
    expect(dist(axe.pos, tagPoint), 'spawns at the tag point').toBeLessThan(200);
    expect(axe.prevPos.x).toBe(axe.pos.x);
    expect(axe.prevPos.y).toBe(axe.pos.y);
  });
});
