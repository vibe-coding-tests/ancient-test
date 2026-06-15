import { describe, expect, it } from 'vitest';
import {
  ACTION_META,
  DEFAULT_BINDINGS,
  INPUT_ACTIONS,
  actionForKey,
  isValidKeyBindings,
  rebindAction,
  resolvedBindings
} from '../systems/keybindings';
import type { GameSave, InputAction } from '../core/types';

// ============================================================
// KEYBINDING INVARIANTS — the "J and G both open the journal"
// class.
//
// Two different actions resolving to the same physical key (or a
// key resolving to the wrong action) is exactly how the journal
// ended up reachable from two places. The defaults are hand-edited,
// so the only thing stopping a future collision is a test that
// refuses to let two actions share a key and that proves every key
// round-trips back to the one action that owns it.
// ============================================================

function settingsWith(bindings?: GameSave['settings']['keyBindings']): GameSave['settings'] {
  // Only the keyBindings field is read by the binding helpers.
  return { keyBindings: bindings } as unknown as GameSave['settings'];
}

describe('default keybindings are collision-free', () => {
  it('assigns every action a key', () => {
    for (const action of INPUT_ACTIONS) {
      expect(DEFAULT_BINDINGS[action], `${action} has a default key`).toBeTruthy();
    }
  });

  it('never binds two actions to the same physical key', () => {
    const byKey = new Map<string, InputAction[]>();
    for (const action of INPUT_ACTIONS) {
      const key = DEFAULT_BINDINGS[action];
      byKey.set(key, [...(byKey.get(key) ?? []), action]);
    }
    const collisions = [...byKey.entries()].filter(([, actions]) => actions.length > 1);
    expect(collisions, `key collisions: ${collisions.map(([k, a]) => `${k}=${a.join('+')}`).join(', ')}`).toEqual([]);
  });

  it('round-trips every default key back to exactly the action that owns it', () => {
    const settings = settingsWith(undefined);
    for (const action of INPUT_ACTIONS) {
      const key = DEFAULT_BINDINGS[action];
      expect(actionForKey(settings, key), `${key} must resolve to ${action}`).toBe(action);
    }
  });

  it('keeps Interact (G) and Journal (J) on distinct keys that do not cross-fire', () => {
    const settings = settingsWith(undefined);
    expect(DEFAULT_BINDINGS.interact).not.toBe(DEFAULT_BINDINGS.journal);
    expect(actionForKey(settings, DEFAULT_BINDINGS.interact)).toBe('interact');
    expect(actionForKey(settings, DEFAULT_BINDINGS.journal)).toBe('journal');
    // Pressing G never resolves to the journal and vice-versa.
    expect(actionForKey(settings, 'g')).not.toBe('journal');
    expect(actionForKey(settings, 'j')).not.toBe('interact');
  });

  it('passes its own validity check', () => {
    expect(isValidKeyBindings(undefined)).toBe(true);
    expect(isValidKeyBindings({ bindings: {}, mouseMoveButton: 'right' })).toBe(true);
  });
});

describe('rebinding cannot manufacture a collision', () => {
  it('refuses to rebind one action onto another action\'s key', () => {
    const settings = settingsWith(undefined);
    // Try to put Journal on G (already Interact). It must be rejected with the conflict.
    const res = rebindAction(settings, 'journal', DEFAULT_BINDINGS.interact);
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe('interact');
    // ...and nothing actually changed.
    expect(actionForKey(settings, DEFAULT_BINDINGS.interact)).toBe('interact');
  });

  it('a custom binding that resolves cleanly still round-trips and stays collision-free', () => {
    const settings = settingsWith(undefined);
    // Move Journal to an unused key.
    const used = new Set(Object.values(resolvedBindings(settings)));
    const free = 'i';
    expect(used.has(free)).toBe(false);

    expect(rebindAction(settings, 'journal', free).ok).toBe(true);
    expect(actionForKey(settings, free)).toBe('journal');
    expect(isValidKeyBindings(settings.keyBindings)).toBe(true);

    // The whole resolved table is still a bijection (no two actions share a key).
    const resolved = resolvedBindings(settings);
    const keys = INPUT_ACTIONS.map((a) => resolved[a]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('action metadata stays in sync with the action list', () => {
  it('every input action has UI metadata (label + group)', () => {
    for (const action of INPUT_ACTIONS) {
      expect(ACTION_META[action]?.label, `${action} label`).toBeTruthy();
      expect(ACTION_META[action]?.group, `${action} group`).toBeTruthy();
    }
  });
});
