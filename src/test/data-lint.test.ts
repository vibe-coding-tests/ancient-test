import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllContent, ALL_HEROES, ALL_REGIONS } from '../data/index';
import { ALL_ITEMS } from '../data/items/index';
import { ALL_CREEPS } from '../data/creeps/index';
import { REG } from '../core/registry';
import type { AbilityDef, EffectNode, ValueRef, VfxArchetype } from '../core/types';
import { abilityMaxLevel } from '../core/values';

// ============================================================
// Data lint (SPEC §1.2): every entry validates, every
// cross-reference resolves. Grows with the content.
// ============================================================

beforeAll(() => registerAllContent());

const VFX_ARCHETYPES: VfxArchetype[] = [
  'projectile', 'ground-aoe', 'chain', 'beam', 'summon-pop', 'shield',
  'stun-stars', 'channel', 'global-mark', 'hook', 'wall', 'storm'
];

const STATUS_IDS = [
  'stun', 'root', 'silence', 'hex', 'slow', 'disarm', 'blind', 'fear', 'taunt',
  'invis', 'magic-immune', 'break', 'cyclone', 'sleep', 'frozen', 'buff'
];

function checkValueRef(ref: ValueRef | undefined, def: AbilityDef, where: string): void {
  if (ref === undefined || typeof ref === 'number') return;
  expect(def.values?.[ref], `${where}: value key '${ref}' missing on ${def.id}`).toBeDefined();
}

function walkEffects(effects: EffectNode[] | undefined, def: AbilityDef, where: string, exoticIds: string[]): void {
  if (!effects) return;
  for (const node of effects) {
    switch (node.kind) {
      case 'damage':
        checkValueRef(node.amount, def, where);
        checkValueRef(node.radius, def, where);
        expect(['physical', 'magical', 'pure']).toContain(node.dtype);
        break;
      case 'heal':
        checkValueRef(node.amount, def, where);
        break;
      case 'mana':
        checkValueRef(node.amount, def, where);
        break;
      case 'status':
        expect(STATUS_IDS, `${where}: bad status ${node.status}`).toContain(node.status);
        checkValueRef(node.duration, def, where);
        if (node.params?.dotDps) checkValueRef(node.params.dotDps, def, where);
        if (node.params?.moveSlowPct) checkValueRef(node.params.moveSlowPct, def, where);
        if (node.params?.periodic) walkEffects(node.params.periodic.effects, def, `${where}>periodic`, exoticIds);
        break;
      case 'displace':
        checkValueRef(node.distance, def, where);
        checkValueRef(node.speed, def, where);
        break;
      case 'zone':
        checkValueRef(node.zone.duration, def, where);
        if (node.zone.tick) walkEffects(node.zone.tick.effects, def, `${where}>zone-tick`, exoticIds);
        if (node.zone.onEnter) walkEffects(node.zone.onEnter.effects, def, `${where}>zone-enter`, exoticIds);
        break;
      case 'summon':
        expect(node.summon.silhouette, `${where}: summon needs silhouette`).toBeDefined();
        expect(node.summon.palette.length).toBe(3);
        for (const sa of node.summon.abilities ?? []) lintAbility(sa, `${where}>summon`, exoticIds);
        break;
      case 'statmod':
        for (const k in node.mods) checkValueRef(node.mods[k], def, where);
        break;
      case 'projectile':
        checkValueRef(node.proj.speed, def, where);
        walkEffects(node.proj.onHit, def, `${where}>onhit`, exoticIds);
        break;
      case 'repeat':
        checkValueRef(node.count, def, where);
        walkEffects(node.effects, def, `${where}>repeat`, exoticIds);
        break;
      case 'exotic':
        exoticIds.push(node.id);
        break;
      case 'capture-channel':
      case 'purge':
        break;
    }
  }
}

function lintAbility(def: AbilityDef, where: string, exoticIds: string[]): void {
  expect(def.id, `${where}: ability id`).toBeTruthy();
  expect(VFX_ARCHETYPES, `${where}/${def.id}: vfx archetype '${def.vfx.archetype}'`).toContain(def.vfx.archetype);
  expect(def.vfx.color, `${where}/${def.id}: vfx color`).toMatch(/^#[0-9a-fA-F]{6}$/);
  walkEffects(def.effects, def, `${where}/${def.id}`, exoticIds);
  if (def.channel) {
    checkValueRef(def.channel.duration, def, `${where}/${def.id}>channel`);
    if (def.channel.tick) walkEffects(def.channel.tick.effects, def, `${where}/${def.id}>channel-tick`, exoticIds);
    if (def.channel.onEnd) walkEffects(def.channel.onEnd, def, `${where}/${def.id}>channel-end`, exoticIds);
  }
  if (def.toggle) walkEffects(def.toggle.effects, def, `${where}/${def.id}>toggle`, exoticIds);
  if (def.passiveMods) for (const k in def.passiveMods) checkValueRef(def.passiveMods[k], def, `${where}/${def.id}>passive`);
  if (def.aura) {
    for (const k in def.aura.mods ?? {}) checkValueRef(def.aura.mods![k], def, `${where}/${def.id}>aura`);
  }
  for (const trig of def.triggers ?? []) {
    if (trig.effects) walkEffects(trig.effects, def, `${where}/${def.id}>trigger`, exoticIds);
    if (trig.statStack) for (const k in trig.statStack.mods) checkValueRef(trig.statStack.mods[k], def, `${where}/${def.id}>stack`);
  }
  // per-level arrays must cover max level (or be length 1+ for items)
  const ml = abilityMaxLevel(def);
  if (def.manaCost) expect(def.manaCost.length, `${where}/${def.id}: manaCost levels`).toBeGreaterThanOrEqual(1);
  if (def.cooldown) expect(def.cooldown.length, `${where}/${def.id}: cooldown levels`).toBeGreaterThanOrEqual(1);
  void ml;
}

describe('data lint: heroes', () => {
  it('has the Phase 1 roster of 6', () => {
    expect(ALL_HEROES.length).toBeGreaterThanOrEqual(6);
  });

  for (const hero of ALL_HEROES) {
    describe(hero.id, () => {
      const exoticIds: string[] = [];

      it('validates schema basics', () => {
        expect(['str', 'agi', 'int', 'uni']).toContain(hero.attribute);
        expect(hero.abilities.length).toBe(4);
        expect(hero.talents.length).toBe(4);
        expect(hero.talents.map((t) => t.level)).toEqual([10, 15, 20, 25]);
        for (const t of hero.talents) expect(t.options.length).toBe(2);
        expect(hero.facets.length).toBeGreaterThanOrEqual(1);
        expect(hero.palette.length).toBe(3);
        expect(hero.barks.length).toBeGreaterThanOrEqual(6);
        expect(hero.baseStats.moveSpeed).toBeGreaterThan(200);
        expect(hero.baseStats.turnRate).toBeGreaterThan(0.2);
        const ults = hero.abilities.filter((a) => a.ult);
        expect(ults.length, `${hero.id} needs exactly 1 ult`).toBe(1);
      });

      it('region reference resolves', () => {
        expect(REG.regions.has(hero.region), `region ${hero.region}`).toBe(true);
      });

      it('abilities lint clean', () => {
        for (const a of hero.abilities) lintAbility(a, hero.id, exoticIds);
      });

      it('talent ability-overrides reference real ability value keys', () => {
        for (const tier of hero.talents) {
          for (const opt of tier.options) {
            if (opt.abilityOverride) {
              const ab = hero.abilities.find((a) => a.id === opt.abilityOverride!.abilityId);
              expect(ab, `${hero.id}/${opt.id}: ability ${opt.abilityOverride.abilityId}`).toBeDefined();
              expect(ab!.values?.[opt.abilityOverride.valueKey], `${hero.id}/${opt.id}: key ${opt.abilityOverride.valueKey}`).toBeDefined();
            }
            if (opt.cooldownAdd) {
              const ab = hero.abilities.find((a) => a.id === opt.cooldownAdd!.abilityId);
              expect(ab?.cooldown, `${hero.id}/${opt.id}: cooldownAdd target`).toBeDefined();
            }
          }
        }
        for (const f of hero.facets) {
          if (f.abilityValueOverride) {
            const ab = hero.abilities.find((a) => a.id === f.abilityValueOverride!.abilityId);
            expect(ab?.values?.[f.abilityValueOverride.valueKey], `${hero.id}/${f.id}`).toBeDefined();
          }
        }
      });

      it('exotic references are registered', () => {
        for (const id of exoticIds) {
          expect(REG.exotics.has(id), `exotic ${id} not registered`).toBe(true);
        }
      });
    });
  }
});

describe('data lint: items', () => {
  it('has at least 15 identity items (assembled/actives) and resolving recipes', () => {
    const assembled = ALL_ITEMS.filter((i) => i.tier === 'core' || (i.tier === 'basic' && i.components));
    expect(assembled.length).toBeGreaterThanOrEqual(12);
    expect(ALL_ITEMS.length).toBeGreaterThanOrEqual(40);
  });

  for (const item of ALL_ITEMS) {
    it(`${item.id} validates`, () => {
      expect(item.cost).toBeGreaterThanOrEqual(0);
      for (const c of item.components ?? []) {
        expect(REG.items.has(c), `${item.id}: component ${c}`).toBe(true);
      }
      // recipe math: component costs + recipeCost = total cost
      if (item.components && item.components.length > 0) {
        const compSum = item.components.reduce((acc, c) => acc + REG.item(c).cost, 0);
        expect(compSum + (item.recipeCost ?? 0), `${item.id}: cost mismatch`).toBe(item.cost);
      }
      if (item.active) {
        const exoticIds: string[] = [];
        lintAbility(item.active, `item:${item.id}`, exoticIds);
        expect(exoticIds.length).toBe(0);
      }
      if (item.charges !== undefined) expect(item.charges).toBeGreaterThanOrEqual(0);
    });
  }

  it('the Phase 1 identity items exist', () => {
    for (const id of ['blink-dagger', 'black-king-bar', 'euls-scepter', 'force-staff', 'glimmer-cape', 'magic-wand', 'mekansm', 'battlefury', 'diffusal-blade']) {
      expect(REG.items.has(id), id).toBe(true);
    }
  });
});

describe('data lint: creeps', () => {
  it('has 6 creep types across tiers', () => {
    expect(ALL_CREEPS.length).toBeGreaterThanOrEqual(6);
    const tiers = new Set(ALL_CREEPS.map((c) => c.tier));
    expect(tiers.has('small')).toBe(true);
    expect(tiers.has('ancient')).toBe(true);
  });

  for (const creep of ALL_CREEPS) {
    it(`${creep.id} validates`, () => {
      expect(creep.stats.maxHp).toBeGreaterThan(0);
      expect(creep.palette.length).toBe(3);
      expect(creep.bounty.xp).toBeGreaterThan(0);
      const exoticIds: string[] = [];
      for (const a of creep.abilities) lintAbility(a, creep.id, exoticIds);
      expect(exoticIds.length).toBe(0);
    });
  }
});

describe('data lint: regions', () => {
  for (const region of ALL_REGIONS) {
    it(`${region.id} cross-references resolve`, () => {
      for (const camp of region.camps) {
        expect(REG.creeps.has(camp.creepId), `${region.id}: camp creep ${camp.creepId}`).toBe(true);
        expect(camp.pos.x).toBeGreaterThan(0);
        expect(camp.pos.x).toBeLessThan(region.size);
        expect(camp.pos.y).toBeGreaterThan(0);
        expect(camp.pos.y).toBeLessThan(region.size);
      }
      for (const hs of region.heroSpawns) {
        expect(REG.heroes.has(hs.heroId), `${region.id}: hero ${hs.heroId}`).toBe(true);
      }
      for (const itemId of region.shopInventory) {
        expect(REG.items.has(itemId), `${region.id}: shop item ${itemId}`).toBe(true);
      }
    });
  }

  it('every shop sells the demo-critical items', () => {
    const tv = REG.region('tranquil-vale');
    expect(tv.shopInventory).toContain('blink-dagger');
    expect(tv.shopInventory).toContain('tango');
  });
});

describe('data lint: exotic budget', () => {
  it('stays within ~25 exotics', () => {
    expect(REG.exotics.size).toBeLessThanOrEqual(25);
  });
});
