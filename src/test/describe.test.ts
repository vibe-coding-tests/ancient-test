import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent, ALL_HEROES } from '../data/index';
import { ALL_ITEMS } from '../data/items/index';
import { ALL_CREEPS } from '../data/creeps/index';
import { ALL_NEUTRAL_ITEMS } from '../data/neutral-items';
import { buildAbilityCard, buildItemCard, buildNeutralItemCard, buildHeroCard, cardToText } from '../core/describe';
import { HERO_BLURBS } from '../data/heroes/blurbs';
import { REG } from '../core/registry';
import type { AbilityDef, ItemDef } from '../core/types';

// ============================================================
// Description layer: every spell and item produces a readable
// "what it does" card without throwing, and authored overrides win.
// ============================================================

beforeAll(() => registerAllContent());

describe('ability cards', () => {
  const abilities = ALL_HEROES.flatMap((h) => h.abilities);

  it('every hero ability builds a non-empty effect at preview and learned levels', () => {
    expect(abilities.length).toBeGreaterThan(0);
    for (const def of abilities) {
      for (const level of [undefined, 1, 4]) {
        const card = buildAbilityCard(def, level);
        expect(card.name, `${def.id} name`).toBe(def.name);
        expect(card.effect.length, `${def.id} effect`).toBeGreaterThan(0);
        expect(card.effect.every((line) => line.trim().length > 0), `${def.id} blank line`).toBe(true);
        // text flattening never throws and includes the name
        expect(cardToText(card)).toContain(def.name);
      }
    }
  });

  it('creep abilities also describe cleanly', () => {
    for (const creep of ALL_CREEPS) {
      for (const def of creep.abilities) {
        const card = buildAbilityCard(def);
        expect(card.effect.length, `${def.id} effect`).toBeGreaterThan(0);
      }
    }
  });

  it('uses an authored description verbatim when present', () => {
    const def: AbilityDef = {
      id: 'test-authored',
      name: 'Authored Bolt',
      targeting: 'unit-target',
      manaCost: [100],
      cooldown: [10],
      values: { damage: [100] },
      effects: [{ kind: 'damage', dtype: 'magical', amount: 'damage', target: 'target' }],
      description: 'A bespoke one-liner that should win over the generator.',
      vfx: { archetype: 'projectile', color: '#fff' }
    };
    const card = buildAbilityCard(def);
    expect(card.effect).toEqual(['A bespoke one-liner that should win over the generator.']);
  });

  it('resolves per-level value ranges vs. a single learned level', () => {
    const def: AbilityDef = {
      id: 'test-range',
      name: 'Scaling Nuke',
      targeting: 'no-target',
      values: { damage: [100, 200, 300, 400] },
      effects: [{ kind: 'damage', dtype: 'magical', amount: 'damage', target: 'enemies-in-radius', radius: 300 }],
      vfx: { archetype: 'ground-aoe', color: '#fff' }
    };
    expect(buildAbilityCard(def).effect.join(' ')).toContain('100/200/300/400');
    expect(buildAbilityCard(def, 2).effect.join(' ')).toContain('200');
    expect(buildAbilityCard(def, 2).effect.join(' ')).not.toContain('100/200');
  });
});

describe('item cards', () => {
  it('every item builds a card with effect or stats', () => {
    expect(ALL_ITEMS.length).toBeGreaterThan(0);
    for (const def of ALL_ITEMS) {
      const card = buildItemCard(def);
      expect(card.name, `${def.id} name`).toBe(def.name);
      expect(card.effect.length + card.stats.length, `${def.id} has detail`).toBeGreaterThan(0);
      expect(cardToText(card)).toContain(def.name);
    }
  });

  it('every neutral item builds a card', () => {
    for (const def of ALL_NEUTRAL_ITEMS) {
      const card = buildNeutralItemCard(def);
      expect(card.effect.length + card.stats.length, `${def.id} has detail`).toBeGreaterThan(0);
    }
  });

  it('describes an item active inline', () => {
    const active = ALL_ITEMS.find((i) => !!i.active && !!i.active.effects);
    expect(active).toBeTruthy();
    const card = buildItemCard(active!);
    expect(card.effect.some((line) => line.startsWith('Active'))).toBe(true);
  });

  it('builds a hero card with a blurb, base stats, and abilities for every hero', () => {
    const heroes = [...REG.heroes.values()];
    expect(heroes.length).toBeGreaterThan(0);
    for (const hero of heroes) {
      const card = buildHeroCard(hero, { level: 5 });
      expect(card.name, `${hero.id} name`).toBe(hero.name);
      expect(card.blurb && card.blurb.trim().length > 0, `${hero.id} blurb`).toBe(true);
      expect(card.effect.length, `${hero.id} abilities`).toBe(hero.abilities.length + (hero.tagBoon ? 1 : 0));
      expect(card.stats.length, `${hero.id} base stats`).toBeGreaterThan(0);
    }
  });

  it('has an authored intro blurb for every registered hero', () => {
    const missing = [...REG.heroes.values()].filter((h) => !HERO_BLURBS[h.id]).map((h) => h.id);
    expect(missing, `heroes missing a blurb: ${missing.join(', ')}`).toEqual([]);
  });

  it('uses an authored item description verbatim when present', () => {
    const def: ItemDef = {
      id: 'test-item',
      name: 'Test Trinket',
      tier: 'basic',
      cost: 500,
      passiveMods: { str: 5 },
      description: 'Authored item text.',
      lore: 'flavor'
    };
    const card = buildItemCard(def);
    expect(card.effect).toEqual(['Authored item text.']);
    expect(card.stats).toContain('+5 STR');
  });
});
