import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_REGIONS, registerAllContent } from '../data';
import { INPUT_ACTIONS } from '../systems/keybindings';
import { Game, newGameSave, townServicePointsFor } from '../systems/game';
import type { TownServiceKind } from '../systems/game';

// ============================================================
// TOWN SERVICES — the "go full diegetic" + "are the NPCs in the
// right place / is every service reachable" pass.
//
// The town-services overhaul retired the global Y menu and moved
// every trade onto a walk-up NPC. The risks that creates: a trade
// that exists in code but lives in no town (unreachable), a town
// missing the always-on fountain, or the old global key lingering
// as a dead binding. town-layout.test.ts already pins NPC spacing
// and collision; this pins reachability and the diegetic contract.
// ============================================================

beforeAll(() => registerAllContent());

const ALL_KINDS: TownServiceKind[] = ['recovery', 'armory', 'tinker', 'adventure', 'market'];

describe('town services are fully diegetic', () => {
  it('retired the global services key (no menu binding survives)', () => {
    expect(INPUT_ACTIONS as readonly string[]).not.toContain('services');
  });

  it('puts the recovery fountain in every single town', () => {
    for (const region of ALL_REGIONS) {
      const kinds = townServicePointsFor(region).map((p) => p.kind);
      expect(kinds, `${region.id}`).toContain('recovery');
    }
  });

  it('makes every service trade reachable in at least one town', () => {
    const reachable = new Set<TownServiceKind>();
    for (const region of ALL_REGIONS) {
      for (const svc of townServicePointsFor(region)) reachable.add(svc.kind);
    }
    for (const kind of ALL_KINDS) {
      expect(reachable.has(kind), `${kind} must exist in some town`).toBe(true);
    }
  });

  it('keeps each town a focused subset — no town is a one-stop megamenu', () => {
    for (const region of ALL_REGIONS) {
      const kinds = townServicePointsFor(region).map((p) => p.kind);
      expect(kinds.length, `${region.id} service count`).toBeGreaterThanOrEqual(2);
      expect(kinds.length, `${region.id} service count`).toBeLessThan(ALL_KINDS.length); // never literally everything
      // No duplicate trade in one town, and stable unique NPC ids.
      expect(new Set(kinds).size, `${region.id} unique kinds`).toBe(kinds.length);
      const ids = townServicePointsFor(region).map((p) => p.id);
      expect(new Set(ids).size, `${region.id} unique ids`).toBe(ids.length);
    }
  });

  it('not every town has every trade (spread, not cloned)', () => {
    // At least one of the non-recovery trades must be absent from some town,
    // otherwise the "spread services across towns" design silently collapsed.
    for (const kind of ['armory', 'tinker', 'adventure', 'market'] as TownServiceKind[]) {
      const towns = ALL_REGIONS.filter((r) => townServicePointsFor(r).some((s) => s.kind === kind));
      expect(towns.length, `${kind} appears somewhere`).toBeGreaterThan(0);
      expect(towns.length, `${kind} is not in literally every town`).toBeLessThan(ALL_REGIONS.length);
    }
  });
});

describe('a hero standing on a service NPC can interact with exactly that trade', () => {
  it('walking onto each service NPC opens that specific service (and only via the NPC)', () => {
    const g = Game.headless(newGameSave('juggernaut'));
    const opened: TownServiceKind[] = [];
    g.onOpenTownService = (kind) => opened.push(kind);

    const services = townServicePointsFor(g.region);
    expect(services.length).toBeGreaterThan(0);

    for (const svc of services) {
      // Stand the hero exactly on the NPC.
      g.activeUnit()!.pos = { ...svc.pos };
      g.activeUnit()!.prevPos = { ...svc.pos };

      const near = g.nearbyTownService();
      expect(near?.kind, `${g.region.id}: nearbyTownService at ${svc.kind}`).toBe(svc.kind);

      opened.length = 0;
      expect(g.tryInteract(), `${svc.kind}: G should resolve to an interaction`).toBe(true);
      expect(opened, `${svc.kind}: G opened the matching trade`).toEqual([svc.kind]);
    }
  });

  it('does not resolve a town service when standing far away from any NPC', () => {
    const g = Game.headless(newGameSave('juggernaut'));
    const u = g.activeUnit()!;
    // Far from the plaza ring (services sit at ~0.42 * town radius).
    u.pos = { x: g.region.town.pos.x + g.region.town.radius * 4, y: g.region.town.pos.y };
    u.prevPos = { ...u.pos };
    expect(g.nearbyTownService()).toBeNull();
  });
});
