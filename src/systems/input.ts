import type { Game } from './game';
import type { Vec2 } from '../core/types';
import { TUNING } from '../data/tuning';
import { actionForEvent } from './keybindings';
import { castInvalidReasonLabel, resolveCastPreview, type CastPreviewInput } from '../core/cast-preview';

// ------------------------------------------------------------------
// Controls (SPEC §6): keyboard actions resolve through settings.keyBindings;
// an empty/old save falls back to the legacy layout.
// ------------------------------------------------------------------

const svgCursor = (svg: string, x: number, y: number, fallback: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

const CURSORS = {
  move: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="none" stroke="#ffd86a" stroke-width="2.4" d="M16 3v26M3 16h26"/><path fill="#59c0e0" d="m16 3 4 6h-8zm0 26-4-6h8zM3 16l6-4v8zm26 0-6 4v-8z"/></svg>', 16, 16, 'pointer'),
  attack: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="11" fill="none" stroke="#ff7a6a" stroke-width="2.4"/><path fill="none" stroke="#ffd86a" stroke-width="2" d="M16 1v8m0 14v8M1 16h8m14 0h8"/></svg>', 16, 16, 'crosshair'),
  cast: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="none" stroke="#73d9ff" stroke-width="2.4" d="M16 3 29 16 16 29 3 16z"/><circle cx="16" cy="16" r="4" fill="#ffd86a"/></svg>', 16, 16, 'cell'),
  loot: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#ffd86a" stroke="#080a0f" stroke-width="2" d="M16 3 29 12 24 28H8L3 12z"/></svg>', 16, 16, 'pointer')
} as const;

export type TargetingState =
  | { kind: 'none' }
  | { kind: 'ability'; slot: number }
  | { kind: 'item'; slot: number }
  | { kind: 'tag-swap'; slot: number };  // SWAP_COMBAT_OVERHAUL §3.3: aiming an aim-boon tag-in

export class InputController {
  /** current mouse position (client px) */
  mouseX = 0;
  mouseY = 0;
  hoverUid = -1;
  hoverItemUid = -1;
  hoverGround: Vec2 | null = null;
  inspectUid = -1;
  targeting: TargetingState = { kind: 'none' };

  /** UI layers can grab the keyboard (shop search etc.) */
  uiModalOpen = false;

  onToggleParty: () => void = () => {};
  onToggleShop: () => void = () => {};
  onToggleMenu: () => void = () => {};
  onToggleJournal: () => void = () => {};
  onToggleCodex: () => void = () => {};
  onToggleCharacter: () => void = () => {};
  onToggleHelp: () => void = () => {};

  private rmbHeld = false;
  private lastMoveOrderAt = 0;
  private attackMovePending = false;
  private clickQueued = false;
  private disposers: (() => void)[] = [];

  constructor(
    private game: Game,
    private canvas: HTMLCanvasElement
  ) {
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, el: Window | HTMLElement = window) => {
      el.addEventListener(t, fn as EventListener);
      this.disposers.push(() => el.removeEventListener(t, fn as EventListener));
    };

    on('contextmenu', (e) => e.preventDefault(), this.canvas);
    on('mousemove', (e) => {
      this.mouseX = (e as MouseEvent).clientX;
      this.mouseY = (e as MouseEvent).clientY;
    });
    on('mousedown', (e) => this.onMouseDown(e as MouseEvent), this.canvas);
    on('mouseup', (e) => {
      if ((e as MouseEvent).button === 2) this.rmbHeld = false;
    });
    on('wheel', (e) => {
      if (this.uiModalOpen) return;
      this.game.scene.zoomBy((e as WheelEvent).deltaY);
    }, this.canvas);
    on('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    on('keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    on('blur', () => {
      this.rmbHeld = false;
      this.game.setSprintHeld(false);
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.canvas.style.cursor = '';
  }

  attackMoveArmed(): boolean {
    return this.attackMovePending;
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.uiModalOpen
      ? ''
      : this.attackMovePending
        ? CURSORS.attack
        : this.targeting.kind !== 'none'
          ? CURSORS.cast
          : this.hoverItemUid >= 0
            ? CURSORS.loot
            : CURSORS.move;
  }

  /** re-pick at the current mouse position (also called on mousedown so
   *  clicks use exact click coords, not last frame's cached hover) */
  private refreshPick(): void {
    const pickableDrops = this.game.liveGym || this.game.liveRaid ? [] : this.game.visibleGroundItemDrops();
    const pick = this.game.scene.pick(this.mouseX, this.mouseY, this.game.inputSim(), pickableDrops);
    this.hoverUid = pick.uid ?? -1;
    this.hoverItemUid = pick.itemUid ?? -1;
    this.hoverGround = pick.ground ?? null;
  }

  /** called each frame: refresh hover pick + held-RMB move orders */
  update(): void {
    this.refreshPick();
    this.syncCastPreview();
    this.updateCursor();

    if (this.rmbHeld && !this.uiModalOpen) {
      const now = performance.now();
      if (now - this.lastMoveOrderAt > 150 && this.hoverGround) {
        this.lastMoveOrderAt = now;
        this.game.orderMove(this.hoverGround, false, false);
      }
    }
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.uiModalOpen) return;
    if (this.game.cinematic.active) {
      if (e.button === 0) {
        e.preventDefault();
        this.game.cinematicAdvance();
      }
      return;
    }
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.clickQueued = e.shiftKey;
    this.refreshPick();
    if (e.button === 2) {
      this.targeting = { kind: 'none' };
      this.attackMovePending = false;
      this.inspectUid = -1;
      this.rmbHeld = this.rightClick();
      this.lastMoveOrderAt = performance.now();
    } else if (e.button === 0) {
      this.leftClick();
    }
  }

  private rightClick(): boolean {
    const g = this.game;
    const sim = g.inputSim();
    const driver = g.controlledUnit();
    if (this.hoverItemUid >= 0) return g.tryPickupGroundItem(this.hoverItemUid) || true;
    if (this.hoverUid >= 0) {
      const target = sim.unit(this.hoverUid);
      if (!target) return false;
      if (g.liveGym && target.team === 0) {
        g.selectLiveGymUnit(target.uid);
        return false;
      }
      // npc hero -> recruit
      if (!g.liveGym && g.npcAt(this.hoverUid)) {
        g.tryRecruit(this.hoverUid);
        return false;
      }
      if (driver && target.team !== 0 && target.alive) {
        g.orderAttack(this.hoverUid, this.clickQueued);
        return false;
      }
    }
    if (driver && this.hoverGround) {
      g.orderMove(this.hoverGround, this.clickQueued);
      return true;
    }
    return false;
  }

  private leftClick(): void {
    const g = this.game;
    if (this.attackMovePending) {
      this.attackMovePending = false;
      this.inspectUid = -1;
      if (this.hoverUid >= 0) {
        const target = g.inputSim().unit(this.hoverUid);
        if (target && target.team !== 0 && target.alive) g.orderAttack(this.hoverUid, this.clickQueued);
      } else if (this.hoverGround) {
        g.orderAttackMove(this.hoverGround, this.clickQueued);
      }
      return;
    }
    // confirm pending targeted cast (non-quickcast mode)
    if (this.targeting.kind !== 'none') {
      this.fire(this.targeting);
      this.targeting = { kind: 'none' };
      this.inspectUid = -1;
      return;
    }
    // select hovered unit (info only; control stays on the hero)
    if (this.hoverItemUid >= 0) {
      g.tryPickupGroundItem(this.hoverItemUid);
      this.inspectUid = -1;
      return;
    }
    if (this.hoverUid >= 0) {
      if (g.liveGym) g.selectLiveGymUnit(this.hoverUid);
      // Recruit NPCs already say everything in the hover card; left-clicking one
      // used to just paint a green selection ring with no payoff, so leave the
      // selection on the hero and let right-click drive recruitment instead.
      if (g.npcAt(this.hoverUid)) {
        const u = g.controlledUnit() ?? g.activeUnit();
        if (u) g.scene.selectedUid = u.uid;
        this.inspectUid = -1;
      } else {
        g.scene.selectedUid = this.hoverUid;
        this.inspectUid = this.hoverUid;
      }
    } else {
      const u = g.controlledUnit() ?? g.activeUnit();
      if (u) g.scene.selectedUid = u.uid;
      this.inspectUid = -1;
    }
  }

  private fire(t: TargetingState): void {
    const g = this.game;
    const u = g.controlledUnit();
    if (!u || t.kind === 'none') return;
    if (t.kind === 'tag-swap') {
      g.trySwap(t.slot, { aimPoint: this.hoverGround ?? { ...u.pos } });
      return;
    }
    const opts = {
      uid: this.hoverUid >= 0 ? this.hoverUid : undefined,
      point: this.hoverGround ?? { ...u.pos }
    };
    if (t.kind === 'ability') {
      if (this.rejectInvalidAbilityTarget(t.slot, opts)) return;
      g.castAbility(t.slot, { ...opts, queued: this.clickQueued });
    } else {
      g.useItem(t.slot, { ...opts, queued: this.clickQueued });
    }
  }

  private rejectInvalidAbilityTarget(slot: number, opts: CastPreviewInput): boolean {
    const g = this.game;
    const u = g.controlledUnit();
    if (!u) return true;
    const a = u.abilities[slot];
    if (!a) return true;
    const preview = resolveCastPreview(g.inputSim(), u, a.def, a.level, opts);
    if (!preview.reason || preview.reason === 'out-of-range') return false;
    g.msg(castInvalidReasonLabel(preview.reason), 'bad');
    return true;
  }

  private syncCastPreview(): void {
    const g = this.game;
    const u = g.controlledUnit();
    if (!u || this.targeting.kind !== 'ability') {
      g.scene.clearCastPreview();
      return;
    }
    const a = u.abilities[this.targeting.slot];
    if (!a) {
      g.scene.clearCastPreview();
      return;
    }
    const target = this.hoverUid >= 0 ? g.inputSim().unit(this.hoverUid) : null;
    const point = target ? { ...target.pos } : this.hoverGround ?? { ...u.pos };
    const preview = resolveCastPreview(g.inputSim(), u, a.def, a.level, {
      uid: this.hoverUid >= 0 ? this.hoverUid : undefined,
      point
    });
    g.scene.setCastPreview(preview);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const action = actionForEvent(this.game.settings, e);
    if (this.game.cinematic.active) {
      if (key === ' ' || key === 'spacebar' || key === 'enter') {
        e.preventDefault();
        this.game.cinematicAdvance();
        return;
      }
      if (key === 'tab') {
        e.preventDefault();
        this.game.cinematicFastForward(true);
        return;
      }
      if (key === 'escape') {
        e.preventDefault();
        this.game.cinematicRequestSkip();
        return;
      }
    }
    if (action === 'sprint') {
      this.game.setSprintHeld(true);
      return;
    }
    if (key === 'escape' || action === 'menu') {
      if (this.attackMovePending) {
        this.attackMovePending = false;
        return;
      }
      if (this.targeting.kind !== 'none') {
        this.targeting = { kind: 'none' };
        return;
      }
      this.onToggleMenu();
      return;
    }
    if (this.uiModalOpen) {
      if (action === 'party' || action === 'shop' || action === 'help') {
        e.preventDefault();
        if (action === 'party') this.onToggleParty();
        else if (action === 'shop') this.onToggleShop();
        else this.onToggleHelp();
      }
      return;
    }

    const g = this.game;
    const u = g.controlledUnit();
    const queued = e.shiftKey;

    // Browser key-repeat should not keep re-issuing casts at the moving cursor.
    // This matters for ranged/channeled item quickcasts such as Meteor Hammer.
    if (e.repeat && (action?.startsWith('ability-') || action?.startsWith('item-'))) return;

    // hero swap
    if (action?.startsWith('swap-')) {
      const idx = Number(action.split('-')[1]) - 1;
      if (g.swapNeedsAim(idx)) {
        // §3.3: an aim boon opens a brief cursor; the click resolves the tag.
        if (g.settings.quickcast) {
          g.trySwap(idx, { aimPoint: this.hoverGround ?? undefined });
        } else {
          this.targeting = { kind: 'tag-swap', slot: idx };
          g.msg('Aim tag-in: click a target point', 'info');
        }
      } else {
        g.trySwap(idx);
      }
      return;
    }

    // abilities
    const abilityIdx = action?.startsWith('ability-') ? Number(action.split('-')[1]) - 1 : -1;
    if (abilityIdx >= 0 && u) {
      const a = u.abilities[abilityIdx];
      if (!a) return;
      const targeting = a.def.targeting;
      if (targeting === 'no-target' || targeting === 'toggle') {
        g.castAbility(abilityIdx, { queued });
      } else if (g.settings.quickcast) {
        this.fireAbilityQuick(abilityIdx, queued);
      } else {
        this.targeting = { kind: 'ability', slot: abilityIdx };
      }
      return;
    }

    if (action === 'journal') {
      this.onToggleJournal();
      return;
    }
    if (action === 'codex') {
      this.onToggleCodex();
      return;
    }
    if (action === 'character-sheet') {
      this.onToggleCharacter();
      return;
    }
    if (action === 'help') {
      e.preventDefault();
      this.onToggleHelp();
      return;
    }

    // items
    const itemIdx = action?.startsWith('item-') ? Number(action.split('-')[1]) - 1 : -1;
    if (itemIdx >= 0 && u && itemIdx < TUNING.activeItemSlots) {
      if (g.settings.quickcast) {
        g.useItem(itemIdx, {
          uid: this.hoverUid >= 0 ? this.hoverUid : undefined,
          point: this.hoverGround ?? { ...u.pos },
          queued
        });
      } else {
        this.targeting = { kind: 'item', slot: itemIdx };
      }
      return;
    }

    switch (action) {
      case 'capture': {
        if (g.liveGym || g.liveRaid) return;
        // capture hovered (or selected) creep
        const uid = this.hoverUid >= 0 ? this.hoverUid : g.scene.selectedUid;
        if (uid >= 0) g.tryCapture(uid);
        return;
      }
      case 'attack-move':
        if (!g.controlledUnit()) {
          if (g.liveGym) g.msg('Spend a Captain Call to issue orders', 'info');
          return;
        }
        this.attackMovePending = true;
        this.targeting = { kind: 'none' };
        g.msg('Attack-move: click a point or enemy', 'info');
        return;
      case 'interact':
        if (g.liveGym || g.liveRaid) return;
        g.tryInteract();
        return;
      case 'stop':
        g.orderStop();
        return;
      case 'dash':
        e.preventDefault();
        if (g.liveGym) {
          if (!g.controlledUnit()) g.liveGymPlayerCall(this.hoverUid >= 0 ? this.hoverUid : undefined);
          return;
        }
        g.tryDash(this.hoverGround ?? undefined);
        return;
      case 'camera-mode':
        g.scene.toggleCameraMode();
        return;
      case 'party':
        e.preventDefault();
        this.onToggleParty();
        return;
      case 'shop':
        if (g.liveGym || g.liveRaid) return;
        this.onToggleShop();
        return;
      case 'neutral':
        if (g.liveGym || g.liveRaid) return;
        g.useNeutralActive();
        return;
      case 'quicksave':
        e.preventDefault();
        g.saveToSlot(0);
        return;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    if (key === 'tab') {
      this.game.cinematicFastForward(false);
    }
    if (key === 'escape' && this.game.cinematic.active) {
      this.game.cinematicReleaseSkip();
    }
    if (actionForEvent(this.game.settings, e) === 'sprint') {
      this.game.setSprintHeld(false);
    }
  }

  private fireAbilityQuick(slot: number, queued = false): void {
    const g = this.game;
    const u = g.controlledUnit();
    if (!u) return;
    const a = u.abilities[slot];
    const targeting = a.def.targeting;
    if (targeting === 'unit-target') {
      if (this.hoverUid < 0) {
        g.msg('No target under cursor', 'bad');
        return;
      }
      if (this.rejectInvalidAbilityTarget(slot, { uid: this.hoverUid })) return;
      g.castAbility(slot, { uid: this.hoverUid, queued });
    } else {
      // point-target / skillshot / ground-aoe: cast at cursor ground
      if (!this.hoverGround && this.hoverUid < 0) {
        g.msg('No target point', 'bad');
        return;
      }
      const target = this.hoverUid >= 0 ? g.inputSim().unit(this.hoverUid) : null;
      const point = target ? { ...target.pos } : this.hoverGround!;
      if (this.rejectInvalidAbilityTarget(slot, { point, uid: this.hoverUid >= 0 ? this.hoverUid : undefined })) return;
      g.castAbility(slot, { point, uid: this.hoverUid >= 0 ? this.hoverUid : undefined, queued });
    }
  }
}
