import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { REG } from '../core/registry';
import { freshEchoProgress } from '../core/echo';
import { xpForLevel } from '../core/stats';
import {
  advance,
  chosenBranch,
  claim,
  defaultQuestSave,
  isComplete,
  matchesObjective,
  prereqMet,
  questGiverPos,
  refreshAvailability,
  type QuestContext
} from '../core/quests';
import { Game, newGameSave, SAVE_VERSION } from '../systems/game';
import type { GameSave, QuestDef, QuestGiverDef } from '../core/types';

beforeAll(() => registerAllContent());

function ctx(over: Partial<QuestContext> = {}): QuestContext {
  return {
    badges: 0,
    recruited: 0,
    raidClears: 0,
    reachedRegions: new Set(),
    claimedQuests: new Set(),
    playtimeSec: 0,
    ...over
  };
}

const RECURRING: QuestDef = {
  id: 'test-recurring',
  kind: 'recurring',
  name: 'Test Bounty',
  summary: 'kill things',
  objectives: [{ kind: 'kill-creeps', count: 3, text: 'kill creeps' }],
  rewards: [{ kind: 'gold', amount: 100 }],
  cooldownSec: 60,
  repeatable: true
};

const EVENT: QuestDef = {
  id: 'test-event',
  kind: 'event',
  name: 'Test Chapter',
  summary: 'do the thing',
  objectives: [
    { kind: 'earn-badge', count: 1, text: 'badge' },
    { kind: 'capture-creeps', count: 2, text: 'capture' }
  ],
  rewards: [{ kind: 'essence', amount: 10 }],
  prereq: { badges: 1 },
  next: 'test-next'
};

describe('quest core logic (pure)', () => {
  it('prereqMet honors badges/recruited/raid/region/quest gates', () => {
    const def: QuestDef = { ...EVENT, prereq: { badges: 2, recruited: 3, raidClears: 1, region: 'icewrack', quests: ['a'] } };
    expect(prereqMet(def, ctx())).toBe(false);
    expect(prereqMet(def, ctx({ badges: 2, recruited: 3, raidClears: 1, reachedRegions: new Set(['icewrack']), claimedQuests: new Set(['a']) }))).toBe(true);
    expect(prereqMet(def, ctx({ badges: 2, recruited: 3, raidClears: 1, reachedRegions: new Set(['icewrack']), claimedQuests: new Set() }))).toBe(false);
  });

  it('refreshAvailability moves locked -> active only when prereq is met', () => {
    let s = defaultQuestSave(EVENT);
    expect(s.status).toBe('locked');
    s = refreshAvailability(EVENT, s, ctx());
    expect(s.status).toBe('locked');
    s = refreshAvailability(EVENT, s, ctx({ badges: 1 }));
    expect(s.status).toBe('active');
  });

  it('matchesObjective filters by region/tier/target', () => {
    const obj = { kind: 'kill-creeps' as const, count: 1, text: 'x', tier: 'large' as const, regionId: 'icewrack' };
    expect(matchesObjective(obj, { kind: 'kill-creeps', amount: 1, tier: 'large', regionId: 'icewrack' })).toBe(true);
    expect(matchesObjective(obj, { kind: 'kill-creeps', amount: 1, tier: 'small', regionId: 'icewrack' })).toBe(false);
    expect(matchesObjective(obj, { kind: 'kill-creeps', amount: 1, tier: 'large', regionId: 'quoidge' })).toBe(false);
    expect(matchesObjective(obj, { kind: 'capture-creeps', amount: 1, tier: 'large', regionId: 'icewrack' })).toBe(false);
  });

  it('advance increments, clamps, and completes; only active quests advance', () => {
    let s = refreshAvailability(RECURRING, defaultQuestSave(RECURRING), ctx());
    expect(s.status).toBe('active');
    s = advance(RECURRING, s, { kind: 'kill-creeps', amount: 2 }).save;
    expect(s.progress[0]).toBe(2);
    let r = advance(RECURRING, s, { kind: 'kill-creeps', amount: 5 }); // clamps to 3
    expect(r.justCompleted).toBe(true);
    expect(r.save.progress[0]).toBe(3);
    expect(r.save.status).toBe('complete');
    // a complete quest does not advance further
    r = advance(RECURRING, r.save, { kind: 'kill-creeps', amount: 1 });
    expect(r.justCompleted).toBe(false);
    expect(r.save.progress[0]).toBe(3);
  });

  it('multi-objective quests only complete when every objective is met', () => {
    let s = refreshAvailability(EVENT, defaultQuestSave(EVENT), ctx({ badges: 1 }));
    s = advance(EVENT, s, { kind: 'earn-badge', amount: 1 }).save;
    expect(isComplete(EVENT, s)).toBe(false);
    expect(s.status).toBe('active');
    const r = advance(EVENT, s, { kind: 'capture-creeps', amount: 2 });
    expect(r.justCompleted).toBe(true);
    expect(r.save.status).toBe('complete');
  });

  it('claim: event -> claimed (terminal); recurring -> cooldown then re-arms', () => {
    // event
    let e = refreshAvailability(EVENT, defaultQuestSave(EVENT), ctx({ badges: 1 }));
    e = advance(EVENT, e, { kind: 'earn-badge', amount: 1 }).save;
    e = advance(EVENT, e, { kind: 'capture-creeps', amount: 2 }).save;
    const ce = claim(EVENT, e, ctx({ badges: 1 }));
    expect(ce.claimed).toBe(true);
    expect(ce.save.status).toBe('claimed');
    expect(ce.save.completions).toBe(1);
    expect(claim(EVENT, ce.save, ctx({ badges: 1 })).claimed).toBe(false); // terminal

    // recurring with cooldown
    let s = refreshAvailability(RECURRING, defaultQuestSave(RECURRING), ctx());
    s = advance(RECURRING, s, { kind: 'kill-creeps', amount: 3 }).save;
    const cr = claim(RECURRING, s, ctx({ playtimeSec: 100 }));
    expect(cr.save.status).toBe('cooldown');
    expect(cr.save.availableAt).toBe(160);
    // still cooling down
    expect(refreshAvailability(RECURRING, cr.save, ctx({ playtimeSec: 120 })).status).toBe('cooldown');
    // re-arms after the cooldown, progress reset
    const armed = refreshAvailability(RECURRING, cr.save, ctx({ playtimeSec: 200 }));
    expect(armed.status).toBe('active');
    expect(armed.progress[0]).toBe(0);
    expect(armed.completions).toBe(1);
  });
});

// ---------- timed quests (windowSec) ----------

const TIMED: QuestDef = {
  id: 'test-timed',
  kind: 'recurring',
  name: 'Timed Bounty',
  summary: 'race the clock',
  objectives: [{ kind: 'kill-creeps', count: 3, text: 'kill creeps' }],
  rewards: [{ kind: 'gold', amount: 100 }],
  windowSec: 60,
  repeatable: true
};

describe('timed quests (windowSec)', () => {
  it('opens a deadline when it goes active', () => {
    const s = refreshAvailability(TIMED, defaultQuestSave(TIMED), ctx({ playtimeSec: 10 }));
    expect(s.status).toBe('active');
    expect(s.expiresAt).toBe(70);
  });

  it('resets progress and re-arms the window when the deadline lapses', () => {
    let s = refreshAvailability(TIMED, defaultQuestSave(TIMED), ctx({ playtimeSec: 0 }));
    s = advance(TIMED, s, { kind: 'kill-creeps', amount: 2 }).save;
    expect(s.progress[0]).toBe(2);
    // Before the deadline: progress holds.
    s = refreshAvailability(TIMED, s, ctx({ playtimeSec: 59 }));
    expect(s.status).toBe('active');
    expect(s.progress[0]).toBe(2);
    // At/after the deadline: it resets and opens a fresh window.
    s = refreshAvailability(TIMED, s, ctx({ playtimeSec: 60 }));
    expect(s.status).toBe('active');
    expect(s.progress[0]).toBe(0);
    expect(s.expiresAt).toBe(120);
  });

  it('locks in a completed run even past the deadline (the reward is earned)', () => {
    let s = refreshAvailability(TIMED, defaultQuestSave(TIMED), ctx({ playtimeSec: 0 }));
    s = advance(TIMED, s, { kind: 'kill-creeps', amount: 3 }).save;
    expect(s.status).toBe('complete');
    expect(s.expiresAt).toBeUndefined(); // window dropped on completion
    const r = refreshAvailability(TIMED, s, ctx({ playtimeSec: 10_000 }));
    expect(r.status).toBe('complete');
  });
});

// ---------- branching choice-quests ----------

const FORK: QuestDef = {
  id: 'test-fork',
  kind: 'event',
  name: 'A Choice',
  summary: 'pick a path',
  objectives: [{ kind: 'reach-region', count: 1, text: 'arrive' }],
  rewards: [{ kind: 'gold', amount: 100 }],
  choices: [
    { id: 'left', label: 'Go left', rewards: [{ kind: 'essence', amount: 10 }], next: 'test-left' },
    { id: 'right', label: 'Go right', rewards: [{ kind: 'essence', amount: 20 }], next: 'test-right' }
  ]
};

describe('branching choice-quests', () => {
  it('chosenBranch resolves by id and defaults to the first branch', () => {
    expect(chosenBranch(FORK, 'right')?.id).toBe('right');
    expect(chosenBranch(FORK, 'nope')?.id).toBe('left'); // unknown -> first
    expect(chosenBranch(FORK, undefined)?.id).toBe('left');
    expect(chosenBranch(RECURRING)).toBeUndefined(); // no choices
  });

  it('records the chosen branch on claim', () => {
    let s = refreshAvailability(FORK, defaultQuestSave(FORK), ctx());
    s = advance(FORK, s, { kind: 'reach-region', amount: 1 }).save;
    expect(s.status).toBe('complete');
    const r = claim(FORK, s, ctx(), 'right');
    expect(r.claimed).toBe(true);
    expect(r.save.status).toBe('claimed');
    expect(r.save.choice).toBe('right');
  });

  it('a prereq.choice gate only opens for the branch that was taken', () => {
    const successor: QuestDef = { ...EVENT, id: 'test-left', prereq: { choice: { quest: 'test-fork', choiceId: 'left' } } };
    // Took the right branch -> the left successor stays locked.
    expect(prereqMet(successor, ctx({ questChoices: new Map([['test-fork', 'right']]) }))).toBe(false);
    // Took the left branch -> it opens.
    expect(prereqMet(successor, ctx({ questChoices: new Map([['test-fork', 'left']]) }))).toBe(true);
  });
});

// ---------- registered content ----------

describe('registered quest content', () => {
  it('every reward and prereq reference resolves to real content', () => {
    const ids = new Set([...REG.questDefs.keys()]);
    for (const def of REG.questDefs.values()) {
      // recurring/event invariants
      if (def.kind === 'recurring') expect(def.repeatable, def.id).toBe(true);
      if (def.kind === 'event') expect(def.repeatable ?? false, def.id).toBe(false);
      expect(def.objectives.length, def.id).toBeGreaterThan(0);
      for (const obj of def.objectives) expect(obj.count, `${def.id}:${obj.kind}`).toBeGreaterThan(0);
      for (const r of def.rewards) {
        if (r.kind === 'item') expect(REG.items.has(r.itemId), `${def.id} item ${r.itemId}`).toBe(true);
        if (r.kind === 'recruit') expect(REG.heroes.has(r.heroId), `${def.id} recruit ${r.heroId}`).toBe(true);
      }
      if (def.next) expect(ids.has(def.next), `${def.id} next ${def.next}`).toBe(true);
      for (const q of def.prereq?.quests ?? []) expect(ids.has(q), `${def.id} prereq ${q}`).toBe(true);
    }
  });

  it('ships both recurring bounties and event chapters', () => {
    const kinds = new Set([...REG.questDefs.values()].map((q) => q.kind));
    expect(kinds.has('recurring')).toBe(true);
    expect(kinds.has('event')).toBe(true);
  });

  it("The Mad Moon's Answer unlocks on 8 badges OR a raid clear (after the Lost Echo)", () => {
    const def = REG.questDef('chapter-mad-moon');
    const chain = new Set(['chapter-lost-echo']);
    // Chain done but neither alternate gate met -> still locked.
    expect(prereqMet(def, ctx({ claimedQuests: chain }))).toBe(false);
    // Either branch on its own opens it.
    expect(prereqMet(def, ctx({ claimedQuests: chain, badges: 8 }))).toBe(true);
    expect(prereqMet(def, ctx({ claimedQuests: chain, raidClears: 1 }))).toBe(true);
    // The chain itself is still required even with a branch satisfied.
    expect(prereqMet(def, ctx({ claimedQuests: new Set(), raidClears: 1 }))).toBe(false);
  });

  it('Pit Contract re-arms only after its full 6h cooldown elapses', () => {
    const def = REG.questDef('bounty-pit-contract');
    expect(def.cooldownSec).toBe(6 * 60 * 60);
    let s = refreshAvailability(def, defaultQuestSave(def), ctx({ badges: 1 }));
    expect(s.status).toBe('active'); // prereq is 1 badge
    s = advance(def, s, { kind: 'clear-boss', amount: 1 }).save;
    expect(s.status).toBe('complete');
    const claimed = claim(def, s, ctx({ badges: 1, playtimeSec: 1000 }));
    expect(claimed.save.status).toBe('cooldown');
    expect(claimed.save.availableAt).toBe(1000 + 6 * 60 * 60);
    // One second short: still cooling down.
    expect(refreshAvailability(def, claimed.save, ctx({ badges: 1, playtimeSec: 1000 + 6 * 60 * 60 - 1 })).status).toBe('cooldown');
    // At the boundary it re-arms with progress reset and completions banked.
    const armed = refreshAvailability(def, claimed.save, ctx({ badges: 1, playtimeSec: 1000 + 6 * 60 * 60 }));
    expect(armed.status).toBe('active');
    expect(armed.progress[0]).toBe(0);
    expect(armed.completions).toBe(1);
  });

  it('the Pit Contract bounty stays locked until the player holds a badge', () => {
    const def = REG.questDef('bounty-pit-contract');
    expect(refreshAvailability(def, defaultQuestSave(def), ctx({ badges: 0 })).status).toBe('locked');
    expect(refreshAvailability(def, defaultQuestSave(def), ctx({ badges: 1 })).status).toBe('active');
  });
});

// ---------- Game integration (headless) ----------

function fullSave(): GameSave {
  const team = ['juggernaut', 'sven', 'sniper', 'lich', 'earthshaker'];
  const save = newGameSave(team[0]);
  save.party = [...team];
  save.recruited = [...team];
  save.roster = team.map((heroId) => ({
    heroId,
    level: 30,
    xp: xpForLevel(30),
    items: [null, null, null, null, null, null],
    neutralSlot: null,
    talentPicks: [0, 0, 0, 0],
    gambits: [],
    echo: freshEchoProgress(),
    facetIdx: 0,
    hpPct: 1,
    manaPct: 1,
    abilityCooldowns: [0, 0, 0, 0],
    tagGaugeReadyAt: 0
  }));
  save.badges = [...REG.gyms.values()].map((g) => g.badgeId);
  return save;
}

describe('quests wired into Game (headless)', () => {
  it('counts creep kills toward a bounty and pays out on claim', () => {
    const game = Game.headless(fullSave());
    game.refreshQuests();
    // Cull the Wilds: 12 wild creeps.
    for (let i = 0; i < 12; i++) {
      // route a synthetic kill-credit-style advance via the public seam
      game.advanceQuests({ kind: 'kill-creeps', amount: 1, tier: 'small', regionId: game.region.id });
    }
    const board = game.questBoard();
    const cull = board.find((q) => q.id === 'bounty-cull-wilds');
    expect(cull?.claimable).toBe(true);
    const goldBefore = game.gold;
    expect(game.claimQuest('bounty-cull-wilds')).toBe(true);
    expect(game.gold).toBeGreaterThan(goldBefore);
    // claimed recurring re-arms (no cooldown elapsed -> still claimable=false, progress reset)
    const after = game.questBoard().find((q) => q.id === 'bounty-cull-wilds');
    expect(after?.claimable).toBe(false);
    expect(after?.objectives[0].have).toBe(0);
  });

  it('a claimed chapter unlocks its next chapter', () => {
    const game = Game.headless(fullSave());
    game.refreshQuests();
    // First Light: recruit 1 (the squad is pre-recruited, but advance via the seam).
    game.advanceQuests({ kind: 'recruit-heroes', amount: 1 });
    expect(game.claimQuest('chapter-first-light')).toBe(true);
    // Warden of the Vale (next) should now be visible (prereq: first-light claimed).
    const board = game.questBoard();
    expect(board.some((q) => q.id === 'chapter-vale-warden')).toBe(true);
  });

  it('grants item, loot-mark, and essence rewards on claim (Warden of the Vale)', () => {
    const save = fullSave();
    save.quests = { 'chapter-vale-warden': { status: 'complete', progress: [1], completions: 0 } };
    const game = Game.headless(save);
    const essenceBefore = game.essence;
    const earlyMarksBefore = game.lootMarks.early;
    const stashBefore = game.inventoryStash.length;

    expect(game.claimQuest('chapter-vale-warden')).toBe(true);

    expect(game.essence).toBe(essenceBefore + 40);
    expect(game.lootMarks.early).toBe(earlyMarksBefore + 1);
    expect(game.inventoryStash.length).toBe(stashBefore + 1);
    expect(game.inventoryStash.some((it) => it.id === 'broadsword')).toBe(true);
  });

  it('grants a title reward (and surfaces it in the journal) on claim (Mad Moon)', () => {
    const save = fullSave();
    save.quests = { 'chapter-mad-moon': { status: 'complete', progress: [1], completions: 0 } };
    const game = Game.headless(save);
    const goldBefore = game.gold;

    expect(game.questTitles().some((t) => t.id === 'moonmender')).toBe(false);
    expect(game.claimQuest('chapter-mad-moon')).toBe(true);

    expect(game.gold).toBeGreaterThan(goldBefore);
    expect(game.questTitles().some((t) => t.id === 'moonmender')).toBe(true);
    expect(game.inventoryStash.some((it) => it.id === 'sacred-relic')).toBe(true);
  });

  it('grants an active-scope XP reward on claim (Cull the Wilds)', () => {
    const game = Game.headless(newGameSave('juggernaut'));
    game.quests = { 'bounty-cull-wilds': { status: 'complete', progress: [12], completions: 0 } };
    const hero = game.activeUnit()!;
    const xpBefore = hero.xp;

    expect(game.claimQuest('bounty-cull-wilds')).toBe(true);
    expect(game.activeUnit()!.xp).toBe(xpBefore + 320);
    expect(game.activeUnit()!.level).toBe(2);
  });

  it('grants party-scope XP rewards to every party member on claim', () => {
    const team = ['juggernaut', 'sven', 'sniper'];
    const save = newGameSave(team[0]);
    save.party = [...team];
    save.recruited = [...team];
    save.roster = team.map((heroId) => ({
      heroId,
      level: 1,
      xp: xpForLevel(1),
      items: [null, null, null, null, null, null],
      neutralSlot: null,
      talentPicks: [null, null, null, null],
      gambits: [],
      echo: freshEchoProgress(),
      facetIdx: 0,
      hpPct: 1,
      manaPct: 1,
      abilityCooldowns: [0, 0, 0, 0],
      tagGaugeReadyAt: 0
    }));
    save.quests = { 'chapter-vale-roster': { status: 'complete', progress: [4], completions: 0 } };
    const game = Game.headless(save);

    expect(game.claimQuest('chapter-vale-roster')).toBe(true);

    for (const rec of game.party) {
      expect(rec.xp).toBe(900);
      expect(rec.level).toBe(3);
    }
    expect(game.activeUnit()!.xp).toBe(900);
    expect(game.activeUnit()!.level).toBe(3);
  });

  it('a recruit reward adds the hero to the roster', () => {
    const save = fullSave();
    // mark the chapter chain so A Lost Echo is the live, claimable quest.
    save.quests = {
      'chapter-lost-echo': { status: 'complete', progress: [5, 1], completions: 0 }
    };
    // claimed predecessors so prereq.quests is satisfied
    save.quests['chapter-first-light'] = { status: 'claimed', progress: [1], completions: 1 };
    save.quests['chapter-vale-warden'] = { status: 'claimed', progress: [1], completions: 1 };
    save.quests['chapter-deeper-loop'] = { status: 'claimed', progress: [1, 1], completions: 1 };
    const game = Game.headless(save);
    expect(game.recruited.has('marci')).toBe(false);
    expect(game.claimQuest('chapter-lost-echo')).toBe(true);
    expect(game.recruited.has('marci')).toBe(true);
  });

  it('quest state survives a save round-trip', () => {
    const game = Game.headless(fullSave());
    game.refreshQuests();
    game.advanceQuests({ kind: 'kill-creeps', amount: 5, tier: 'small', regionId: game.region.id });
    const save = game.buildSave();
    expect(save.version).toBe(SAVE_VERSION);
    const cull = save.quests['bounty-cull-wilds'];
    expect(cull?.progress[0]).toBe(5);
    const reload = Game.headless(save);
    const back = reload.questBoard().find((q) => q.id === 'bounty-cull-wilds');
    expect(back?.objectives[0].have).toBe(5);
  });

  it('migrates a v6 save by defaulting an empty quest map', () => {
    const v6 = fullSave() as unknown as { version: number; quests?: unknown };
    v6.version = 6;
    delete v6.quests;
    const migrated = Game.migrateSave(v6);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.quests).toEqual({});
  });

  it('a timed, tier-scoped bounty counts only ancient kills and carries a deadline', () => {
    const game = Game.headless(fullSave()); // all badges -> prereq (4 badges) met
    game.refreshQuests();
    const id = 'bounty-ancient-reckoning';
    // The ancient filter ignores lesser kills, and the active run shows a window.
    game.advanceQuests({ kind: 'kill-creeps', amount: 5, tier: 'small', regionId: game.region.id });
    let row = game.questBoard().find((q) => q.id === id);
    expect(row?.objectives[0].have).toBe(0);
    expect(row?.expiresIn).toBeGreaterThan(0);
    // Ancient kills count toward it.
    game.advanceQuests({ kind: 'kill-creeps', amount: 3, tier: 'ancient', regionId: game.region.id });
    row = game.questBoard().find((q) => q.id === id);
    expect(row?.claimable).toBe(true);
    const goldBefore = game.gold;
    const lateBefore = game.lootMarks.late;
    expect(game.claimQuest(id)).toBe(true);
    expect(game.gold).toBeGreaterThan(goldBefore);
    expect(game.lootMarks.late).toBe(lateBefore + 1);
  });

  it('the second spine unlocks after the Mad Moon and chains forward', () => {
    const save = fullSave();
    save.quests = { 'chapter-mad-moon': { status: 'claimed', progress: [1], completions: 1 } };
    const game = Game.headless(save);
    expect(game.questBoard().some((q) => q.id === 'chapter-outworld-cracks')).toBe(true);
    game.advanceQuests({ kind: 'clear-raid', amount: 2 });
    expect(game.claimQuest('chapter-outworld-cracks')).toBe(true);
    expect(game.questBoard().some((q) => q.id === 'chapter-outworld-renegade')).toBe(true);
  });

  it('a fork takes exactly one branch: its reward lands and only its epilogue opens', () => {
    const save = fullSave();
    save.quests = {
      'chapter-mad-moon': { status: 'claimed', progress: [1], completions: 1 },
      'fork-zets-question': { status: 'complete', progress: [1], completions: 0 }
    };
    const game = Game.headless(save);
    expect(game.claimQuest('fork-zets-question', 'break')).toBe(true);
    // Branch reward + title granted.
    expect(game.inventoryStash.some((it) => it.id === 'divine-rapier')).toBe(true);
    expect(game.questTitles().some((t) => t.id === 'loop-breaker')).toBe(true);
    // Only the chosen branch's epilogue unlocks.
    const ids = game.questBoard().map((q) => q.id);
    expect(ids).toContain('epilogue-break');
    expect(ids).not.toContain('epilogue-reunite');
    expect(ids).not.toContain('epilogue-eternal');
    // The fork is terminal-claimed and remembers the branch.
    expect(game.quests['fork-zets-question'].status).toBe('claimed');
    expect(game.quests['fork-zets-question'].choice).toBe('break');
  });

  it('a fork choice survives a save round-trip', () => {
    const save = fullSave();
    save.quests = {
      'chapter-mad-moon': { status: 'claimed', progress: [1], completions: 1 },
      'fork-zets-question': { status: 'complete', progress: [1], completions: 0 }
    };
    const game = Game.headless(save);
    expect(game.claimQuest('fork-zets-question', 'eternal')).toBe(true);
    const reload = Game.headless(game.buildSave());
    expect(reload.quests['fork-zets-question'].choice).toBe('eternal');
    const ids = reload.questBoard().map((q) => q.id);
    expect(ids).toContain('epilogue-eternal');
    expect(ids).not.toContain('epilogue-break');
  });
});

// ---------- walking quest givers (QUEST.md) ----------

describe('quest givers (pure patrol position)', () => {
  const triangle: QuestGiverDef = {
    id: 'g-test',
    name: 'Test Keeper',
    regionId: 'tranquil-vale',
    board: 'Test Board',
    home: { x: 1000, y: 1000 },
    patrol: [{ x: 2000, y: 1000 }, { x: 1000, y: 2000 }],
    loopSec: 60
  };

  it('a giver with no patrol stands at home', () => {
    const stationary: QuestGiverDef = { id: 'g', name: 'n', regionId: 'r', board: 'b', home: { x: 50, y: 70 } };
    expect(questGiverPos(stationary, 0)).toEqual({ x: 50, y: 70 });
    expect(questGiverPos(stationary, 12345)).toEqual({ x: 50, y: 70 });
  });

  it('is deterministic, loops with period loopSec, and returns home at the loop seam', () => {
    expect(questGiverPos(triangle, 0)).toEqual(triangle.home);
    // Same phase one full loop later.
    expect(questGiverPos(triangle, 60)).toEqual(questGiverPos(triangle, 0));
    expect(questGiverPos(triangle, 73)).toEqual(questGiverPos(triangle, 13));
    // Negative time wraps the same way (total function, no throw).
    expect(questGiverPos(triangle, -47)).toEqual(questGiverPos(triangle, 13));
  });

  it('stays on the patrol polygon (never wanders past its waypoints)', () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 0; t < 60; t += 0.5) {
      const p = questGiverPos(triangle, t);
      xs.push(p.x);
      ys.push(p.y);
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1000 - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(2000 + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(1000 - 1e-6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(2000 + 1e-6);
  });
});

describe('quest givers wired into Game (headless)', () => {
  it('registers a giver per region plus the hub givers', () => {
    const givers = [...REG.questGivers.values()];
    // one keeper per region + 3 hub givers (Binder courier, chapter herald, Tower warden).
    expect(givers.length).toBe(REG.regions.size + 3);
    expect(REG.questGivers.has('giver-tranquil-vale')).toBe(true);
    expect(REG.questGivers.has('giver-binder-courier')).toBe(true);
    expect(REG.questGivers.has('giver-moonmender-herald')).toBe(true);
    expect(REG.questGivers.has('giver-tower-warden')).toBe(true);
  });

  it('giverQuests returns only the quests posted under that giver board', () => {
    const game = Game.headless(newGameSave('juggernaut'));
    game.refreshQuests();
    // The chapter herald posts the Mending-the-Moon spine; First Light is live.
    const heraldBoard = game.giverQuests('giver-moonmender-herald');
    expect(heraldBoard.length).toBeGreaterThan(0);
    expect(heraldBoard.every((q) => q.kind === 'event')).toBe(true);
    expect(heraldBoard.some((q) => q.id === 'chapter-first-light')).toBe(true);
    // The Binder's courier posts the region-agnostic recurring bounties only.
    const courierBoard = game.giverQuests('giver-binder-courier');
    expect(courierBoard.some((q) => q.id === 'bounty-cull-wilds')).toBe(true);
    expect(courierBoard.every((q) => q.kind === 'recurring')).toBe(true);
  });

  it('exposes a per-frame giver view-model for the current region and flags claimable', () => {
    const game = Game.headless(newGameSave('juggernaut'));
    game.refreshQuests();
    const views = game.questGiverViews();
    // The Vale's givers (region keeper + 2 hubs) plus the town-service markers
    // (recovery / armory / tinker) all surface as map affordances. Givers are the
    // non-`service:` entries.
    const givers = views.filter((v) => !v.id.startsWith('service:'));
    const services = views.filter((v) => v.id.startsWith('service:'));
    expect(givers.length).toBe(3);
    expect(services.length).toBe(3);
    expect(views.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
    // Drive First Light to completion: its herald should now flag a claimable.
    game.advanceQuests({ kind: 'recruit-heroes', amount: 1 });
    const herald = game.questGiverViews().find((v) => v.id === 'giver-moonmender-herald');
    expect(herald?.hasClaimable).toBe(true);
  });
});
