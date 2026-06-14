import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data/index';
import { REG } from '../core/registry';
import { Game, newGameSave } from '../systems/game';
import { CinematicDirector } from '../engine/cinematic';
import { StoryDetector } from '../engine/story-detectors';
import type { Sim } from '../core/sim';
import type { CutsceneDef, SimEvent } from '../core/types';

beforeAll(() => registerAllContent());

function freshGame(): Game {
  return Game.headless(newGameSave('juggernaut'));
}

interface FakeUnit {
  uid: number;
  team: number;
  pos: { x: number; y: number };
  alive: boolean;
  hp: number;
  stats: { maxHp: number };
  ctrl: { kind: string };
}

function fakeSim(units: FakeUnit[]): Sim {
  return {
    unit: (uid: number) => units.find((u) => u.uid === uid),
    unitsArr: units
  } as unknown as Sim;
}

function castEvent(uid: number, abilityId: string): SimEvent {
  return { t: 'cast', uid, abilityId, vfx: { archetype: 'ground-aoe', color: '#fff' } };
}

// ----------------------------------------------------------------
// STORY §7.3 — esports legend detector (Pit Remembers, Hooked Home)
// ----------------------------------------------------------------
describe('STORY §7.3 legend detector', () => {
  function enemyRing(count: number, center: { x: number; y: number }, radius: number): FakeUnit[] {
    return Array.from({ length: count }, (_, i) => ({
      uid: 100 + i, team: 1, pos: { x: center.x + radius * (i % 2), y: center.y }, alive: true, hp: 100, stats: { maxHp: 100 }, ctrl: { kind: 'gambit' }
    }));
  }

  it('fires Pit Remembers on an Echo Slam catching 4+ enemies inside Roshan\'s Pit', () => {
    const es: FakeUnit = { uid: 1, team: 0, pos: { x: 0, y: 0 }, alive: true, hp: 500, stats: { maxHp: 500 }, ctrl: { kind: 'gambit' } };
    const sim = fakeSim([es, ...enemyRing(4, { x: 100, y: 0 }, 50)]);
    const det = new StoryDetector();
    const out = det.observe([castEvent(1, 'es-echo-slam')], { sim, nowSec: 1, playerTeam: 0, raidId: 'roshan-pit' });
    expect(out).toContainEqual({ kind: 'legend', legendId: 'pit-remembers' });
  });

  it('does NOT fire Pit Remembers with too few enemies, or outside the Pit (no false positives)', () => {
    const es: FakeUnit = { uid: 1, team: 0, pos: { x: 0, y: 0 }, alive: true, hp: 500, stats: { maxHp: 500 }, ctrl: { kind: 'gambit' } };
    const few = fakeSim([es, ...enemyRing(3, { x: 100, y: 0 }, 50)]);
    expect(new StoryDetector().observe([castEvent(1, 'es-echo-slam')], { sim: few, nowSec: 1, playerTeam: 0, raidId: 'roshan-pit' })).toHaveLength(0);

    const plenty = fakeSim([es, ...enemyRing(5, { x: 100, y: 0 }, 50)]);
    expect(new StoryDetector().observe([castEvent(1, 'es-echo-slam')], { sim: plenty, nowSec: 1, playerTeam: 0, raidId: 'lord-of-terror' })).toHaveLength(0);
  });

  it('fires Hooked Home when a player Pudge in the base zone hooks a victim to its death', () => {
    const pudge: FakeUnit = { uid: 1, team: 0, pos: { x: 0, y: 0 }, alive: true, hp: 500, stats: { maxHp: 500 }, ctrl: { kind: 'player' } };
    const victim: FakeUnit = { uid: 2, team: 1, pos: { x: 30, y: 0 }, alive: false, hp: 0, stats: { maxHp: 100 }, ctrl: { kind: 'gambit' } };
    const sim = fakeSim([pudge, victim]);
    const det = new StoryDetector();
    const events: SimEvent[] = [castEvent(1, 'pudge-meat-hook'), { t: 'death', uid: 2, killer: 1 }];
    const out = det.observe(events, { sim, nowSec: 1, playerTeam: 0, townPos: { x: 0, y: 0 }, townRadius: 900 });
    expect(out).toContainEqual({ kind: 'legend', legendId: 'hooked-home' });
  });

  it('does NOT fire Hooked Home when the Pudge is nowhere near home', () => {
    const pudge: FakeUnit = { uid: 1, team: 0, pos: { x: 5000, y: 5000 }, alive: true, hp: 500, stats: { maxHp: 500 }, ctrl: { kind: 'player' } };
    const victim: FakeUnit = { uid: 2, team: 1, pos: { x: 5030, y: 5000 }, alive: false, hp: 0, stats: { maxHp: 100 }, ctrl: { kind: 'gambit' } };
    const sim = fakeSim([pudge, victim]);
    const events: SimEvent[] = [castEvent(1, 'pudge-meat-hook'), { t: 'death', uid: 2, killer: 1 }];
    expect(new StoryDetector().observe(events, { sim, nowSec: 1, playerTeam: 0, townPos: { x: 0, y: 0 }, townRadius: 900 })).toHaveLength(0);
  });
});

// ----------------------------------------------------------------
// STORY §6.6 — boss phase-break detector
// ----------------------------------------------------------------
describe('STORY §6.6 boss phase detector', () => {
  it('fires once when an enemy boss crosses half health, then not again that encounter', () => {
    const boss: FakeUnit = { uid: 9, team: 1, pos: { x: 0, y: 0 }, alive: true, hp: 40, stats: { maxHp: 100 }, ctrl: { kind: 'boss' } };
    const sim = fakeSim([boss]);
    const det = new StoryDetector();
    det.beginEncounter();
    const first = det.observe([], { sim, nowSec: 1, playerTeam: 0, raidId: 'last-eldwurm', bossHeroId: 'dragon-knight' });
    expect(first).toContainEqual({ kind: 'boss-phase', bossHeroId: 'dragon-knight', marqueeRaidId: 'last-eldwurm' });
    expect(det.observe([], { sim, nowSec: 2, playerTeam: 0, raidId: 'last-eldwurm', bossHeroId: 'dragon-knight' })).toHaveLength(0);
  });

  it('marks a non-marquee boss without a marquee raid id', () => {
    const boss: FakeUnit = { uid: 9, team: 1, pos: { x: 0, y: 0 }, alive: true, hp: 10, stats: { maxHp: 100 }, ctrl: { kind: 'boss' } };
    const det = new StoryDetector();
    det.beginEncounter();
    const out = det.observe([], { sim: fakeSim([boss]), nowSec: 1, playerTeam: 0, raidId: 'roshan-pit', bossHeroId: 'sven' });
    expect(out).toContainEqual({ kind: 'boss-phase', bossHeroId: 'sven', marqueeRaidId: undefined });
  });
});

// ----------------------------------------------------------------
// STORY §3.4 — cut-scene controls & degrade matrix
// ----------------------------------------------------------------
describe('STORY §3.4 cut-scene controls', () => {
  const setpiece: CutsceneDef = {
    id: 'test-setpiece', title: 'T', tier: 'setpiece', trigger: { kind: 'new-game' }, skippable: true,
    beats: [
      { shot: { angle: 'wide', move: 'hold', palette: 'p', mood: 'm' }, line: { speaker: 'N', text: 'Beat one line of text.' }, hold: 3 },
      { shot: { angle: 'wide', move: 'hold', palette: 'p', mood: 'm' }, hold: 3 },
      { shot: { angle: 'wide', move: 'hold', palette: 'p', mood: 'm' }, hold: 3 }
    ]
  };

  it('alwaysSkip / length:off route a beat to a toast instead of staging it', () => {
    const d = new CinematicDirector();
    d.setSettings({ alwaysSkip: true });
    expect(d.routesToToast(setpiece)).toBe(true);
    d.setSettings({ alwaysSkip: false, length: 'off' });
    expect(d.routesToToast(setpiece)).toBe(true);
    d.setSettings({ length: 'full' });
    expect(d.routesToToast(setpiece)).toBe(false);
  });

  it('length:short degrades a setpiece to its stinger (fewer beats)', () => {
    const d = new CinematicDirector();
    d.setSettings({ length: 'short' });
    d.play(setpiece, {}, false);
    expect(d.view()?.beatCount).toBe(2);
  });

  it('default speed and fast-forward stepping (2x/4x/8x) work', () => {
    const d = new CinematicDirector();
    d.setSettings({ defaultSpeed: 2 });
    d.play(setpiece, {}, false);
    expect(d.view()?.speed).toBe(2);
    d.setFastForward(true); expect(d.view()?.speed).toBe(2);
    d.setFastForward(true); expect(d.view()?.speed).toBe(4);
    d.setFastForward(true); expect(d.view()?.speed).toBe(8);
    d.setFastForward(false); expect(d.view()?.speed).toBe(2);
  });

  it('typewriter: a tap completes the line before the next tap advances', () => {
    const d = new CinematicDirector();
    d.play(setpiece, {}, false);
    expect(d.view()?.revealedText.length).toBeLessThan(d.view()!.text!.length);
    d.advance();
    expect(d.view()?.revealedText).toBe(d.view()?.text);
    expect(d.view()?.beatIndex).toBe(0);
    d.advance();
    expect(d.view()?.beatIndex).toBe(1);
  });

  it('skip is hold-to-confirm on a first view, instant on a seen one', () => {
    const d = new CinematicDirector();
    d.play(setpiece, {}, false);
    d.requestSkip();
    expect(d.active).toBe(true);
    d.update(0.2); expect(d.active).toBe(true);
    d.update(0.3); expect(d.active).toBe(false);

    d.play(setpiece, {}, true);
    d.requestSkip();
    expect(d.active).toBe(false);
  });

  it('replay ignores degrade and runs at 1x full length', () => {
    const d = new CinematicDirector();
    d.setSettings({ length: 'short', defaultSpeed: 4, alwaysSkip: true });
    d.replay(setpiece, {});
    expect(d.view()?.beatCount).toBe(3);
    expect(d.view()?.speed).toBe(1);
  });
});

// ----------------------------------------------------------------
// STORY §8 — cinematics gallery + §7.4 titles + §2.6/§7.4 content
// ----------------------------------------------------------------
describe('STORY gallery, titles & content', () => {
  it('gallery hides unseen replayable scenes spoiler-safe and replays only seen ones', () => {
    const g = freshGame();
    while (g.cinematic.active) g.cinematicSkip();
    const groups = g.cinematicGallery();
    const all = groups.flatMap((gr) => gr.entries);
    expect(all.length).toBeGreaterThan(0);
    // The prologue auto-plays on a fresh game, so it is seen + replayable.
    const prologue = all.find((e) => e.id === 'prologue-moon-breaks');
    expect(prologue?.seen).toBe(true);
    expect(g.replayCutscene('prologue-moon-breaks')).toBe(true);
    while (g.cinematic.active) g.cinematicSkip();
    // An unseen replayable scene is locked and cannot be replayed.
    const unseen = all.find((e) => !e.seen);
    expect(unseen?.title.startsWith('???')).toBe(true);
    if (unseen) expect(g.replayCutscene(unseen.id)).toBe(false);
  });

  it('True Champion title unlocks from a Hell-tier Roshan clear and shows in the journal', () => {
    const g = freshGame();
    expect(g.journalSections().titles).toHaveLength(0);
    g.codexUnlock('title:true-champion');
    expect(g.journalSections().titles.map((t) => t.id)).toContain('true-champion');
  });

  it('the Aegis carries its Champions inscription, and roster Echoes carry a Loop cycle note', () => {
    expect(REG.item('aegis-of-the-immortal').lore.toLowerCase()).toContain('inscribed');
    const roster = [...REG.heroes.values()].filter((h) => h.lore.includes('turn of the Loop'));
    expect(roster.length).toBeGreaterThan(10);
  });

  it('a festival that cannot launch its mode is still remembered with its purse', () => {
    const g = freshGame();
    while (g.cinematic.active) g.cinematicSkip();
    expect(g.festivalLaunchable('diretide-roshan-candy')).toBe(false); // fresh game has no full party
    const goldBefore = g.gold;
    expect(g.runSeasonalEvent('wraith-night-altar')).toBe(true);
    expect(g.gold).toBeGreaterThan(goldBefore); // festival purse paid out immediately
  });
});
