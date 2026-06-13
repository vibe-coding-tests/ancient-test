import { REG } from '../core/registry';
import type { Game } from './game';

// ------------------------------------------------------------------
// Dev/QA harness, enabled only via ?debug in the URL. Buttons for the
// grindy parts of phase acceptance testing (gold/XP/heal). Not part
// of the player-facing game.
// ------------------------------------------------------------------

export function debugEnabled(): boolean {
  return new URLSearchParams(location.search).has('debug');
}

export function mountDebugPanel(game: Game): () => void {
  const el = document.createElement('div');
  el.id = 'debug-panel';
  el.style.cssText =
    'position:absolute;top:64px;right:10px;z-index:50;display:flex;flex-direction:column;gap:4px;' +
    'background:rgba(13,17,26,.92);border:1px solid #6b2e6b;border-radius:8px;padding:8px;pointer-events:auto;';
  el.innerHTML = `
    <b style="font-size:11px;color:#df7adf">DEBUG (?debug)</b>
    <button data-d="gold">+5000 gold</button>
    <button data-d="xp">+1200 XP (active)</button>
    <button data-d="heal">Heal party</button>
    <button data-d="hurt-creeps">Hurt nearby creeps to 20%</button>
  `;
  document.getElementById('ui-root')!.appendChild(el);

  el.addEventListener('click', (e) => {
    const d = (e.target as HTMLElement).dataset.d;
    const u = game.activeUnit();
    switch (d) {
      case 'gold':
        game.gold += 5000;
        game.msg('[debug] +5000 gold', 'info');
        break;
      case 'xp': {
        if (!u) break;
        const rec = game.party[game.activeIdx];
        const gained = u.addXp(1200);
        if (gained > 0) {
          u.autoLevelAbilities(REG.hero(rec.heroId).skillOrder);
          u.refresh(game.sim.time);
        }
        rec.level = u.level;
        rec.xp = u.xp;
        game.msg(`[debug] +1200 XP -> level ${u.level}`, 'info');
        break;
      }
      case 'heal':
        if (u) {
          u.hp = u.stats.maxHp;
          u.mana = u.stats.maxMana;
        }
        game.msg('[debug] healed', 'info');
        break;
      case 'hurt-creeps': {
        if (!u) break;
        let n = 0;
        for (const c of game.sim.unitsArr) {
          if (!c.alive || c.team !== 1 || !c.capturable) continue;
          const dx = c.pos.x - u.pos.x;
          const dy = c.pos.y - u.pos.y;
          if (Math.hypot(dx, dy) < 1200) {
            c.hp = c.stats.maxHp * 0.2;
            n++;
          }
        }
        game.msg(`[debug] ${n} creeps weakened`, 'info');
        break;
      }
    }
  });

  return () => el.remove();
}
