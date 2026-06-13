import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { TUNING } from '../data/tuning';
import { Game, newGameSave, SAVE_VERSION } from '../systems/game';

describe('save game validation', () => {
  beforeAll(() => registerAllContent());

  it('creates a valid starter save with the Phase 1 demo stipend', () => {
    const save = newGameSave('juggernaut');

    expect(save.version).toBe(SAVE_VERSION);
    expect(save.gold).toBe(TUNING.startingGold);
    expect(Game.validateSave(save)).toBe(true);
  });

  it('rejects wrong-version or unresolved saves before load/import', () => {
    const save = newGameSave('crystal-maiden');

    expect(Game.validateSave({ ...save, version: 0 })).toBe(false);
    expect(Game.validateSave({ ...save, regionId: 'missing-region' })).toBe(false);
    expect(Game.validateSave({ ...save, party: ['rubick'], recruited: ['rubick'] })).toBe(false);
  });
});
