import './ui/styles.css';
import { registerAllContent } from './data';
import { Game } from './systems/game';
import { InputController } from './systems/input';
import { debugEnabled, mountDebugPanel } from './systems/debug';
import { Hud } from './ui/hud';
import { showTitle } from './ui/title';
import type { GameSave } from './core/types';

registerAllContent();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

let game: Game | null = null;
let input: InputController | null = null;
let hud: Hud | null = null;
let rafId = 0;
let tickTimer = 0;
let unmountDebug: (() => void) | null = null;

function teardown(): void {
  cancelAnimationFrame(rafId);
  clearInterval(tickTimer);
  input?.dispose();
  hud?.dispose();
  unmountDebug?.();
  game = null;
  input = null;
  hud = null;
  unmountDebug = null;
}

function startGame(save: GameSave): void {
  teardown();
  game = new Game(canvas, save);
  (window as unknown as { __game: Game }).__game = game;
  input = new InputController(game, canvas);
  hud = new Hud(game, input, () => {
    teardown();
    boot();
  });
  if (debugEnabled()) unmountDebug = mountDebugPanel(game);

  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    input!.update();
    game!.update(dt);
    hud!.update();
  };
  const loop = (): void => {
    rafId = requestAnimationFrame(loop);
    frame();
  };
  rafId = requestAnimationFrame(loop);
  // rAF stops entirely while the tab/view is hidden; keep simulating so the
  // world doesn't freeze mid-fight (Game.update clamps dt internally).
  tickTimer = window.setInterval(() => {
    if (performance.now() - last > 200) frame();
  }, 100);
}

function boot(): void {
  showTitle((save) => startGame(save));
}

window.addEventListener('ancients:load', (e) => {
  const save = (e as CustomEvent<GameSave>).detail;
  startGame(save);
});

boot();
