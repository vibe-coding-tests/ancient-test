import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent } from '../data';
import { ALL_ITEMS } from '../data/items';
import { itemArchetypes } from '../core/item-archetype';

beforeAll(() => registerAllContent());

describe('item archetypes', () => {
  it('classifies every active catalog item into the closed AI vocabulary', () => {
    const activeItems = ALL_ITEMS.filter((item) => item.active);
    expect(activeItems.length).toBeGreaterThan(0);

    const missing = activeItems.filter((item) => itemArchetypes(item).size === 0).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it('captures signature item jobs used by role playbooks', () => {
    const byId = (id: string) => ALL_ITEMS.find((item) => item.id === id)!;

    expect([...itemArchetypes(byId('blink-dagger'))]).toEqual(expect.arrayContaining(['initiation', 'escape']));
    expect([...itemArchetypes(byId('veil-of-discord'))]).toEqual(expect.arrayContaining(['amplify', 'field']));
    expect([...itemArchetypes(byId('dagon'))]).toEqual(expect.arrayContaining(['nuke']));
    expect([...itemArchetypes(byId('glimmer-cape'))]).toEqual(expect.arrayContaining(['save', 'escape']));
    expect([...itemArchetypes(byId('guardian-greaves'))]).toEqual(expect.arrayContaining(['sustain', 'cleanse', 'field']));
  });
});
