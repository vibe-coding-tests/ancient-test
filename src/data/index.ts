import { REG } from '../core/registry';
import { JUGGERNAUT } from './heroes/juggernaut';
import { CRYSTAL_MAIDEN } from './heroes/crystal-maiden';
import { PUDGE } from './heroes/pudge';
import { EARTHSHAKER } from './heroes/earthshaker';
import { SNIPER } from './heroes/sniper';
import { LICH } from './heroes/lich';
import { LUNA } from './heroes/luna';
import { SVEN } from './heroes/sven';
import { AXE } from './heroes/axe';
import { ALL_ITEMS } from './items/index';
import { ALL_CREEPS } from './creeps/index';
import { TRANQUIL_VALE } from './regions/tranquil-vale';
import type { HeroDef } from '../core/types';

export const ALL_HEROES: HeroDef[] = [JUGGERNAUT, CRYSTAL_MAIDEN, PUDGE, EARTHSHAKER, SNIPER, LICH, LUNA, SVEN, AXE];
export const ALL_REGIONS = [TRANQUIL_VALE];

let registered = false;

/** Register all content into the registry. Idempotent. */
export function registerAllContent(): void {
  if (registered) return;
  registered = true;
  for (const h of ALL_HEROES) REG.registerHero(h);
  for (const i of ALL_ITEMS) REG.registerItem(i);
  for (const c of ALL_CREEPS) REG.registerCreep(c);
  for (const r of ALL_REGIONS) REG.registerRegion(r);
  // Exotic registry: zero exotics spent in Phase 1 (budget ~25, SPEC §2).
}

export function resetContentRegistration(): void {
  registered = false;
  REG.clear();
}
