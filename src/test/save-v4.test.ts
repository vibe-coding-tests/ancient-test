import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { Game, newGameSave, SAVE_VERSION } from '../systems/game';
import { migratePhase4Save } from '../core/phase4';
import type { GameSave } from '../core/types';

// Test 25 (Phase 6 §6): save-v4-roundtrip. A v4 save carrying reputation,
// codex/journal arrays, and the audio channel settings reloads identically;
// v3->v4 and v2->v4 migrations default cleanly.

beforeAll(() => registerAllContent());

describe('save v4 round-trip and migration', () => {
  it('a fresh save is v4 with audio channels and karma defaults', () => {
    const save = newGameSave('juggernaut');
    expect(save.version).toBe(4);
    expect(SAVE_VERSION).toBe(4);
    expect(save.reputation).toBe(0);
    expect(save.codexUnlocks).toEqual([]);
    expect(save.journalSeen).toEqual([]);
    expect(save.settings.audio).toEqual({ master: 0.8, sfx: 0.8, voice: 0.7, stinger: 0.7, muted: false });
    expect(Game.validateSave(save)).toBe(true);
  });

  it('round-trips a v4 save carrying karma, codex/journal, and audio channels identically', () => {
    const save = newGameSave('crystal-maiden');
    save.reputation = 7;
    save.codexUnlocks = ['hero:lich', 'region:icewrack', 'raid:roshan-pit'];
    save.journalSeen = ['quest-lich', 'badge:frost-badge'];
    save.settings.audio = { master: 0.55, sfx: 0.4, voice: 0.9, stinger: 0.25, muted: true };
    save.settings.minimap = false;

    const json = JSON.stringify(save);
    const reloaded = Game.migrateSave(JSON.parse(json) as unknown);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.version).toBe(4);
    expect(reloaded!.reputation).toBe(7);
    expect(reloaded!.codexUnlocks).toEqual(save.codexUnlocks);
    expect(reloaded!.journalSeen).toEqual(save.journalSeen);
    expect(reloaded!.settings.audio).toEqual(save.settings.audio);
    expect(reloaded!.settings.minimap).toBe(false);
    expect(Game.validateSave(reloaded!)).toBe(true);
  });

  it('migrates a v3 save: folds loose volumes into audio channels, defaults karma', () => {
    const v4 = newGameSave('juggernaut');
    // Build a v3-shaped save: legacy settings, no karma/codex/journal fields.
    const v3 = JSON.parse(JSON.stringify(v4)) as Record<string, unknown>;
    v3.version = 3;
    delete v3.reputation;
    delete v3.codexUnlocks;
    delete v3.journalSeen;
    v3.settings = { quickcast: true, resonance: false, masterVolume: 0.5, sfxVolume: 0.6, musicVolume: 0.3 };

    const migrated = Game.migrateSave(v3);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(4);
    expect(migrated!.reputation).toBe(0);
    expect(migrated!.codexUnlocks).toEqual([]);
    expect(migrated!.journalSeen).toEqual([]);
    expect(migrated!.settings.audio.master).toBeCloseTo(0.5);
    expect(migrated!.settings.audio.sfx).toBeCloseTo(0.6);
    expect(migrated!.settings.audio.stinger).toBeCloseTo(0.3); // musicVolume -> stinger
    expect(migrated!.settings.audio.voice).toBeCloseTo(0.7); // no v3 analogue -> default
    expect(migrated!.settings.audio.muted).toBe(false);
    expect(Game.validateSave(migrated!)).toBe(true);
  });

  it('migrates a v2-shaped save all the way to v4', () => {
    const v4 = newGameSave('juggernaut');
    const v2 = JSON.parse(JSON.stringify(v4)) as Record<string, unknown>;
    v2.version = 2;
    delete v2.difficulty;
    delete v2.raidProgress;
    delete v2.eliteFive;
    delete v2.reputation;
    delete v2.codexUnlocks;
    delete v2.journalSeen;
    v2.settings = { quickcast: false, resonance: true };

    const migrated = Game.migrateSave(v2);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(4);
    expect(migrated!.difficulty).toEqual({});
    expect(migrated!.raidProgress).toEqual({});
    expect(migrated!.reputation).toBe(0);
    expect(migrated!.settings.quickcast).toBe(false);
    expect(migrated!.settings.resonance).toBe(true);
    // v3 defaults musicVolume to 0.6 when absent, which folds into the stinger channel.
    expect(migrated!.settings.audio).toEqual({ master: 0.8, sfx: 0.8, voice: 0.7, stinger: 0.6, muted: false });
    expect(Game.validateSave(migrated!)).toBe(true);
  });

  it('migratePhase4Save is idempotent on a v4 save', () => {
    const save = newGameSave('juggernaut') as GameSave;
    save.reputation = 3;
    const once = migratePhase4Save(save);
    const twice = migratePhase4Save(once);
    expect(twice).toEqual(once);
  });
});
