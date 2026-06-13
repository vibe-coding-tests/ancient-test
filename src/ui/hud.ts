import { REG } from '../core/registry';
import { TUNING } from '../data/tuning';
import { xpProgress } from '../core/progression';
import { itemReady, sellValue, computeBuyPlan } from '../core/items';
import { levelArr } from '../core/values';
import { abilityIcon, itemIcon, heroPortrait } from '../engine/icons';
import { WORLD_SCALE } from '../engine/scale';
import { Game } from '../systems/game';
import type { InputController } from '../systems/input';
import type { ItemDef, SimEvent } from '../core/types';
import * as THREE from 'three';

// ------------------------------------------------------------------
// HUD: DOM overlay. Reads game state every frame; all interactions
// call back into Game. No game logic lives here.
// ------------------------------------------------------------------

const ABILITY_KEYS = ['Q', 'W', 'E', 'R', 'D', 'F'];
const ITEM_KEYS = ['Z', 'X', 'C', 'V', '·', '·'];

interface Floater {
  el: HTMLElement;
  simX: number;
  simY: number;
  born: number;
  rise: number;
}

export class Hud {
  root: HTMLElement;
  private topBar: HTMLElement;
  private partyCol: HTMLElement;
  private heroPanel: HTMLElement;
  private toastCol: HTMLElement;
  private captureBar: HTMLElement;
  private floaterLayer: HTMLElement;
  private modal: HTMLElement;
  private hint: HTMLElement;

  private floaters: Floater[] = [];
  private shownToasts = 0;
  private modalKind: 'none' | 'party' | 'shop' | 'menu' | 'talents' = 'none';
  private captureUntil = 0;
  private captureDur = 1;
  private vec = new THREE.Vector3();

  constructor(
    private game: Game,
    private input: InputController,
    private onQuitToTitle: () => void
  ) {
    this.root = document.getElementById('ui-root')!;
    this.root.innerHTML = `
      <div id="top-bar"></div>
      <div id="party-col"></div>
      <div id="toast-col"></div>
      <div id="floater-layer"></div>
      <div id="capture-bar" class="hidden"><div class="fill"></div><span>Binding...</span></div>
      <div id="hero-panel"></div>
      <div id="hud-hint"></div>
      <div id="modal-root" class="hidden"></div>
    `;
    this.topBar = this.root.querySelector('#top-bar')!;
    this.partyCol = this.root.querySelector('#party-col')!;
    this.heroPanel = this.root.querySelector('#hero-panel')!;
    this.toastCol = this.root.querySelector('#toast-col')!;
    this.captureBar = this.root.querySelector('#capture-bar')!;
    this.floaterLayer = this.root.querySelector('#floater-layer')!;
    this.modal = this.root.querySelector('#modal-root')!;
    this.hint = this.root.querySelector('#hud-hint')!;

    input.onToggleParty = () => this.toggleModal('party');
    input.onToggleShop = () => {
      if (!this.game.canShop() && this.modalKind !== 'shop') {
        this.game.msg('The shop is in Dawnshade (the town)', 'bad');
        return;
      }
      this.toggleModal('shop');
    };
    input.onToggleMenu = () => this.toggleModal('menu');
  }

  // ---------- per frame ----------

  update(): void {
    this.renderTopBar();
    this.renderParty();
    this.renderHeroPanel();
    this.renderToasts();
    this.handleEvents(this.game.frameEvents);
    this.updateFloaters();
    this.updateCaptureBar();
    this.renderHint();
    if (this.modalKind === 'shop' || this.modalKind === 'party') this.refreshModalDynamic();
    // auto-open talent picker
    if (this.modalKind === 'none') {
      const rec = this.game.party[this.game.activeIdx];
      if (rec && this.game.pendingTalentTier(rec) >= 0) this.toggleModal('talents');
    }
  }

  // ---------- top bar ----------

  private renderTopBar(): void {
    const g = this.game;
    const t = g.dayTime;
    const isNight = t >= 0.5;
    const clockPct = Math.round(((t % 0.5) / 0.5) * 100);
    this.topBar.innerHTML = `
      <span class="region">${g.region.name}</span>
      <span class="clock ${isNight ? 'night' : 'day'}">${isNight ? 'Night' : 'Day'} ${clockPct}%</span>
      <span class="gold">${Math.floor(g.gold)} g</span>
      <span class="keys-hint">RMB move/attack · QWER cast · ZXCV items · 1-5 swap · T capture · B shop · Tab party · M map · Esc menu</span>
    `;
  }

  // ---------- party frames ----------

  private renderParty(): void {
    const g = this.game;
    let html = '';
    g.party.forEach((rec, i) => {
      const def = REG.hero(rec.heroId);
      const active = i === g.activeIdx;
      const u = rec.unit;
      const hpPct = u ? (u.hp / u.stats.maxHp) * 100 : rec.hpPct * 100;
      const manaPct = u ? (u.stats.maxMana > 0 ? (u.mana / u.stats.maxMana) * 100 : 0) : rec.manaPct * 100;
      const dead = rec.respawnAt > g.sim.time;
      const deadIn = dead ? Math.ceil(rec.respawnAt - g.sim.time) : 0;
      html += `
        <div class="party-frame ${active ? 'active' : ''} ${dead ? 'dead' : ''}" data-swap="${i}">
          <img src="${heroPortrait(def.palette, def.name[0])}" alt="">
          <div class="pf-info">
            <div class="pf-name">${i + 1} ${def.name} <em>L${u ? u.level : rec.level}</em></div>
            <div class="bar hp"><div style="width:${hpPct}%"></div></div>
            <div class="bar mana"><div style="width:${manaPct}%"></div></div>
            ${dead ? `<div class="pf-dead">${deadIn}s</div>` : ''}
          </div>
        </div>`;
    });
    // entourage
    for (const instId of g.fielded) {
      const inst = g.caught.find((c) => c.uid === instId);
      if (!inst) continue;
      const def = REG.creep(inst.creepId);
      const simUid = g.fieldedUnits.get(instId);
      const u = simUid !== undefined ? g.sim.unit(simUid) : undefined;
      const hpPct = u && u.alive ? (u.hp / u.stats.maxHp) * 100 : 0;
      html += `
        <div class="party-frame creep">
          <img src="${heroPortrait(def.palette, def.name[0], 48)}" alt="">
          <div class="pf-info">
            <div class="pf-name">${def.name} <em>${'★'.repeat(inst.star)}</em></div>
            <div class="bar hp"><div style="width:${hpPct}%"></div></div>
          </div>
        </div>`;
    }
    if (this.partyCol.innerHTML !== html) {
      this.partyCol.innerHTML = html;
      this.partyCol.querySelectorAll('[data-swap]').forEach((el) => {
        el.addEventListener('click', () => g.trySwap(Number((el as HTMLElement).dataset.swap)));
      });
    }
  }

  // ---------- hero panel ----------

  private renderHeroPanel(): void {
    const g = this.game;
    const rec = g.party[g.activeIdx];
    const u = rec?.unit;
    if (!rec || !u) {
      this.heroPanel.innerHTML = '';
      return;
    }
    const def = REG.hero(rec.heroId);
    const now = g.sim.time;
    const xp = xpProgress(u.level, u.xp);

    let abilitiesHtml = '';
    u.abilities.forEach((a, i) => {
      if (i >= 6) return;
      const cdLeft = Math.max(0, a.cooldownUntil - now);
      const cdTotal = (levelArr(a.def.cooldown, Math.max(1, a.level), 1) || 1) * TUNING.cooldownScale;
      const cdPct = cdLeft > 0 ? Math.min(100, (cdLeft / cdTotal) * 100) : 0;
      const mana = a.level > 0 ? levelArr(a.def.manaCost, a.level, 0) * TUNING.manaCostScale : 0;
      const noMana = mana > 0 && u.mana < mana;
      const passive = ['passive', 'aura', 'attack-modifier'].includes(a.def.targeting);
      const toggledOn = a.toggled;
      abilitiesHtml += `
        <div class="ab-slot ${a.level <= 0 ? 'unlearned' : ''} ${noMana ? 'nomana' : ''} ${passive ? 'passive' : ''} ${toggledOn ? 'toggled' : ''}"
             title="${a.def.name}${a.def.lore ? ' — ' + a.def.lore : ''}">
          <img src="${abilityIcon(a.def)}" alt="">
          ${cdLeft > 0 ? `<div class="cd" style="height:${cdPct}%"></div><span class="cd-num">${cdLeft.toFixed(cdLeft > 5 ? 0 : 1)}</span>` : ''}
          <span class="hotkey">${passive ? '' : ABILITY_KEYS[i]}</span>
          <span class="ab-level">${'•'.repeat(Math.max(0, a.level))}</span>
          ${mana > 0 ? `<span class="ab-mana">${Math.round(mana)}</span>` : ''}
        </div>`;
    });

    let itemsHtml = '';
    u.items.forEach((it, i) => {
      const keyed = i < TUNING.activeItemSlots;
      if (!it) {
        itemsHtml += `<div class="item-slot empty ${keyed ? '' : 'passive-slot'}"><span class="hotkey">${ITEM_KEYS[i]}</span></div>`;
        return;
      }
      const idef = REG.item(it.defId);
      const ready = itemReady(it, idef, u, now);
      const cdLeft = Math.max(0, it.cooldownUntil - now);
      const lockout = !ready.ok && ready.reason === 'damage-lockout';
      itemsHtml += `
        <div class="item-slot ${keyed ? '' : 'passive-slot'} ${lockout ? 'lockout' : ''}" title="${idef.name} — ${idef.lore}">
          <img src="${itemIcon(idef)}" alt="">
          ${cdLeft > 0 ? `<span class="cd-num">${cdLeft.toFixed(cdLeft > 5 ? 0 : 1)}</span>` : ''}
          ${it.charges >= 0 ? `<span class="charges">${it.charges}</span>` : ''}
          <span class="hotkey">${keyed && idef.active ? ITEM_KEYS[i] : ''}</span>
        </div>`;
    });

    const talentPending = g.pendingTalentTier(rec) >= 0;

    this.heroPanel.innerHTML = `
      <div class="hp-left">
        <img class="portrait" src="${heroPortrait(def.palette, def.name[0])}" alt="">
        <div class="hp-id">
          <div class="hp-name">${def.name} <em>Lv ${u.level}</em>
            ${talentPending ? '<button class="talent-btn" id="talent-open">Talent!</button>' : ''}
          </div>
          <div class="bar hp big"><div style="width:${(u.hp / u.stats.maxHp) * 100}%"></div><span>${Math.ceil(u.hp)} / ${Math.ceil(u.stats.maxHp)}</span></div>
          <div class="bar mana big"><div style="width:${u.stats.maxMana > 0 ? (u.mana / u.stats.maxMana) * 100 : 0}%"></div><span>${Math.ceil(u.mana)} / ${Math.ceil(u.stats.maxMana)}</span></div>
          <div class="bar xp"><div style="width:${xp.pct * 100}%"></div></div>
          <div class="hp-stats">DMG ${Math.round(u.stats.damage)} · ARM ${u.stats.armor.toFixed(1)} · MS ${Math.round(u.stats.moveSpeed)}</div>
        </div>
      </div>
      <div class="ab-row">${abilitiesHtml}</div>
      <div class="item-grid">${itemsHtml}</div>
    `;
    this.heroPanel.querySelector('#talent-open')?.addEventListener('click', () => this.toggleModal('talents'));
  }

  // ---------- toasts ----------

  private renderToasts(): void {
    const g = this.game;
    while (this.shownToasts < g.toasts.length) {
      const t = g.toasts[this.shownToasts++];
      const el = document.createElement('div');
      el.className = `toast ${t.kind}`;
      el.textContent = t.text;
      this.toastCol.appendChild(el);
      setTimeout(() => el.classList.add('show'), 10);
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 400);
      }, t.kind === 'bark' ? 6000 : 3500);
      while (this.toastCol.children.length > 6) this.toastCol.children[0].remove();
    }
  }

  // ---------- floaters (damage numbers etc.) ----------

  private handleEvents(events: SimEvent[]): void {
    const g = this.game;
    for (const ev of events) {
      switch (ev.t) {
        case 'damage': {
          if (ev.amount < 1) break;
          const u = g.sim.unit(ev.uid);
          if (!u) break;
          const cls = ev.dtype === 'physical' ? 'phys' : ev.dtype === 'magical' ? 'mag' : 'pure';
          this.addFloater(u.pos.x, u.pos.y, `${Math.round(ev.amount)}${ev.crit ? '!' : ''}`, `dmg ${cls} ${ev.crit ? 'crit' : ''}`);
          break;
        }
        case 'heal': {
          if (ev.amount < 2) break;
          const u = g.sim.unit(ev.uid);
          if (u) this.addFloater(u.pos.x, u.pos.y, `+${Math.round(ev.amount)}`, 'healf');
          break;
        }
        case 'kill-credit': {
          if (ev.bounty.gold > 0) {
            const v = g.sim.unit(ev.victimUid);
            if (v) this.addFloater(v.pos.x, v.pos.y, `+${Math.round(ev.bounty.gold * (ev.lastHitByPlayer ? 1.15 : 1))}g`, 'goldf');
          }
          break;
        }
        case 'capture-start': {
          this.captureDur = ev.duration;
          this.captureUntil = g.sim.time + ev.duration;
          break;
        }
        case 'capture-interrupt': {
          this.captureUntil = 0;
          break;
        }
        case 'capture-complete': {
          this.captureUntil = 0;
          break;
        }
        case 'immune-block': {
          const u = g.sim.unit(ev.uid);
          if (u) this.addFloater(u.pos.x, u.pos.y, 'IMMUNE', 'immunef');
          break;
        }
        case 'miss': {
          const u = g.sim.unit(ev.target);
          if (u) this.addFloater(u.pos.x, u.pos.y, 'MISS', 'missf');
          break;
        }
        case 'bark': {
          const u = g.sim.unit(ev.uid);
          if (u) g.msg(`${u.name}: "${ev.line}"`, 'bark');
          break;
        }
        default:
          break;
      }
    }
  }

  private addFloater(simX: number, simY: number, text: string, cls: string): void {
    if (this.floaters.length > 50) return;
    const el = document.createElement('span');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.floaterLayer.appendChild(el);
    this.floaters.push({ el, simX, simY, born: performance.now(), rise: 0 });
  }

  private updateFloaters(): void {
    const now = performance.now();
    const cam = this.game.scene.camera;
    this.floaters = this.floaters.filter((f) => {
      const age = (now - f.born) / 1000;
      if (age > 1.1) {
        f.el.remove();
        return false;
      }
      this.vec.set(
        f.simX / WORLD_SCALE,
        this.game.scene.terrain.heightAt(f.simX, f.simY) + 2.2 + age * 1.5,
        f.simY / WORLD_SCALE
      );
      this.vec.project(cam);
      if (this.vec.z > 1) {
        f.el.style.display = 'none';
        return true;
      }
      const sx = (this.vec.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-this.vec.y * 0.5 + 0.5) * window.innerHeight;
      f.el.style.display = '';
      f.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`;
      f.el.style.opacity = String(Math.max(0, 1 - age / 1.1));
      return true;
    });
  }

  private updateCaptureBar(): void {
    const g = this.game;
    if (this.captureUntil > g.sim.time) {
      this.captureBar.classList.remove('hidden');
      const pct = 100 * (1 - (this.captureUntil - g.sim.time) / this.captureDur);
      (this.captureBar.querySelector('.fill') as HTMLElement).style.width = `${pct}%`;
    } else {
      this.captureBar.classList.add('hidden');
    }
  }

  private renderHint(): void {
    const g = this.game;
    let hint = '';
    if (this.input.hoverUid >= 0) {
      const u = g.sim.unit(this.input.hoverUid);
      if (u) {
        if (g.npcAt(u.uid)) hint = `${u.name} — right-click to recruit`;
        else if (u.capturable && u.tier) {
          const elig = g.captureEligible(u);
          hint = elig.ok ? `${u.name} — press T to capture!` : `${u.name} — capture: ${elig.reason}`;
        }
      }
    }
    if (this.input.targeting.kind !== 'none') hint = 'Choose a target (left-click) · Esc to cancel';
    if (g.canShop() && this.modalKind === 'none' && !hint) hint = 'Dawnshade — press B to shop';
    this.hint.textContent = hint;
    this.hint.classList.toggle('hidden', hint === '');
  }

  // ---------- modals ----------

  toggleModal(kind: 'party' | 'shop' | 'menu' | 'talents'): void {
    if (this.modalKind === kind) {
      this.closeModal();
      return;
    }
    this.modalKind = kind;
    this.input.uiModalOpen = true;
    this.modal.classList.remove('hidden');
    this.game.paused = kind === 'menu';
    if (kind === 'party') this.renderPartyModal();
    if (kind === 'shop') this.renderShopModal();
    if (kind === 'menu') this.renderMenuModal();
    if (kind === 'talents') this.renderTalentModal();
  }

  closeModal(): void {
    this.modalKind = 'none';
    this.input.uiModalOpen = false;
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
    this.game.paused = false;
  }

  private modalShell(title: string, body: string): void {
    this.modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-head"><h2>${title}</h2><button class="close-x" id="modal-close">✕</button></div>
        <div class="modal-body">${body}</div>
      </div>`;
    this.modal.querySelector('#modal-close')!.addEventListener('click', () => this.closeModal());
  }

  // --- party / creeps ---

  private renderPartyModal(): void {
    const g = this.game;
    let heroes = '';
    g.party.forEach((rec, i) => {
      const def = REG.hero(rec.heroId);
      heroes += `
        <div class="roster-row ${i === g.activeIdx ? 'active' : ''}">
          <img src="${heroPortrait(def.palette, def.name[0])}" alt="">
          <div class="rr-main">
            <b>${def.name}</b> <em>Lv ${rec.unit ? rec.unit.level : rec.level} · key ${i + 1}</em>
            <div class="rr-sub">${def.attribute.toUpperCase()} · ${def.roles.join(' / ')}</div>
          </div>
        </div>`;
    });

    let creeps = '';
    if (g.caught.length === 0) {
      creeps = `<p class="dim">No creeps caught yet. Weaken a wild creep below its capture threshold, then press <b>T</b>.</p>`;
    }
    for (const inst of g.caught) {
      const def = REG.creep(inst.creepId);
      const fielded = g.fielded.includes(inst.uid);
      const fainted = inst.faintedFor && inst.faintedFor > 0;
      creeps += `
        <div class="roster-row creep ${fielded ? 'fielded' : ''} ${fainted ? 'fainted' : ''}">
          <img src="${heroPortrait(def.palette, def.name[0], 48)}" alt="">
          <div class="rr-main">
            <b>${def.name} ${'★'.repeat(inst.star)}</b>
            <div class="rr-sub">${def.tier}${fainted ? ` · fainted ${Math.ceil(inst.faintedFor!)}s` : ''}</div>
          </div>
          <button class="btn small" data-field="${inst.uid}" ${fainted ? 'disabled' : ''}>
            ${fielded ? 'Recall' : 'Field'}
          </button>
        </div>`;
    }

    this.modalShell(
      'Party & Creeps',
      `
      <div class="party-modal-grid">
        <section><h3>Heroes (${g.party.length}/5)</h3>${heroes}</section>
        <section><h3>Creep Storage — fielded ${g.fielded.length}/${TUNING.entourageMax}</h3><div id="creep-list">${creeps}</div>
          <p class="dim">3 identical creeps merge into one ★ upgrade automatically.</p>
        </section>
      </div>`
    );
    this.modal.querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.field!;
        if (g.fielded.includes(id)) g.unfieldCreep(id);
        else g.fieldCreep(id);
        this.renderPartyModal();
      });
    });
  }

  // --- shop ---

  private shopTab: 'consumable' | 'component' | 'assembled' = 'assembled';

  private renderShopModal(): void {
    const g = this.game;
    const u = g.activeUnit();
    if (!u) return;
    const defs = g.region.shopInventory.map((id) => REG.item(id));
    const groups: Record<string, ItemDef[]> = { consumable: [], component: [], assembled: [] };
    for (const d of defs) {
      if (d.tier === 'consumable') groups.consumable.push(d);
      else if (d.components && d.components.length > 0) groups.assembled.push(d);
      else groups.component.push(d);
    }

    const tabs = (['assembled', 'component', 'consumable'] as const)
      .map((t) => `<button class="tab ${this.shopTab === t ? 'on' : ''}" data-tab="${t}">${t === 'assembled' ? 'Items' : t === 'component' ? 'Components' : 'Consumables'}</button>`)
      .join('');

    let grid = '';
    for (const d of groups[this.shopTab]) {
      const plan = computeBuyPlan(d, u, g.gold);
      const discounted = plan.goldCost < d.cost;
      grid += `
        <div class="shop-item ${plan.affordable && plan.fits ? '' : 'cant'}" data-buy="${d.id}"
             title="${d.name} — ${d.lore}${d.components?.length ? ' | Components: ' + d.components.map((c) => REG.item(c).name).join(', ') : ''}">
          <img src="${itemIcon(d)}" alt="">
          <div class="si-name">${d.name}</div>
          <div class="si-cost ${discounted ? 'discount' : ''}">${plan.goldCost} g</div>
        </div>`;
    }

    let sellRow = '';
    u.items.forEach((it, i) => {
      if (!it) return;
      const d = REG.item(it.defId);
      sellRow += `
        <div class="shop-item sell" data-sell="${i}" title="Sell ${d.name} for ${sellValue(d)} g">
          <img src="${itemIcon(d)}" alt=""><div class="si-cost">+${sellValue(d)} g</div>
        </div>`;
    });

    this.modalShell(
      `Dawnshade Shop — <span class="gold">${Math.floor(g.gold)} g</span>`,
      `
      <div class="shop-tabs">${tabs}</div>
      <div class="shop-grid">${grid}</div>
      <h3>Sell (active hero)</h3>
      <div class="shop-grid">${sellRow || '<p class="dim">Inventory empty.</p>'}</div>`
    );
    this.modal.querySelectorAll('[data-tab]').forEach((el) => {
      el.addEventListener('click', () => {
        this.shopTab = (el as HTMLElement).dataset.tab as typeof this.shopTab;
        this.renderShopModal();
      });
    });
    this.modal.querySelectorAll('[data-buy]').forEach((el) => {
      el.addEventListener('click', () => {
        g.buyItem((el as HTMLElement).dataset.buy!);
        this.renderShopModal();
      });
    });
    this.modal.querySelectorAll('[data-sell]').forEach((el) => {
      el.addEventListener('click', () => {
        g.sellItem(Number((el as HTMLElement).dataset.sell));
        this.renderShopModal();
      });
    });
  }

  /** cheap dynamic refresh for open shop/party (gold changes etc.) */
  private refreshModalDynamic(): void {
    const goldEl = this.modal.querySelector('.modal-head .gold');
    if (goldEl) goldEl.textContent = `${Math.floor(this.game.gold)} g`;
  }

  // --- talents ---

  private renderTalentModal(): void {
    const g = this.game;
    const recIdx = g.activeIdx;
    const rec = g.party[recIdx];
    if (!rec) {
      this.closeModal();
      return;
    }
    const def = REG.hero(rec.heroId);
    const tier = g.pendingTalentTier(rec);
    if (tier < 0) {
      this.closeModal();
      return;
    }
    const t = def.talents[tier];
    this.modalShell(
      `${def.name} — Level ${t.level} Talent`,
      `
      <div class="talent-choice">
        <button class="talent-opt" data-pick="0"><b>${t.options[0].name}</b></button>
        <div class="talent-or">or</div>
        <button class="talent-opt" data-pick="1"><b>${t.options[1].name}</b></button>
      </div>
      <p class="dim">The other branch stays echo-locked (Phase 2).</p>`
    );
    this.modal.querySelectorAll('[data-pick]').forEach((el) => {
      el.addEventListener('click', () => {
        g.applyTalent(recIdx, tier, Number((el as HTMLElement).dataset.pick) as 0 | 1);
        this.closeModal();
      });
    });
  }

  // --- menu (save/load/settings) ---

  private renderMenuModal(): void {
    const g = this.game;
    const slots = [0, 1, 2]
      .map((i) => {
        const info = Game_slotInfo(i);
        return `
        <div class="save-slot">
          <div class="ss-info">${info ? `<b>${info.name}</b> Lv ${info.level} · ${fmtTime(info.playtime)} · ${new Date(info.savedAt).toLocaleTimeString()}` : '<span class="dim">Empty slot</span>'}</div>
          <button class="btn small" data-save="${i}">Save</button>
          ${info ? `<button class="btn small" data-load="${i}">Load</button>` : ''}
        </div>`;
      })
      .join('');
    const auto = Game_slotInfo('auto');

    this.modalShell(
      'Menu',
      `
      <div class="menu-grid">
        <section>
          <h3>Save slots</h3>
          ${slots}
          <div class="save-slot"><div class="ss-info">${auto ? `<b>Autosave</b> — ${new Date(auto.savedAt).toLocaleTimeString()}` : '<span class="dim">No autosave yet</span>'}</div>
            ${auto ? '<button class="btn small" data-load="auto">Load</button>' : ''}
          </div>
        </section>
        <section>
          <h3>Options</h3>
          <label class="opt-row"><input type="checkbox" id="opt-quickcast" ${g.settings.quickcast ? 'checked' : ''}> Quick-cast at cursor</label>
          <button class="btn" id="export-save">Export save (JSON)</button>
          <label class="btn" for="import-file">Import save<input type="file" id="import-file" accept=".json" hidden></label>
          <button class="btn warn" id="quit-title">Quit to title</button>
          <p class="dim">Playtime ${fmtTime(Math.round(g.playtime))} · ${g.canSave().ok ? 'Safe to save' : g.canSave().reason}</p>
        </section>
      </div>`
    );

    this.modal.querySelectorAll('[data-save]').forEach((el) => {
      el.addEventListener('click', () => {
        if (g.saveToSlot(Number((el as HTMLElement).dataset.save))) this.renderMenuModal();
      });
    });
    this.modal.querySelectorAll('[data-load]').forEach((el) => {
      el.addEventListener('click', () => {
        const v = (el as HTMLElement).dataset.load!;
        const save = Game_loadSlot(v === 'auto' ? 'auto' : Number(v));
        if (save) {
          this.closeModal();
          window.dispatchEvent(new CustomEvent('ancients:load', { detail: save }));
        }
      });
    });
    this.modal.querySelector('#opt-quickcast')?.addEventListener('change', (e) => {
      g.settings.quickcast = (e.target as HTMLInputElement).checked;
    });
    this.modal.querySelector('#export-save')?.addEventListener('click', () => g.exportSave());
    this.modal.querySelector('#import-file')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      file.text().then((txt) => {
        try {
          const save = JSON.parse(txt) as unknown;
          if (!Game.validateSave(save)) throw new Error('bad save');
          window.dispatchEvent(new CustomEvent('ancients:load', { detail: save }));
        } catch {
          g.msg('Invalid save file', 'bad');
        }
      });
    });
    this.modal.querySelector('#quit-title')?.addEventListener('click', () => {
      this.closeModal();
      this.onQuitToTitle();
    });
  }

  dispose(): void {
    this.root.innerHTML = '';
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const Game_slotInfo = Game.slotInfo;
const Game_loadSlot = Game.loadSlot;
