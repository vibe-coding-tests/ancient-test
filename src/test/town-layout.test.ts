import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ALL_REGIONS } from '../data';
import { registerAllContent } from '../data';
import { REG } from '../core/registry';
import { obstacleBlocksMovement, normalizeCollisionObstacle } from '../core/collision';
import { buildTerrain, planTownBuildings } from '../engine/terrain';
import { townServicePointsFor } from '../systems/game';
import { TUNING } from '../data/tuning';
import type { RegionDef, Vec2 } from '../core/types';

// Towns place six solid buildings on a ring around the plaza. If that ring is too
// tight the buildings' collision circles fuse into a wall and a respawned party is
// sealed in town (the Moonwake / second-town bug). These tests pin the invariant
// that every town stays escapable and every standard spawn point lands on open ground.

beforeAll(() => registerAllContent());

const HERO_DIAMETER = TUNING.unitRadiusHero * 2;
const HERO_RADIUS = TUNING.unitRadiusHero;
const WORLD_SCALE = 100;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Smallest clearance (sim units) from a point to the edge of any building circle.
 *  Negative means the point is inside a building. */
function clearanceToBuildings(region: RegionDef, p: Vec2): number {
  let min = Infinity;
  for (const b of planTownBuildings(region)) {
    min = Math.min(min, dist(p, b.pos) - b.radius);
  }
  return min;
}

function clearanceToTerrainSolids(region: RegionDef, p: Vec2): number {
  const terrain = buildTerrain(region, () => false, { staticPropShadows: false, grassDensity: 1 });
  let min = Infinity;
  for (const raw of terrain.obstacles) {
    const obstacle = normalizeCollisionObstacle(raw);
    if (!obstacleBlocksMovement(obstacle)) continue;
    const body = obstacle.body;
    if (body.shape.kind !== 'circle') continue;
    min = Math.min(min, dist(p, obstacle.pos) - body.shape.radius);
  }
  return min;
}

function meshMaterials(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function townRenderBudget(region: RegionDef): { emissiveSurfaces: number; emissiveTotal: number; maxEmissive: number; shadowCasters: number } {
  const terrain = buildTerrain(region, () => false, { staticPropShadows: true, grassDensity: 0 });
  terrain.group.updateMatrixWorld(true);
  const center = new THREE.Vector3(region.town.pos.x / WORLD_SCALE, 0, region.town.pos.y / WORLD_SCALE);
  const townRadius = region.town.radius / WORLD_SCALE + 6;
  const worldPos = new THREE.Vector3();
  let emissiveSurfaces = 0;
  let emissiveTotal = 0;
  let maxEmissive = 0;
  let shadowCasters = 0;

  terrain.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.getWorldPosition(worldPos);
    if (Math.hypot(worldPos.x - center.x, worldPos.z - center.z) > townRadius) return;

    if (mesh.castShadow) shadowCasters++;
    for (const mat of meshMaterials(mesh)) {
      const standard = mat as THREE.MeshStandardMaterial;
      const emissive = standard.emissive;
      if (!emissive || emissive.r + emissive.g + emissive.b <= 0) continue;
      const intensity = standard.emissiveIntensity ?? 0;
      if (intensity <= 0) continue;
      emissiveSurfaces++;
      emissiveTotal += intensity;
      maxEmissive = Math.max(maxEmissive, intensity);
    }
  });

  return { emissiveSurfaces, emissiveTotal, maxEmissive, shadowCasters };
}

describe('town building ring stays escapable', () => {
  it('leaves at least a hero-diameter lane between adjacent buildings in every region', () => {
    for (const region of ALL_REGIONS) {
      const buildings = planTownBuildings(region);
      for (let i = 0; i < buildings.length; i++) {
        const a = buildings[i];
        const b = buildings[(i + 1) % buildings.length];
        const gap = dist(a.pos, b.pos) - a.radius - b.radius;
        expect(gap, `${region.id}: gap between building ${i} and ${i + 1}`).toBeGreaterThanOrEqual(HERO_DIAMETER);
      }
    }
  });
});

describe('town render budget guards', () => {
  it('keeps the dense plaza from turning into an unbounded bloom/shadow cluster', () => {
    for (const region of ALL_REGIONS) {
      const budget = townRenderBudget(region);
      const diag = `${region.id}: ${JSON.stringify(budget)}`;

      expect(budget.emissiveSurfaces, diag).toBeLessThanOrEqual(10);
      expect(budget.emissiveTotal, diag).toBeLessThanOrEqual(15);
      expect(budget.maxEmissive, diag).toBeLessThanOrEqual(1.75);
      expect(budget.shadowCasters, diag).toBeLessThanOrEqual(80);
    }
  });
});

describe('town spawn points land on open ground', () => {
  it('keeps the shrine respawn point clear of buildings in every region', () => {
    for (const region of ALL_REGIONS) {
      // Matches partyWipe / buyback respawn: shrine + (120, 120).
      const respawn = { x: region.shrine.pos.x + 120, y: region.shrine.pos.y + 120 };
      expect(clearanceToBuildings(region, respawn), `${region.id}: shrine respawn`).toBeGreaterThanOrEqual(HERO_RADIUS);
    }
  });

  it('keeps the new-game spawn point clear of buildings in every region', () => {
    for (const region of ALL_REGIONS) {
      // Matches newGameSave / test-harness boot: town + (0, 500).
      const spawn = { x: region.town.pos.x, y: region.town.pos.y + 500 };
      expect(clearanceToBuildings(region, spawn), `${region.id}: new-game spawn`).toBeGreaterThanOrEqual(HERO_RADIUS);
    }
  });

  it('lands every gate arrival point clear of the destination town buildings', () => {
    const known = new Set(ALL_REGIONS.map((r) => r.id));
    for (const region of ALL_REGIONS) {
      for (const gate of region.gates ?? []) {
        if (!known.has(gate.toRegionId)) continue;
        const dest = REG.region(gate.toRegionId);
        expect(clearanceToBuildings(dest, gate.toPos), `${region.id} -> ${gate.toRegionId} via ${gate.id}`).toBeGreaterThanOrEqual(HERO_RADIUS);
      }
    }
  });
});

describe('town service NPCs are well placed', () => {
  it('gives every town the recovery (fountain) service', () => {
    for (const region of ALL_REGIONS) {
      const kinds = townServicePointsFor(region).map((p) => p.kind);
      expect(kinds, `${region.id}: service roster`).toContain('recovery');
    }
  });

  it('keeps every service NPC clear of buildings and solid town props', () => {
    for (const region of ALL_REGIONS) {
      for (const svc of townServicePointsFor(region)) {
        expect(clearanceToBuildings(region, svc.pos), `${region.id}: ${svc.kind} vs buildings`).toBeGreaterThanOrEqual(HERO_RADIUS);
        expect(clearanceToTerrainSolids(region, svc.pos), `${region.id}: ${svc.kind} vs terrain solids`).toBeGreaterThanOrEqual(HERO_RADIUS);
      }
    }
  });

  it('spaces service NPCs at least a hero-diameter apart within a town', () => {
    for (const region of ALL_REGIONS) {
      const pts = townServicePointsFor(region);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          expect(dist(pts[i].pos, pts[j].pos), `${region.id}: ${pts[i].kind} vs ${pts[j].kind}`).toBeGreaterThanOrEqual(HERO_DIAMETER);
        }
      }
    }
  });
});

describe('terrain solids do not cover player landing points', () => {
  it('keeps all standard overworld landing points clear of blocking terrain', () => {
    const known = new Set(ALL_REGIONS.map((r) => r.id));
    for (const region of ALL_REGIONS) {
      const points: { label: string; pos: Vec2 }[] = [
        { label: 'new-game', pos: { x: region.town.pos.x, y: region.town.pos.y + 500 } },
        { label: 'shrine-respawn', pos: { x: region.shrine.pos.x + 120, y: region.shrine.pos.y + 120 } },
        ...(region.waypoints ?? []).map((w) => ({ label: `waypoint:${w.id}`, pos: w.pos })),
        ...(region.gyms ?? []).map((g) => ({ label: `gym:${g.gymId}`, pos: g.pos })),
        ...(region.dungeons ?? []).map((d) => ({ label: `dungeon:${d.id}`, pos: d.pos })),
        ...(region.gates ?? []).map((g) => ({ label: `gate:${g.id}`, pos: g.pos }))
      ];
      for (const gate of region.gates ?? []) {
        if (!known.has(gate.toRegionId)) continue;
        const dest = REG.region(gate.toRegionId);
        expect(clearanceToTerrainSolids(dest, gate.toPos), `${region.id} -> ${gate.toRegionId} via ${gate.id}`).toBeGreaterThanOrEqual(HERO_RADIUS);
      }
      for (const point of points) {
        expect(clearanceToTerrainSolids(region, point.pos), `${region.id}: ${point.label}`).toBeGreaterThanOrEqual(HERO_RADIUS);
      }
    }
  });
});
