import type { CreepDef, HeroDef, ItemDef, RegionDef } from './types';

// ---------------------------------------------------------------
// Content registry. Data files register themselves; systems are
// generic interpreters. Adding hero #61 = one data file, zero code.
// The exotic registry is the logged escape hatch (budget ~25).
// ---------------------------------------------------------------

export type ExoticImpl = (ctx: unknown) => void;

class Registry {
  heroes = new Map<string, HeroDef>();
  items = new Map<string, ItemDef>();
  creeps = new Map<string, CreepDef>();
  regions = new Map<string, RegionDef>();
  exotics = new Map<string, ExoticImpl>();

  registerHero(def: HeroDef): void {
    this.heroes.set(def.id, def);
  }
  registerItem(def: ItemDef): void {
    this.items.set(def.id, def);
  }
  registerCreep(def: CreepDef): void {
    this.creeps.set(def.id, def);
  }
  registerRegion(def: RegionDef): void {
    this.regions.set(def.id, def);
  }
  registerExotic(id: string, impl: ExoticImpl): void {
    this.exotics.set(id, impl);
  }

  hero(id: string): HeroDef {
    const d = this.heroes.get(id);
    if (!d) throw new Error(`unknown hero: ${id}`);
    return d;
  }
  item(id: string): ItemDef {
    const d = this.items.get(id);
    if (!d) throw new Error(`unknown item: ${id}`);
    return d;
  }
  creep(id: string): CreepDef {
    const d = this.creeps.get(id);
    if (!d) throw new Error(`unknown creep: ${id}`);
    return d;
  }
  region(id: string): RegionDef {
    const d = this.regions.get(id);
    if (!d) throw new Error(`unknown region: ${id}`);
    return d;
  }
  clear(): void {
    this.heroes.clear();
    this.items.clear();
    this.creeps.clear();
    this.regions.clear();
    this.exotics.clear();
  }
}

export const REG = new Registry();
