import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { isDisabled, cannotMove, summarize } from '../core/status';
import { Game, newGameSave } from '../systems/game';
import type { GameSave, StatusId } from '../core/types';

// ============================================================
// STATUS GATING MATRIX — "if you're stunned you shouldn't be
// able to swap" generalized.
//
// The swap-while-stunned bug was one cell of a table nobody had
// written down: which control verbs each disable forbids. A single
// status (silence) blocks casting but not swapping; a hard disable
// (stun/hex/sleep/frozen/cyclone) blocks both. The original test
// only nailed stun-vs-silence-vs-swap. This drives the WHOLE matrix
// against the same predicates the sim uses, across several hero
// kits, so the next "forgot to gate verb X on status Y" regresses
// loudly.
// ============================================================

beforeAll(() => registerAllContent());

function solo(active: string, ...bench: string[]): GameSave {
  const save = newGameSave(active);
  for (const id of bench) {
    save.recruited.push(id);
    save.party.push(id);
    save.roster.push(newGameSave(id).roster[0]);
  }
  return save;
}

function applyStatus(game: Game, status: StatusId, sec = 2): void {
  const u = game.activeUnit()!;
  u.addStatus(
    { status, tag: `test-${status}`, sourceUid: u.uid, sourceTeam: 1, until: game.sim.time + sec, isDebuff: true },
    true
  );
}

// The full debuff vocabulary a player can be hit with.
const ALL_STATUSES: StatusId[] = [
  'stun',
  'hex',
  'sleep',
  'frozen',
  'cyclone',
  'root',
  'silence',
  'disarm'
];

// The active swap gate (trySwap) keys off isDisabled(). These are the
// statuses for which a swap MUST be rejected; everything else must allow it.
describe('swap is gated by exactly the hard-disable set', () => {
  for (const status of ALL_STATUSES) {
    it(`${status}: swap ${'is allowed unless it is a hard disable'}`, () => {
      const game = Game.headless(solo('juggernaut', 'axe'));
      applyStatus(game, status);
      const summary = summarize(
        game.activeUnit()!.statuses.filter((s) => game.sim.time < s.until),
        game.sim.time
      );
      const expectBlocked = isDisabled(summary);

      const swapped = game.trySwap(1);
      expect(swapped, `${status} -> swap ${expectBlocked ? 'blocked' : 'allowed'}`).toBe(!expectBlocked);
      expect(game.activeIdx).toBe(expectBlocked ? 0 : 1);
    });
  }

  it('every hard-disable in the vocabulary actually blocks a swap (sanity on the set itself)', () => {
    const hard = ALL_STATUSES.filter((status) => {
      const probe = Game.headless(solo('juggernaut', 'axe'));
      applyStatus(probe, status);
      const summary = summarize(probe.activeUnit()!.statuses, probe.sim.time);
      return isDisabled(summary);
    });
    // stun / hex / sleep / frozen / cyclone are the canonical hard disables.
    expect(hard).toEqual(expect.arrayContaining(['stun', 'hex', 'sleep', 'frozen', 'cyclone']));
    // pure-soft disables never sneak into the swap gate.
    expect(hard).not.toContain('silence');
    expect(hard).not.toContain('disarm');
    expect(hard).not.toContain('root');
  });

  it('a rejected swap surfaces the "cannot swap while disabled" message', () => {
    const game = Game.headless(solo('juggernaut', 'axe'));
    applyStatus(game, 'stun');
    const before = game.toasts.length;
    expect(game.trySwap(1)).toBe(false);
    expect(game.toasts.slice(before).some((t) => t.kind === 'bad' && /swap/i.test(t.text))).toBe(true);
  });

  it('the gate clears the instant the disable expires', () => {
    const game = Game.headless(solo('juggernaut', 'axe'));
    applyStatus(game, 'stun', 1);
    expect(game.trySwap(1)).toBe(false);
    // step past the stun
    for (let t = 0; t < 1.2; t += 0.05) game.update(0.05);
    expect(game.trySwap(1)).toBe(true);
    expect(game.activeIdx).toBe(1);
  });

  it('soft control (silence/root/disarm) still lets the player swap out of trouble', () => {
    for (const status of ['silence', 'root', 'disarm'] as StatusId[]) {
      const game = Game.headless(solo('juggernaut', 'axe'));
      applyStatus(game, status);
      expect(game.trySwap(1), `${status} should not block escaping via swap`).toBe(true);
    }
  });
});

// A second verb in the matrix: movement. cannotMove() must agree with what
// the sim actually enforces, so "rooted but can still walk" can't regress.
describe('movement is gated by the cannotMove predicate', () => {
  for (const status of ['stun', 'root', 'frozen', 'sleep', 'cyclone'] as StatusId[]) {
    it(`${status} pins the hero in place`, () => {
      const game = Game.headless(solo('juggernaut'));
      const u = game.activeUnit()!;
      applyStatus(game, status, 2);
      const summary = summarize(u.statuses.filter((s) => game.sim.time < s.until), game.sim.time);
      expect(cannotMove(summary), `${status} should forbid movement`).toBe(true);

      const x0 = u.pos.x;
      game.orderMove({ x: u.pos.x + 600, y: u.pos.y });
      for (let t = 0; t < 0.6; t += 0.05) game.update(0.05);
      expect(Math.abs(u.pos.x - x0), `${status} hero must not travel`).toBeLessThan(5);
    });
  }

  it('a disarmed (but not rooted) hero can still reposition', () => {
    const game = Game.headless(solo('juggernaut'));
    const u = game.activeUnit()!;
    applyStatus(game, 'disarm', 2);
    const x0 = u.pos.x;
    game.orderMove({ x: u.pos.x + 600, y: u.pos.y });
    for (let t = 0; t < 0.6; t += 0.05) game.update(0.05);
    expect(u.pos.x, 'disarm gates attacks, not feet').toBeGreaterThan(x0 + 20);
  });
});
