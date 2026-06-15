import type { GameSave, InputAction, KeyBindings } from '../core/types';

export const INPUT_ACTIONS: InputAction[] = [
  'attack-move',
  'stop',
  'dash',
  'sprint',
  'ability-1',
  'ability-2',
  'ability-3',
  'ability-4',
  'ability-5',
  'ability-6',
  'item-1',
  'item-2',
  'item-3',
  'item-4',
  'item-5',
  'item-6',
  'swap-1',
  'swap-2',
  'swap-3',
  'swap-4',
  'swap-5',
  'capture',
  'interact',
  'shop',
  'neutral',
  'party',
  'journal',
  'codex',
  'character-sheet',
  'camera-mode',
  'help',
  'quicksave',
  'menu'
];

export const DEFAULT_BINDINGS: Record<InputAction, string> = {
  'attack-move': 'a',
  stop: 's',
  dash: 'space',
  sprint: 'alt',
  'ability-1': 'q',
  'ability-2': 'w',
  'ability-3': 'e',
  'ability-4': 'r',
  'ability-5': 'd',
  'ability-6': 'f',
  'item-1': 'z',
  'item-2': 'x',
  'item-3': 'c',
  'item-4': 'v',
  'item-5': 'o',
  'item-6': 'p',
  'swap-1': '1',
  'swap-2': '2',
  'swap-3': '3',
  'swap-4': '4',
  'swap-5': '5',
  capture: 't',
  interact: 'g',
  shop: 'b',
  neutral: 'n',
  party: 'tab',
  journal: 'j',
  codex: 'k',
  'character-sheet': 'h',
  'camera-mode': 'm',
  help: 'f1',
  quicksave: 'f5',
  menu: 'escape'
};

export const ACTION_META: Record<InputAction, { label: string; group: 'Movement' | 'Abilities' | 'Items' | 'Party' | 'Interface'; locked?: boolean }> = {
  'attack-move': { label: 'Attack-move', group: 'Movement' },
  stop: { label: 'Stop', group: 'Movement' },
  dash: { label: 'Dash', group: 'Movement' },
  sprint: { label: 'Sprint', group: 'Movement' },
  'ability-1': { label: 'Ability 1', group: 'Abilities' },
  'ability-2': { label: 'Ability 2', group: 'Abilities' },
  'ability-3': { label: 'Ability 3', group: 'Abilities' },
  'ability-4': { label: 'Ability 4', group: 'Abilities' },
  'ability-5': { label: 'Ability 5', group: 'Abilities' },
  'ability-6': { label: 'Ability 6', group: 'Abilities' },
  'item-1': { label: 'Item 1', group: 'Items' },
  'item-2': { label: 'Item 2', group: 'Items' },
  'item-3': { label: 'Item 3', group: 'Items' },
  'item-4': { label: 'Item 4', group: 'Items' },
  'item-5': { label: 'Item 5', group: 'Items' },
  'item-6': { label: 'Item 6', group: 'Items' },
  'swap-1': { label: 'Swap hero 1', group: 'Party' },
  'swap-2': { label: 'Swap hero 2', group: 'Party' },
  'swap-3': { label: 'Swap hero 3', group: 'Party' },
  'swap-4': { label: 'Swap hero 4', group: 'Party' },
  'swap-5': { label: 'Swap hero 5', group: 'Party' },
  capture: { label: 'Capture', group: 'Interface' },
  interact: { label: 'Interact / travel', group: 'Interface' },
  shop: { label: 'Shop', group: 'Interface' },
  neutral: { label: 'Neutral active', group: 'Items' },
  party: { label: 'Party', group: 'Interface' },
  journal: { label: 'Journal', group: 'Interface' },
  codex: { label: 'Codex', group: 'Interface' },
  'character-sheet': { label: 'Character sheet', group: 'Interface' },
  'camera-mode': { label: 'Camera / map mode', group: 'Interface' },
  help: { label: 'Help overlay', group: 'Interface' },
  quicksave: { label: 'Quicksave', group: 'Interface' },
  menu: { label: 'Menu / cancel', group: 'Interface', locked: true }
};

const ACTION_SET = new Set<InputAction>(INPUT_ACTIONS);
const RESERVED_KEYS = new Set(['escape']);
// Actions removed from the game but still tolerated in legacy saves so a stored
// rebind doesn't invalidate the whole save. normalizeKeyBindings drops them on load.
const RETIRED_ACTIONS = new Set<string>(['services']);

export function normalizeKeyName(key: string): string {
  const lower = key.trim().toLowerCase();
  if (lower === '' || lower === ' ' || lower === 'spacebar') return 'space';
  if (lower === 'control') return 'ctrl';
  if (lower === 'option') return 'alt';
  if (lower === 'arrowup') return 'up';
  if (lower === 'arrowdown') return 'down';
  if (lower === 'arrowleft') return 'left';
  if (lower === 'arrowright') return 'right';
  return lower;
}

export function keyEventToBinding(e: KeyboardEvent): string {
  if (e.code === 'AltLeft' || e.code === 'AltRight') return 'alt';
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') return 'ctrl';
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'shift';
  if (e.code === 'MetaLeft' || e.code === 'MetaRight') return 'meta';
  return normalizeKeyName(e.key);
}

export function keyGlyph(key: string | undefined): string {
  if (!key) return '';
  const k = normalizeKeyName(key);
  const labels: Record<string, string> = {
    space: 'Space',
    tab: 'Tab',
    escape: 'Esc',
    alt: 'Alt',
    ctrl: 'Ctrl',
    shift: 'Shift',
    meta: 'Meta',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→'
  };
  if (labels[k]) return labels[k];
  if (/^f\d{1,2}$/.test(k)) return k.toUpperCase();
  return k.length === 1 ? k.toUpperCase() : k;
}

export function normalizeKeyBindings(bindings: KeyBindings | undefined): KeyBindings {
  const out: KeyBindings = {
    bindings: {},
    mouseMoveButton: bindings?.mouseMoveButton === 'left' ? 'left' : 'right'
  };
  for (const [action, key] of Object.entries(bindings?.bindings ?? {}) as [InputAction, string][]) {
    if (!ACTION_SET.has(action) || typeof key !== 'string') continue;
    const normalized = normalizeKeyName(key);
    if (!normalized) continue;
    out.bindings[action] = normalized;
  }
  return out;
}

export function resolvedBindings(settings: GameSave['settings']): Record<InputAction, string> {
  const custom = normalizeKeyBindings(settings.keyBindings).bindings;
  return { ...DEFAULT_BINDINGS, ...custom };
}

export function bindingForAction(settings: GameSave['settings'], action: InputAction): string {
  return resolvedBindings(settings)[action];
}

export function glyphForAction(settings: GameSave['settings'], action: InputAction): string {
  return keyGlyph(bindingForAction(settings, action));
}

export function actionForKey(settings: GameSave['settings'], key: string): InputAction | null {
  const normalized = normalizeKeyName(key);
  const bindings = resolvedBindings(settings);
  return INPUT_ACTIONS.find((action) => bindings[action] === normalized) ?? null;
}

export function actionForEvent(settings: GameSave['settings'], e: KeyboardEvent): InputAction | null {
  return actionForKey(settings, keyEventToBinding(e));
}

export function canRebindAction(action: InputAction): boolean {
  return !ACTION_META[action].locked;
}

export function rebindAction(settings: GameSave['settings'], action: InputAction, key: string): { ok: boolean; conflict?: InputAction; reason?: string } {
  if (!canRebindAction(action)) return { ok: false, reason: 'This binding is reserved.' };
  const normalized = normalizeKeyName(key);
  if (!normalized) return { ok: false, reason: 'Choose a key.' };
  if (RESERVED_KEYS.has(normalized)) return { ok: false, reason: 'That key is reserved.' };
  const bindings = resolvedBindings(settings);
  const conflict = INPUT_ACTIONS.find((candidate) => candidate !== action && bindings[candidate] === normalized && !ACTION_META[candidate].locked);
  if (conflict) return { ok: false, conflict };
  const next = normalizeKeyBindings(settings.keyBindings);
  if (DEFAULT_BINDINGS[action] === normalized) delete next.bindings[action];
  else next.bindings[action] = normalized;
  settings.keyBindings = next;
  return { ok: true };
}

export function resetKeyBindings(settings: GameSave['settings']): void {
  settings.keyBindings = normalizeKeyBindings(undefined);
}

export function isValidKeyBindings(value: unknown): value is KeyBindings {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const kb = value as Partial<KeyBindings>;
  if (kb.mouseMoveButton !== undefined && kb.mouseMoveButton !== 'right' && kb.mouseMoveButton !== 'left') return false;
  if (kb.bindings !== undefined) {
    if (!kb.bindings || typeof kb.bindings !== 'object') return false;
    for (const [action, key] of Object.entries(kb.bindings)) {
      if (RETIRED_ACTIONS.has(action)) continue;
      const normalized = typeof key === 'string' ? normalizeKeyName(key) : '';
      if (!ACTION_SET.has(action as InputAction) || normalized === '' || RESERVED_KEYS.has(normalized)) return false;
    }
  }
  const resolved = { ...DEFAULT_BINDINGS, ...Object.fromEntries(Object.entries(kb.bindings ?? {}).map(([action, key]) => [action, normalizeKeyName(String(key))])) };
  const seen = new Set<string>();
  for (const action of INPUT_ACTIONS) {
    const key = resolved[action];
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
