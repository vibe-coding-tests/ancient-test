import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, hashString } from '../core/rng';
import { contactCircleObstacle, staticCircleObstacle } from '../core/collision';
import type { CollisionObstacleInput, RegionDef, Vec2 } from '../core/types';
import { TUNING } from '../data/tuning';
import { WORLD_SCALE } from './scale';
import { loadTex, loadModel, instancedFromModel } from './asset-loaders';
import {
  CHEST_COLLISION,
  CRATE_COLLISION,
  DRESSING_PROP_COLLISION,
  DRESSING_PROP_SIZES,
  FOLIAGE_COLLISION,
  FOLIAGE_SIZES,
  LAMP_POST_COLLISION,
  REGION_TRIGGER_COLLISION,
  SHRINE_COLLISION,
  TOWN_BUILDING_COLLISION,
  TOWN_BUILDING_SIZE,
  TOWN_LANDMARK_COLLISION,
  TOWN_LANDMARK_SIZE,
  type WorldCollisionSpec
} from '../data/world/props';

// ------------------------------------------------------------------
// Procedural low-poly terrain: vertex-jittered plane, painted height
// bands, scattered trees/rocks as instanced meshes (SPEC §3).
// Heights are gentle: gameplay treats the world as 2D with visual relief.
// ------------------------------------------------------------------

export interface TerrainInfo {
  group: THREE.Group;
  heightAt(simX: number, simY: number): number; // world-units height
  obstacles: CollisionObstacleInput[];
  setStaticPropShadows?(enabled: boolean): void;
  /** Advances animated materials (water ripples). No-op when none. */
  update?(time: number): void;
}

type SceneLiveCheck = () => boolean;
interface TerrainBuildOptions {
  staticPropShadows?: boolean;
  /** 0..1 tuft-density multiplier from the quality preset; 0 (low tier) skips the grass layer entirely. */
  grassDensity?: number;
}

function pushWorldContactObstacle(
  obstacles: CollisionObstacleInput[] | undefined,
  args: { id: string; pos: { x: number; y: number }; radius?: number; source: string; spec: WorldCollisionSpec | Omit<WorldCollisionSpec, 'radius'> }
): void {
  if (!obstacles) return;
  const radius = args.radius ?? ('radius' in args.spec ? args.spec.radius : 0);
  if (radius <= 0) return;
  obstacles.push(contactCircleObstacle({
    pos: args.pos,
    radius,
    id: args.id,
    source: args.source,
    layer: args.spec.layer,
    mode: args.spec.mode,
    blocksProjectiles: args.spec.blocksProjectiles,
    blocksVision: args.spec.mode === 'solid',
    interactable: args.spec.mode !== 'decor',
    feedbackLabel: args.spec.label
  }));
}

function markStaticShadowCaster(obj: THREE.Object3D, enabled: boolean): void {
  obj.userData.staticPropCaster = true;
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh) mesh.castShadow = enabled;
}

/** Signature that groups visually identical `MeshStandardMaterial`s built inline
 *  by the procedural prop builders, so a merge can reuse one material instance. */
function standardMaterialKey(m: THREE.MeshStandardMaterial): string {
  return [
    m.color.getHex(),
    m.emissive ? m.emissive.getHex() : 0,
    m.emissiveIntensity ?? 0,
    (m.roughness ?? 1).toFixed(3),
    (m.metalness ?? 0).toFixed(3),
    m.flatShading ? 1 : 0,
    m.side,
    m.transparent ? 1 : 0,
    (m.opacity ?? 1).toFixed(3)
  ].join('|');
}

interface StaticBatchEntry {
  obj: THREE.Object3D;
  /** Whether this prop should feed the sun's shadow map (small dressing opts out). */
  shadow: boolean;
}

function isEmissiveMaterial(m: THREE.MeshStandardMaterial): boolean {
  const e = m.emissive;
  return !!e && e.r + e.g + e.b > 0 && (m.emissiveIntensity ?? 0) > 0;
}

/** Collapse a set of static, never-animated meshes into far fewer draw calls —
 *  in the beauty *and* shadow passes — without changing what's on screen.
 *
 *  Non-emissive geometry is merged by material: each mesh's world transform is
 *  baked into a shared `BufferGeometry`, so the merged mesh sits at the world
 *  origin with identity transform (the geometry already carries the placement).
 *  Emissive meshes are kept individual and reparented with their world transform
 *  intact, so they stay countable by the plaza bloom-budget guard
 *  (`town-layout.test.ts`) and read at their real positions. Only shadow-casting
 *  batches are tagged so the runtime quality toggle still reaches them. */
function batchStaticProps(entries: StaticBatchEntry[], staticPropShadows: boolean): THREE.Object3D[] {
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const out: THREE.Object3D[] = [];
  for (const { obj, shadow } of entries) {
    obj.updateWorldMatrix(true, true);
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      mesh.receiveShadow = true;
      if (isEmissiveMaterial(material)) {
        // Keep the glow as its own mesh, re-seated at its true world transform.
        mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.matrixAutoUpdate = true;
        mesh.matrixWorldNeedsUpdate = true;
        if (shadow) {
          mesh.userData.staticPropCaster = true;
          mesh.castShadow = staticPropShadows;
        } else {
          mesh.castShadow = false;
        }
        out.push(mesh);
        return;
      }
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      const key = `${shadow ? 's' : '_'}|${standardMaterialKey(material)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material, geos: [], shadow };
        buckets.set(key, bucket);
      }
      bucket.geos.push(geo);
    });
  }
  for (const { material, geos, shadow } of buckets.values()) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) {
      // mergeGeometries can bail on mismatched attributes; fall back to one mesh
      // per geometry so nothing silently disappears from the town.
      for (const geo of geos) out.push(makeBatchedMesh(geo, material, shadow, staticPropShadows));
      continue;
    }
    out.push(makeBatchedMesh(merged, material, shadow, staticPropShadows));
  }
  return out;
}

function makeBatchedMesh(geo: THREE.BufferGeometry, material: THREE.Material, shadow: boolean, staticPropShadows: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.matrixAutoUpdate = false;
  mesh.receiveShadow = true;
  if (shadow) {
    mesh.userData.staticPropCaster = true;
    mesh.castShadow = staticPropShadows;
  } else {
    mesh.castShadow = false;
  }
  return mesh;
}

// Generated grayscale ground-detail texture (GRAPHICS_SPEC §5.1): mostly white
// so it barely darkens the painted height bands, with sparse speckle + soft
// blotches for a hand-painted read. Browser-only; null under node tests.
function makeGroundDetail(rng: Rng): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = 232 + rng.next() * 23; // 232..255, subtle grain
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let b = 0; b < 80; b++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const r = 6 + rng.next() * 46;
    const dark = rng.next() < 0.55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? 'rgba(70,66,56,0.22)' : 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------
// Billboard grass tufts (GRAPHICS_SPEC §13 Phase 2 — the last foliage
// item). Deterministic instanced cross-quads scattered over the open
// ground, tier-gated (low tier = none) and biome-weighted so arid maps
// stay sparse. Placement is a pure function so it can be unit-tested
// headlessly; the mesh/texture build is browser-guarded like the rest.
// ------------------------------------------------------------------

export interface GrassTuft {
  x: number; // sim-units
  y: number; // sim-units
  scale: number;
  rot: number; // radians about Y
}

// How lush each biome reads. Lawns/woods are dense; snow/sand/ash are sparse.
const GRASS_BIOME_SCALE: Record<RegionDef['biome'], number> = {
  grass: 1,
  forest: 0.85,
  coast: 0.7,
  snow: 0.22,
  desert: 0.12,
  wasteland: 0.2
};

/**
 * Deterministic grass-tuft placement. Pure (no three/DOM): given a region and
 * the quality preset's `density` (0..1), returns the world-plane positions to
 * instance. Empty when density is 0 (low tier) so the no-tuft floor is exact.
 * Keeps clearings around town/camps/spawns/dungeons so tufts never poke through
 * structures or fight markers.
 */
export function planGrassTufts(region: RegionDef, density: number): GrassTuft[] {
  if (density <= 0) return [];
  const biomeScale = GRASS_BIOME_SCALE[region.biome] ?? 0.6;
  // Vegetation correlates with tree density, so lean on it (half floor, half
  // scaled) to keep the count proportional to how green the region already is.
  const target = Math.floor(1100 * density * biomeScale * (0.5 + region.props.treeDensity * 0.5));
  if (target <= 0) return [];
  const clearings = [
    { x: region.town.pos.x, y: region.town.pos.y, r: region.town.radius + 150 },
    ...region.camps.map((c) => ({ x: c.pos.x, y: c.pos.y, r: c.radius + 120 })),
    ...region.heroSpawns.map((h) => ({ x: h.pos.x, y: h.pos.y, r: 240 })),
    ...(region.dungeons ?? []).map((d) => ({ x: d.pos.x, y: d.pos.y, r: d.radius + 150 }))
  ];
  const isClear = (x: number, y: number): boolean =>
    clearings.every((c) => Math.hypot(x - c.x, y - c.y) > c.r);
  // Dedicated seed offset so grass placement is independent of tree/rock RNG.
  const rng = new Rng(region.seed + 5150);
  const tufts: GrassTuft[] = [];
  for (let i = 0; i < target * 4 && tufts.length < target; i++) {
    const x = rng.range(300, region.size - 300);
    const y = rng.range(300, region.size - 300);
    if (!isClear(x, y)) continue;
    tufts.push({ x, y, scale: rng.range(0.7, 1.55), rot: rng.range(0, Math.PI) });
  }
  return tufts;
}

// A small alpha-tested grass-blade sprite (a few tapered blades), green baked in
// so it reads even before any material tint multiplies it. Browser-only.
function makeGrassTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  const blades = [
    { x: 0.5, sway: 0.0, w: 0.1, top: 0.06, hue: '#5c9447' },
    { x: 0.34, sway: -0.14, w: 0.085, top: 0.16, hue: '#4a7c3a' },
    { x: 0.66, sway: 0.14, w: 0.085, top: 0.14, hue: '#6fae57' },
    { x: 0.22, sway: -0.06, w: 0.07, top: 0.28, hue: '#42703a' },
    { x: 0.78, sway: 0.07, w: 0.07, top: 0.26, hue: '#79b863' }
  ];
  for (const b of blades) {
    const baseX = b.x * size;
    const halfW = (b.w * size) / 2;
    const topX = (b.x + b.sway) * size;
    const topY = b.top * size;
    const grad = ctx.createLinearGradient(0, size, 0, topY);
    grad.addColorStop(0, '#2f5a2c');
    grad.addColorStop(1, b.hue);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX - halfW, size);
    ctx.quadraticCurveTo(baseX - halfW * 0.5, size * 0.5, topX, topY);
    ctx.quadraticCurveTo(baseX + halfW * 0.5, size * 0.5, baseX + halfW, size);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

// Two perpendicular quads crossing at the stem so a tuft reads from any camera
// angle without per-frame billboarding. Base sits on y=0; grows up +Y.
function crossQuadGeometry(w: number, h: number): THREE.BufferGeometry {
  const hw = w / 2;
  const positions = [
    -hw, 0, 0, hw, 0, 0, hw, h, 0, -hw, h, 0,
    0, 0, -hw, 0, 0, hw, 0, h, hw, 0, h, -hw
  ];
  // Ground-level vertices (y=0) take v=0 and the tips (y=h) take v=1 so the
  // blade roots sample the bottom of the (flipY) canvas, not the tips. Without
  // this the tufts render upside down.
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const index = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function buildGrassTufts(
  tufts: GrassTuft[],
  heightAt: (x: number, y: number) => number,
  colors: BiomePalette
): THREE.InstancedMesh | null {
  if (tufts.length === 0) return null;
  const geo = crossQuadGeometry(2.0, 1.7);
  const mat = new THREE.MeshStandardMaterial({
    map: makeGrassTexture(),
    color: new THREE.Color(colors.tree).lerp(new THREE.Color(colors.high), 0.35),
    alphaTest: 0.42,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
    flatShading: false
  });
  const inst = new THREE.InstancedMesh(geo, mat, tufts.length);
  const m4 = new THREE.Matrix4();
  const yUp = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < tufts.length; i++) {
    const t = tufts[i];
    const q = new THREE.Quaternion().setFromAxisAngle(yUp, t.rot);
    m4.compose(
      new THREE.Vector3(t.x / WORLD_SCALE, heightAt(t.x, t.y), t.y / WORLD_SCALE),
      q,
      new THREE.Vector3(t.scale, t.scale, t.scale)
    );
    inst.setMatrixAt(i, m4);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = false;
  inst.receiveShadow = false;
  inst.userData.grassTufts = true;
  return inst;
}

function valueNoise(rng: Rng, gridN: number): number[][] {
  const g: number[][] = [];
  for (let i = 0; i <= gridN; i++) {
    g.push([]);
    for (let j = 0; j <= gridN; j++) g[i].push(rng.next());
  }
  return g;
}

function sampleNoise(grid: number[][], u: number, v: number): number {
  const n = grid.length - 1;
  const x = Math.min(n - 1e-6, Math.max(0, u * n));
  const y = Math.min(n - 1e-6, Math.max(0, v * n));
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = grid[i][j];
  const b = grid[i + 1][j];
  const c = grid[i][j + 1];
  const d = grid[i + 1][j + 1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

type BiomePalette = { low: number; mid: number; high: number; tree: number; trunk: number; rock: number };
type TerrainEdgeHeights = { south: number[]; east: number[]; north: number[]; west: number[] };

const BIOME_COLORS: Record<string, BiomePalette> = {
  grass: { low: 0x4a7c3a, mid: 0x5c9447, high: 0x7daf5e, tree: 0x3e7a34, trunk: 0x6b4a2c, rock: 0x8d8d99 },
  snow: { low: 0xc8d8e8, mid: 0xe8f0f8, high: 0xffffff, tree: 0x4a6b5c, trunk: 0x52404a, rock: 0x9aa6b8 },
  desert: { low: 0xc8a05c, mid: 0xd8b06c, high: 0xe8c87c, tree: 0x7a8a3a, trunk: 0x8a6a3a, rock: 0xa08a6a },
  wasteland: { low: 0x5a4a4a, mid: 0x6b5a52, high: 0x7c6a5e, tree: 0x4a3a3a, trunk: 0x3a2a2a, rock: 0x6a5a5a },
  coast: { low: 0x5c9447, mid: 0x7daf5e, high: 0xc8b87c, tree: 0x3e7a34, trunk: 0x6b4a2c, rock: 0x8d8d99 },
  forest: { low: 0x2e5c28, mid: 0x3e7a34, high: 0x5c9447, tree: 0x2a5224, trunk: 0x52402c, rock: 0x7d7d89 }
};

// Phase 1 (GRAPHICS_SPEC §13): ground each biome with a real ambientCG PBR
// surface (CC0) when the files are present. Maps are loaded async and best-
// effort, so the vertex-painted material below is always the live fallback.
const TERRAIN_PBR_SET: Record<string, string> = {
  grass: 'Grass001',
  forest: 'Grass001',
  coast: 'Grass001',
  snow: 'Snow010A',
  desert: 'Ground080',
  wasteland: 'Ground048'
};

function applyTerrainPBR(mat: THREE.MeshStandardMaterial, biome: string, repeat: number, isLive: SceneLiveCheck): void {
  const set = TERRAIN_PBR_SET[biome] ?? TERRAIN_PBR_SET.grass;
  const base = `/assets/textures/terrain/${set}`;
  void Promise.all([
    loadTex(`${base}_Color.jpg`, { srgb: true, repeat }),
    loadTex(`${base}_NormalGL.jpg`, { repeat }),
    loadTex(`${base}_Roughness.jpg`, { repeat })
  ]).then(([color, normal, rough]) => {
    if (!isLive()) return;
    if (!color && !normal && !rough) return; // headless / all failed: keep the painted floor
    if (color) mat.map = color;
    if (normal) {
      mat.normalMap = normal;
      mat.normalScale = new THREE.Vector2(0.7, 0.7);
    }
    if (rough) {
      mat.roughnessMap = rough;
      mat.roughness = 1;
    }
    mat.flatShading = false; // smooth base normals so the normal map reads cleanly
    mat.needsUpdate = true;
  });
}

function buildTerrainEdge(sizeW: number, edgeHeights: TerrainEdgeHeights, colors: BiomePalette): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain-edge';

  const positions: number[] = [];
  const indices: number[] = [];
  const bottomY = -2.4;
  const rimLift = 0.08;
  const seg = edgeHeights.south.length - 1;
  const step = sizeW / seg;

  const addQuad = (
    topA: [number, number, number],
    bottomA: [number, number, number],
    topB: [number, number, number],
    bottomB: [number, number, number]
  ): void => {
    const base = positions.length / 3;
    positions.push(...topA, ...bottomA, ...topB, ...bottomB);
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  };

  for (let i = 0; i < seg; i++) {
    const a = i * step;
    const b = (i + 1) * step;
    addQuad([a, edgeHeights.south[i], 0], [a, bottomY, 0], [b, edgeHeights.south[i + 1], 0], [b, bottomY, 0]);
    addQuad([sizeW, edgeHeights.east[i], a], [sizeW, bottomY, a], [sizeW, edgeHeights.east[i + 1], b], [sizeW, bottomY, b]);
    addQuad([b, edgeHeights.north[i + 1], sizeW], [b, bottomY, sizeW], [a, edgeHeights.north[i], sizeW], [a, bottomY, sizeW]);
    addQuad([0, edgeHeights.west[i + 1], b], [0, bottomY, b], [0, edgeHeights.west[i], a], [0, bottomY, a]);
  }

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  wallGeo.setIndex(indices);
  wallGeo.computeVertexNormals();
  const wallColor = new THREE.Color(colors.low).lerp(new THREE.Color(0x24313a), 0.45);
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.98,
    metalness: 0.01,
    flatShading: true,
    side: THREE.DoubleSide
  }));
  wall.receiveShadow = true;
  group.add(wall);

  const rimPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= seg; i++) rimPoints.push(new THREE.Vector3(i * step, edgeHeights.south[i] + rimLift, 0));
  for (let i = 1; i <= seg; i++) rimPoints.push(new THREE.Vector3(sizeW, edgeHeights.east[i] + rimLift, i * step));
  for (let i = seg - 1; i >= 0; i--) rimPoints.push(new THREE.Vector3(i * step, edgeHeights.north[i] + rimLift, sizeW));
  for (let i = seg - 1; i > 0; i--) rimPoints.push(new THREE.Vector3(0, edgeHeights.west[i] + rimLift, i * step));
  rimPoints.push(rimPoints[0].clone());
  const rimColor = new THREE.Color(colors.high).lerp(new THREE.Color(0xffffff), 0.25);
  const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPoints), new THREE.LineBasicMaterial({
    color: rimColor,
    transparent: true,
    opacity: 0.6,
    depthWrite: false
  }));
  rim.renderOrder = 2;
  group.add(rim);

  return group;
}

// Phase 2 (GRAPHICS_SPEC §13): authored Quaternius foliage/props + buildings
// (CC0). Loaded async; the instanced primitives / box huts stay live until the
// GLBs arrive, so no-asset and headless runs keep the procedural silhouette.
export const FOLIAGE_BASE = '/assets/props/foliage';
export const TOWN_BASE = '/assets/props/town';

export const TREE_MODELS: Record<string, string[]> = {
  grass: ['oak_1', 'oak_2', 'pine_1'],
  forest: ['oak_1', 'oak_2', 'oak_4', 'pine_1', 'pine_2'],
  coast: ['oak_1', 'pine_1'],
  snow: ['pine_2', 'pine_4'],
  desert: ['oak_4'],
  wasteland: ['oak_4', 'pine_4']
};
export const ROCK_MODELS = ['rock_1', 'rock_2', 'rock_3'];
export const TOWN_BUILDINGS = ['house_1', 'house_2', 'house_3', 'inn', 'blacksmith'];

/** Buildings sit on an evenly-spaced ring around the plaza. */
export const TOWN_BUILDING_COUNT = 6;

/** Phase of the building ring. Chosen so a *street* (not a building) faces the +y
 *  direction, which is where every standard spawn sits (new game spawns at town
 *  +(0,500); shrine respawns just inside). With six evenly-spaced buildings the
 *  gaps sit at `offset + PI/6 + k*(PI/3)`; PI/3 puts one of those gaps at +y (PI/2),
 *  so a respawned party always faces an open lane out of the plaza. */
const TOWN_BUILDING_ANGLE_OFFSET = Math.PI / 3;

/** Compute the building-ring radius (sim units) for a town of the given radius.
 *
 *  The historical `town.radius * 0.76` packed six radius-300 buildings so tightly
 *  that adjacent collision circles nearly touched: for the smaller towns the gaps
 *  shrank below a hero's diameter, sealing a respawned party inside the ring (most
 *  visibly in Moonwake, the second town). We instead clamp the ring outward so the
 *  street between neighbours always clears a comfortable lane, regardless of how
 *  small a region authors its `town.radius`.
 */
export function townBuildingRingRadius(townRadiusSim: number): number {
  // Adjacent centres on an N-ring sit `2 * R * sin(pi/N)` apart. Require that to
  // exceed two building radii plus a walkable lane.
  const lane = TUNING.unitRadiusHero * 2 * 3; // hero diameter * 3: a clearly passable street
  const minSpacing = 2 * TOWN_BUILDING_COLLISION.radius + lane;
  const minRing = minSpacing / (2 * Math.sin(Math.PI / TOWN_BUILDING_COUNT));
  return Math.max(townRadiusSim * 0.76, minRing);
}

/** Deterministic plan of town-building collision footprints (sim coords). Shared
 *  by the mesh build and by tests that assert every town stays escapable. */
export function planTownBuildings(region: RegionDef): { pos: Vec2; radius: number; angle: number }[] {
  const ring = townBuildingRingRadius(region.town.radius);
  const out: { pos: Vec2; radius: number; angle: number }[] = [];
  for (let i = 0; i < TOWN_BUILDING_COUNT; i++) {
    const angle = (i / TOWN_BUILDING_COUNT) * Math.PI * 2 + TOWN_BUILDING_ANGLE_OFFSET;
    out.push({
      pos: {
        x: region.town.pos.x + Math.cos(angle) * ring,
        y: region.town.pos.y + Math.sin(angle) * ring
      },
      radius: TOWN_BUILDING_COLLISION.radius,
      angle
    });
  }
  return out;
}

function modelUrls(base: string, names: string[]): string[] {
  return names.map((n) => `${base}/${n}.glb`);
}

/** Clone an authored scene, seat its base at y=0, and scale it to `targetHeight`. */
function normalizedClone(scene: THREE.Object3D, targetHeight: number): THREE.Group {
  const clone = scene.clone(true) as THREE.Group;
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const k = targetHeight / (size.y || 1);
  clone.scale.setScalar(k);
  clone.position.y = -box.min.y * k;
  clone.updateMatrixWorld(true);
  return clone;
}

/** Once authored GLBs load, instance them across the placements and hide the fallback. */
function swapToInstancedModels(
  group: THREE.Group,
  fallback: THREE.Object3D[],
  urls: string[],
  matrices: THREE.Matrix4[],
  targetHeight: number,
  isLive: SceneLiveCheck,
  staticPropShadows: boolean
): void {
  if (!matrices.length || !urls.length) return;
  void Promise.all(urls.map((u) => loadModel(u))).then((scenes) => {
    if (!isLive()) return;
    const loaded = scenes.filter((s): s is THREE.Group => !!s);
    if (!loaded.length) return; // keep the procedural fallback
    const models = loaded.map((s) => normalizedClone(s, targetHeight));
    const buckets: THREE.Matrix4[][] = models.map(() => []);
    matrices.forEach((m, i) => buckets[i % models.length].push(m));
    models.forEach((model, idx) => {
      if (!buckets[idx].length) return;
      for (const inst of instancedFromModel(model, buckets[idx])) {
        markStaticShadowCaster(inst, staticPropShadows);
        group.add(inst);
      }
    });
    for (const f of fallback) f.visible = false;
  });
}

/** The town's central `landmark` (OVERWORLD_PLANNING §3): a tiered stone monument
 *  crowned with a beacon, fit to the declared `TOWN_LANDMARK_SIZE.heightM` so it reads
 *  as the tallest thing in the region and frames the 1.8 m hero at its foot. */
function buildTownMonument(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a8694, flatShading: true, roughness: 0.74, metalness: 0.12 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xb6b0c0, flatShading: true, roughness: 0.5, metalness: 0.3 });
  // Built in normalized units, then scaled so the whole stack reads at the target height.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.4, 1.4, 8), stone);
  base.position.y = 0.7;
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 2.6), stone);
  step.position.y = 1.6;
  step.rotation.y = Math.PI / 4;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.95, 7.4, 6), stone);
  shaft.position.y = 5.7;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 6), trim);
  collar.position.y = 9.5;
  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85),
    new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc24a, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.1 })
  );
  beacon.position.y = 10.9;
  beacon.name = 'monument-beacon';
  g.add(base, step, shaft, collar, beacon);
  // Fit the assembled height (built ≈ 11.75 m) to the declared landmark height.
  const box = new THREE.Box3().setFromObject(g);
  const builtH = box.getSize(new THREE.Vector3()).y || 1;
  g.scale.setScalar(TOWN_LANDMARK_SIZE.heightM / builtH);
  return g;
}

/** Once building GLBs load, place a varied one per hut slot and hide the box huts. */
function swapTownBuildings(
  g: THREE.Group,
  fallback: THREE.Object3D[],
  placements: { x: number; z: number; baseY: number; rotY: number }[],
  isLive: SceneLiveCheck,
  staticPropShadows: boolean
): void {
  if (!placements.length) return;
  void Promise.all(modelUrls(TOWN_BASE, TOWN_BUILDINGS).map((u) => loadModel(u))).then((scenes) => {
    if (!isLive()) return;
    const loaded = scenes.filter((s): s is THREE.Group => !!s);
    if (!loaded.length) return;
    placements.forEach((p, i) => {
      const b = normalizedClone(loaded[i % loaded.length], TOWN_BUILDING_SIZE.heightM);
      b.position.x = p.x;
      b.position.z = p.z;
      b.position.y += p.baseY;
      b.rotation.y = p.rotY;
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          markStaticShadowCaster(m, staticPropShadows);
          m.receiveShadow = true;
        }
      });
      g.add(b);
    });
    for (const f of fallback) f.visible = false;
  });
}

// ------------------------------------------------------------------
// Town set dressing (ASSET_GAPS P2): props + ambient presence that make a
// town read as inhabited. Authored GLBs already on disk (well/cart/barrel/
// market_stand) are placed with a procedural fallback so the floor still
// renders with public/assets empty; lamp posts, a quest/notice board, crates,
// a banner, and a few villager standees are built from primitives.
// ------------------------------------------------------------------

/** A warm-lit lamp post: pole + arm + emissive lantern (named for day/night dimming). */
function buildLampPost(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.85, metalness: 0.05, flatShading: true });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.3, 6), wood);
  pole.position.y = 1.15;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), wood);
  arm.position.set(0.22, 2.16, 0);
  const lantern = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.36, 0.26),
    new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc55a, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0.08 })
  );
  lantern.position.set(0.42, 1.99, 0);
  lantern.name = 'lamp-glow';
  g.add(pole, arm, lantern);
  return g;
}

/** A simple robed townsperson built from primitives — static ambient presence. */
function buildVillager(palette: { robe: number; trim: number; skin: number }): THREE.Group {
  const g = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({ color: palette.robe, roughness: 0.92, metalness: 0.02, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.82, metalness: 0.04, flatShading: true });
  const skinMat = new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.7, metalness: 0.02, flatShading: true });
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.37, 0.8, 7), robeMat);
  robe.position.y = 0.5;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.26, 0.34, 7), trimMat);
  torso.position.y = 0.97;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 8, 6), skinMat);
  head.position.y = 1.26;
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.42, 5), robeMat);
  armL.position.set(0.26, 0.92, 0);
  armL.rotation.z = 0.3;
  const armR = armL.clone();
  armR.position.x = -0.26;
  armR.rotation.z = -0.3;
  g.add(robe, torso, head, armL, armR);
  return g;
}

const VILLAGER_PALETTES: { robe: number; trim: number; skin: number }[] = [
  { robe: 0x8a5a3c, trim: 0xcf9a5a, skin: 0xe8c19a },
  { robe: 0x4f6b8a, trim: 0xc8d4e0, skin: 0xd8a87e },
  { robe: 0x6a7a4a, trim: 0xd8c87a, skin: 0xe8c19a },
  { robe: 0x7a4a5a, trim: 0xd8a8b8, skin: 0xc89070 }
];

/** Authored town props already on disk but previously unwired, with a target height. */
const DRESSING_PROPS = {
  well: { url: `${TOWN_BASE}/well.glb`, height: DRESSING_PROP_SIZES.well.heightM },
  cart: { url: `${TOWN_BASE}/cart.glb`, height: DRESSING_PROP_SIZES.cart.heightM },
  barrel: { url: `${TOWN_BASE}/barrel.glb`, height: DRESSING_PROP_SIZES.barrel.heightM },
  market: { url: `${TOWN_BASE}/market_stand_1.glb`, height: DRESSING_PROP_SIZES.market.heightM }
} as const;

/** Load an authored prop GLB and seat it; keep a procedural fallback visible until it lands. */
function placeAuthoredProp(
  g: THREE.Group,
  url: string,
  place: { x: number; z: number; baseY: number; rotY: number; height: number },
  fallback: THREE.Object3D | null,
  isLive: SceneLiveCheck,
  staticPropShadows: boolean
): void {
  void loadModel(url).then((scene) => {
    if (!scene || !isLive()) return;
    const m = normalizedClone(scene, place.height);
    m.position.x = place.x;
    m.position.z = place.z;
    m.position.y += place.baseY;
    m.rotation.y = place.rotY;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        markStaticShadowCaster(mesh, staticPropShadows);
        mesh.receiveShadow = true;
      }
    });
    g.add(m);
    if (fallback) fallback.visible = false;
  });
}

/** Town dressing layer: lamp posts, a quest/notice board, market + cart + barrels,
 *  crates, a banner, and a few villager standees (ASSET_GAPS P2). */
function buildTownDressing(
  region: RegionDef,
  heightAt: (x: number, y: number) => number,
  isLive: SceneLiveCheck,
  staticPropShadows: boolean,
  obstacles?: CollisionObstacleInput[]
): THREE.Group {
  const g = new THREE.Group();
  const t = region.town.pos;
  const wx = t.x / WORLD_SCALE;
  const wz = t.y / WORLD_SCALE;
  const townRadius = region.town.radius / WORLD_SCALE;
  const rng = new Rng(region.seed ^ hashString(`${region.id}:dressing`));

  // World-space point + ground height at a polar offset from the town centre.
  const at = (ang: number, radius: number): { x: number; z: number; baseY: number } => ({
    x: wx + Math.cos(ang) * radius,
    z: wz + Math.sin(ang) * radius,
    baseY: heightAt(t.x + Math.cos(ang) * (radius * WORLD_SCALE), t.y + Math.sin(ang) * (radius * WORLD_SCALE))
  });
  // The procedural dressing is static, so it is merged by material into a few
  // draw calls instead of ~30 tiny meshes (see batchStaticProps). Small props
  // (lamps, board, banner, crates, villagers) opt out of the sun shadow map:
  // their shadows read as noise at this scale and dominate the town shadow pass.
  const batch: StaticBatchEntry[] = [];
  const dress = (obj: THREE.Object3D, p: { x: number; z: number; baseY: number }, rotY: number, shadow = false): void => {
    obj.position.set(p.x, p.baseY, p.z);
    obj.rotation.y = rotY;
    batch.push({ obj, shadow });
  };

  // Lamp posts ringed between the buildings, facing the plaza.
  for (let i = 0; i < TOWN_BUILDING_COUNT; i++) {
    // Offset from the exact gap centre so the street lane itself stays clear for
    // town spawns and respawns.
    const ang = (i / TOWN_BUILDING_COUNT) * Math.PI * 2 + TOWN_BUILDING_ANGLE_OFFSET + Math.PI / 6 + Math.PI / 12;
    const lp = at(ang, townRadius * 0.6);
    dress(buildLampPost(), lp, ang + Math.PI);
    pushWorldContactObstacle(obstacles, {
      id: `town-dressing:lamp:${i}`,
      pos: { x: lp.x * WORLD_SCALE, y: lp.z * WORLD_SCALE },
      source: 'terrain:town-dressing',
      spec: LAMP_POST_COLLISION
    });
  }

  // Quest / notice board — a visible marker for the town's quest-board service.
  const boardAng = 0.4 - 0.7;
  const boardPos = at(boardAng, townRadius * 0.32);
  const boardGroup = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a4128, roughness: 0.88, metalness: 0.04, flatShading: true });
  const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.5, 6), woodMat);
  postL.position.set(-0.5, 0.75, 0);
  const postR = postL.clone();
  postR.position.x = 0.5;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.95, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xe6d3a3, emissive: 0x6a5630, emissiveIntensity: 0.45, roughness: 0.7, metalness: 0.05 })
  );
  board.position.set(0, 1.25, 0.02);
  board.name = 'quest-board';
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.4), woodMat);
  roof.position.set(0, 1.78, 0);
  boardGroup.add(postL, postR, board, roof);
  dress(boardGroup, boardPos, boardAng + Math.PI);

  // Banner pole near the plaza edge.
  const bannerPos = at(0.4 + Math.PI, townRadius * 0.28);
  const bannerGroup = new THREE.Group();
  const bpole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 3.2, 6), woodMat);
  bpole.position.y = 1.6;
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.9, 1.0),
    new THREE.MeshStandardMaterial({ color: 0xb8423a, roughness: 0.7, metalness: 0.05, flatShading: true, side: THREE.DoubleSide })
  );
  flag.position.set(0, 2.7, 0.52);
  bannerGroup.add(bpole, flag);
  dress(bannerGroup, bannerPos, rng.next() * Math.PI * 2);

  // Market + cart + barrels + crates near the shop stall corner.
  const shopAng = 0.4 + Math.PI / 6;
  const marketPos = at(shopAng - 0.34, townRadius * 0.4);
  const marketFb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 1.0), woodMat);
  marketFb.position.set(marketPos.x, marketPos.baseY + 0.6, marketPos.z);
  marketFb.rotation.y = shopAng;
  markStaticShadowCaster(marketFb, staticPropShadows);
  g.add(marketFb);
  placeAuthoredProp(g, DRESSING_PROPS.market.url, { ...marketPos, rotY: shopAng + Math.PI, height: DRESSING_PROPS.market.height }, marketFb, isLive, staticPropShadows);
  pushWorldContactObstacle(obstacles, {
    id: 'town-dressing:market',
    pos: { x: marketPos.x * WORLD_SCALE, y: marketPos.z * WORLD_SCALE },
    source: 'terrain:town-dressing',
    spec: DRESSING_PROP_COLLISION.market
  });

  const cartPos = at(shopAng + 0.42, townRadius * 0.42);
  const cartFb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.8), woodMat);
  cartFb.position.set(cartPos.x, cartPos.baseY + 0.4, cartPos.z);
  cartFb.rotation.y = shopAng + 1.2;
  markStaticShadowCaster(cartFb, staticPropShadows);
  g.add(cartFb);
  placeAuthoredProp(g, DRESSING_PROPS.cart.url, { ...cartPos, rotY: shopAng + 1.2, height: DRESSING_PROPS.cart.height }, cartFb, isLive, staticPropShadows);
  pushWorldContactObstacle(obstacles, {
    id: 'town-dressing:cart',
    pos: { x: cartPos.x * WORLD_SCALE, y: cartPos.z * WORLD_SCALE },
    source: 'terrain:town-dressing',
    spec: DRESSING_PROP_COLLISION.cart
  });

  // A couple of barrels by the cart.
  for (let i = 0; i < 2; i++) {
    const bp = at(shopAng + 0.55 + i * 0.12, townRadius * 0.38);
    const barrelFb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.36, 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.85, metalness: 0.04, flatShading: true })
    );
    barrelFb.position.set(bp.x, bp.baseY + 0.45, bp.z);
    markStaticShadowCaster(barrelFb, staticPropShadows);
    g.add(barrelFb);
    placeAuthoredProp(g, DRESSING_PROPS.barrel.url, { ...bp, rotY: rng.next() * Math.PI * 2, height: DRESSING_PROPS.barrel.height }, barrelFb, isLive, staticPropShadows);
    pushWorldContactObstacle(obstacles, {
      id: `town-dressing:barrel:${i}`,
      pos: { x: bp.x * WORLD_SCALE, y: bp.z * WORLD_SCALE },
      source: 'terrain:town-dressing',
      spec: DRESSING_PROP_COLLISION.barrel
    });
  }

  // Well, opposite the shop.
  const wellPos = at(shopAng + Math.PI, townRadius * 0.46);
  const wellFb = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.8, 1.0, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.8, metalness: 0.06, flatShading: true })
  );
  wellFb.position.set(wellPos.x, wellPos.baseY + 0.5, wellPos.z);
  markStaticShadowCaster(wellFb, staticPropShadows);
  g.add(wellFb);
  placeAuthoredProp(g, DRESSING_PROPS.well.url, { ...wellPos, rotY: rng.next() * Math.PI * 2, height: DRESSING_PROPS.well.height }, wellFb, isLive, staticPropShadows);
  pushWorldContactObstacle(obstacles, {
    id: 'town-dressing:well',
    pos: { x: wellPos.x * WORLD_SCALE, y: wellPos.z * WORLD_SCALE },
    source: 'terrain:town-dressing',
    spec: DRESSING_PROP_COLLISION.well
  });

  // Crate cluster near the market.
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5630, roughness: 0.88, metalness: 0.03, flatShading: true });
  const cratePos = at(shopAng - 0.5, townRadius * 0.34);
  // One collider covering the cluster (the third crate is stacked on top, so the
  // ground footprint is the two base crates plus their scatter).
  pushWorldContactObstacle(obstacles, {
    id: 'town-dressing:crates',
    pos: { x: cratePos.x * WORLD_SCALE, y: cratePos.z * WORLD_SCALE },
    source: 'terrain:town-dressing',
    spec: CRATE_COLLISION
  });
  for (let i = 0; i < 3; i++) {
    const s = 0.45 + rng.next() * 0.18;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    const ox = (rng.next() - 0.5) * 0.7;
    const oz = (rng.next() - 0.5) * 0.7;
    crate.position.set(cratePos.x + ox, cratePos.baseY + s / 2 + (i === 2 ? 0.45 : 0), cratePos.z + oz);
    crate.rotation.y = rng.next() * Math.PI;
    batch.push({ obj: crate, shadow: false });
  }

  // Villager standees by the board and the market (vendor / quest-giver presence).
  const villagerSpots: { ang: number; radius: number }[] = [
    { ang: boardAng + 0.25, radius: townRadius * 0.3 },
    { ang: shopAng - 0.2, radius: townRadius * 0.34 },
    { ang: shopAng + 0.18, radius: townRadius * 0.32 }
  ];
  villagerSpots.forEach((spot, i) => {
    const v = buildVillager(VILLAGER_PALETTES[(i + Math.floor(rng.next() * 4)) % VILLAGER_PALETTES.length]);
    const p = at(spot.ang, spot.radius);
    // Face roughly toward the plaza centre, with a little jitter.
    dress(v, p, spot.ang + Math.PI + (rng.next() - 0.5) * 0.8);
  });

  for (const merged of batchStaticProps(batch, staticPropShadows)) g.add(merged);
  return g;
}

function pushRegionContactObstacles(region: RegionDef, obstacles: CollisionObstacleInput[]): void {
  pushWorldContactObstacle(obstacles, {
    id: 'shrine',
    pos: region.shrine.pos,
    source: 'region:shrine',
    spec: SHRINE_COLLISION
  });
  for (const gate of region.gates ?? []) {
    pushWorldContactObstacle(obstacles, {
      id: `gate:${gate.id}`,
      pos: gate.pos,
      radius: gate.radius,
      source: 'region:gate',
      spec: REGION_TRIGGER_COLLISION.gate
    });
  }
  for (const portal of region.dungeons ?? []) {
    pushWorldContactObstacle(obstacles, {
      id: `dungeon:${portal.id}`,
      pos: portal.pos,
      radius: portal.radius,
      source: 'region:dungeon',
      spec: REGION_TRIGGER_COLLISION.dungeon
    });
  }
  for (const gym of region.gyms ?? []) {
    pushWorldContactObstacle(obstacles, {
      id: `gym:${gym.gymId}`,
      pos: gym.pos,
      radius: gym.radius,
      source: 'region:gym',
      spec: REGION_TRIGGER_COLLISION.gym
    });
  }
  for (const chest of region.chests ?? []) {
    pushWorldContactObstacle(obstacles, {
      id: `chest:${chest.id}`,
      pos: chest.pos,
      source: 'region:chest',
      spec: CHEST_COLLISION
    });
  }
  for (const waypoint of region.waypoints ?? []) {
    pushWorldContactObstacle(obstacles, {
      id: `waypoint:${waypoint.id}`,
      pos: waypoint.pos,
      radius: waypoint.radius ?? 360,
      source: 'region:waypoint',
      spec: REGION_TRIGGER_COLLISION.waypoint
    });
  }
  for (const discovery of region.discoveries ?? []) {
    pushWorldContactObstacle(obstacles, {
      id: `discovery:${discovery.id}`,
      pos: discovery.pos,
      radius: discovery.radius,
      source: 'region:discovery',
      spec: REGION_TRIGGER_COLLISION.discovery
    });
  }
  for (const shard of region.shards ?? []) {
    pushWorldContactObstacle(obstacles, {
      id: `shard:${shard.id}`,
      pos: shard.pos,
      radius: 180,
      source: 'region:shard',
      spec: REGION_TRIGGER_COLLISION.shard
    });
  }
}

export function buildTerrain(region: RegionDef, isLive: SceneLiveCheck = () => true, opts: TerrainBuildOptions = {}): TerrainInfo {
  const group = new THREE.Group();
  const staticPropShadows = opts.staticPropShadows ?? true;
  const sizeW = region.size / WORLD_SCALE;
  const rng = new Rng(region.seed ^ hashString(region.id));
  const noise = valueNoise(rng, 10);
  const colors = BIOME_COLORS[region.biome] ?? BIOME_COLORS.grass;

  const heightAtUV = (u: number, v: number): number => {
    const base = sampleNoise(noise, u, v);
    // flatten near town
    const tx = region.town.pos.x / region.size;
    const ty = region.town.pos.y / region.size;
    const dTown = Math.hypot(u - tx, v - ty) * region.size;
    const townFlat = Math.min(1, Math.max(0, (dTown - region.town.radius) / 1200));
    return base * 4.2 * townFlat;
  };

  // ground mesh
  const seg = 96;
  const geo = new THREE.PlaneGeometry(sizeW, sizeW, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const heightSamples = new Float32Array((seg + 1) * (seg + 1));
  const colorArr: number[] = [];
  const cLow = new THREE.Color(colors.low);
  const cMid = new THREE.Color(colors.mid);
  const cHigh = new THREE.Color(colors.high);
  const WHITE_TINT = new THREE.Color(0xffffff);
  const jitter = new Rng(region.seed + 77);
  const edgeHeights: TerrainEdgeHeights = {
    south: new Array<number>(seg + 1).fill(0),
    east: new Array<number>(seg + 1).fill(0),
    north: new Array<number>(seg + 1).fill(0),
    west: new Array<number>(seg + 1).fill(0)
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + sizeW / 2;
    const z = pos.getZ(i) + sizeW / 2;
    const u = x / sizeW;
    const v = z / sizeW;
    let h = heightAtUV(u, v);
    // low-poly jitter
    h += (jitter.next() - 0.5) * 0.35;
    pos.setY(i, h);
    const ix = Math.max(0, Math.min(seg, Math.round(u * seg)));
    const iz = Math.max(0, Math.min(seg, Math.round(v * seg)));
    heightSamples[iz * (seg + 1) + ix] = h;
    if (iz === 0) edgeHeights.south[ix] = h;
    if (iz === seg) edgeHeights.north[ix] = h;
    if (ix === 0) edgeHeights.west[iz] = h;
    if (ix === seg) edgeHeights.east[iz] = h;
    const t = Math.min(1, h / 4.2);
    const c = t < 0.45 ? cLow.clone().lerp(cMid, t / 0.45) : cMid.clone().lerp(cHigh, (t - 0.45) / 0.55);
    // Ease the painted band toward neutral so the photographic albedo map (when
    // present) reads through the vertex tint instead of double-saturating it. The
    // CC0 grass/ground albedos are fairly dark, so bias a bit further toward white
    // to keep the lit ground from reading near-black at gameplay zoom.
    c.lerp(WHITE_TINT, 0.32);
    // subtle patchiness
    const shade = 0.92 + jitter.next() * 0.16;
    colorArr.push(c.r * shade, c.g * shade, c.b * shade);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colorArr, 3));
  geo.computeVertexNormals();
  const detail = makeGroundDetail(new Rng(region.seed + 999));
  if (detail) detail.repeat.set(26, 26);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.96,
    metalness: 0.02,
    envMapIntensity: 0.5,
    map: detail ?? null
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.position.set(sizeW / 2, 0, sizeW / 2);
  ground.receiveShadow = true;
  group.add(ground);
  group.add(buildTerrainEdge(sizeW, edgeHeights, colors));
  applyTerrainPBR(mat, region.biome, Math.max(8, Math.round(sizeW / 8)), isLive);

  // Animated shader water ring outside the playfield (GRAPHICS_SPEC §5.4):
  // summed sines ripple the surface and paint deeper troughs / foamy crests.
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x123247) },
      uShallow: { value: new THREE.Color(0x3f86a8) },
      uFoam: { value: new THREE.Color(0x9fd8e8) },
      // Optional tiling normal map (VFX_ASSETS WS-G). uHasNormal stays 0 until
      // the texture loads, so the procedural summed-sine ripple is the floor.
      uNormal: { value: null as THREE.Texture | null },
      uHasNormal: { value: 0 }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vWave;
      varying vec2 vUv;
      void main() {
        float w = sin(position.x * 0.55 + uTime * 1.3) * 0.18
                + sin(position.y * 0.5 - uTime * 1.05) * 0.15
                + sin((position.x + position.y) * 0.3 + uTime * 0.7) * 0.11;
        vWave = w;
        vUv = uv;
        vec3 p = position;
        p.z += w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep, uShallow, uFoam;
      uniform sampler2D uNormal;
      uniform float uHasNormal;
      uniform float uTime;
      varying float vWave;
      varying vec2 vUv;
      void main() {
        float t = clamp(vWave * 2.2 + 0.5, 0.0, 1.0);
        vec3 col = mix(uDeep, uShallow, t);
        col = mix(col, uFoam, smoothstep(0.2, 0.3, vWave));
        if (uHasNormal > 0.5) {
          // Two scrolling samples of the tiling normal break up the surface and
          // add a moving specular sparkle the pure sine ripple can't.
          vec2 uv = vUv * 9.0;
          vec3 n1 = texture2D(uNormal, uv + vec2(uTime * 0.013, uTime * 0.008)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormal, uv * 1.7 - vec2(uTime * 0.009, uTime * 0.011)).xyz * 2.0 - 1.0;
          vec3 n = normalize(n1 + n2);
          float spec = pow(clamp(n.z, 0.0, 1.0), 6.0);
          col += uFoam * spec * 0.35;
        }
        gl_FragColor = vec4(col, 0.94);
      }
    `
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(sizeW * 3, sizeW * 3, 90, 90), waterMat);
  water.rotateX(-Math.PI / 2);
  water.position.set(sizeW / 2, -1.2, sizeW / 2);
  group.add(water);
  void loadTex('/assets/textures/water/water_normal.webp', { repeat: 1 }).then((tex) => {
    if (!tex || !isLive()) return;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    waterMat.uniforms.uNormal.value = tex;
    waterMat.uniforms.uHasNormal.value = 1;
  });

  const heightAt = (simX: number, simY: number): number => {
    const u = simX / region.size;
    const v = simY / region.size;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const gx = Math.max(0, Math.min(seg, u * seg));
    const gz = Math.max(0, Math.min(seg, v * seg));
    const ix = Math.min(seg - 1, Math.floor(gx));
    const iz = Math.min(seg - 1, Math.floor(gz));
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = heightSamples[iz * (seg + 1) + ix];
    const h10 = heightSamples[iz * (seg + 1) + ix + 1];
    const h01 = heightSamples[(iz + 1) * (seg + 1) + ix];
    const h11 = heightSamples[(iz + 1) * (seg + 1) + ix + 1];
    const hx0 = h00 + (h10 - h00) * fx;
    const hx1 = h01 + (h11 - h01) * fx;
    return hx0 + (hx1 - hx0) * fz;
  };

  // scatter props (deterministic), keeping clearings around towns and authored POIs.
  const obstacles: CollisionObstacleInput[] = [];
  const clearings: { x: number; y: number; r: number }[] = [
    { x: region.town.pos.x, y: region.town.pos.y, r: region.town.radius + 250 },
    { x: region.shrine.pos.x, y: region.shrine.pos.y, r: SHRINE_COLLISION.radius + 180 },
    ...region.camps.map((c) => ({ x: c.pos.x, y: c.pos.y, r: c.radius + 320 })),
    ...region.heroSpawns.map((h) => ({ x: h.pos.x, y: h.pos.y, r: 420 })),
    ...(region.echoSpawns ?? []).map((e) => ({ x: e.pos.x, y: e.pos.y, r: 420 })),
    ...(region.gates ?? []).map((g) => ({ x: g.pos.x, y: g.pos.y, r: g.radius + 260 })),
    ...(region.gyms ?? []).map((g) => ({ x: g.pos.x, y: g.pos.y, r: g.radius + 260 })),
    ...(region.dungeons ?? []).map((d) => ({ x: d.pos.x, y: d.pos.y, r: d.radius + 260 })),
    ...(region.chests ?? []).map((c) => ({ x: c.pos.x, y: c.pos.y, r: CHEST_COLLISION.radius + 180 })),
    ...(region.waypoints ?? []).map((w) => ({ x: w.pos.x, y: w.pos.y, r: (w.radius ?? 420) + 180 })),
    ...(region.discoveries ?? []).map((d) => ({ x: d.pos.x, y: d.pos.y, r: d.radius + 180 })),
    ...(region.shards ?? []).map((s) => ({ x: s.pos.x, y: s.pos.y, r: 360 })),
    ...(region.climbPoints ?? []).map((p) => ({ x: p.pos.x, y: p.pos.y, r: 360 })),
    ...(region.glidePoints ?? []).map((p) => ({ x: p.pos.x, y: p.pos.y, r: 360 })),
    ...(region.elementSources ?? []).map((e) => ({ x: e.pos.x, y: e.pos.y, r: e.radius + 180 })),
    ...(region.elementPuzzles ?? []).flatMap((p) => p.nodes.map((n) => ({ x: n.x, y: n.y, r: (p.radius ?? 260) + 180 }))),
    ...(region.secretShop ? [{ x: region.secretShop.pos.x, y: region.secretShop.pos.y, r: 520 }] : [])
  ];
  const isClear = (x: number, y: number) => clearings.every((c) => Math.hypot(x - c.x, y - c.y) > c.r);

  const propRng = new Rng(region.seed + 1234);
  const treeCount = Math.floor(220 * region.props.treeDensity);
  const rockCount = Math.floor(90 * region.props.rockDensity);

  // trees: instanced cone + trunk
  const treeGeo = new THREE.ConeGeometry(0.95, 2.6, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: colors.tree, flatShading: true, roughness: 0.85, metalness: 0.02 });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.0, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: colors.trunk, flatShading: true, roughness: 0.9, metalness: 0.02 });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const m4 = new THREE.Matrix4();
  const yUp = new THREE.Vector3(0, 1, 0);
  // Feet-based transforms reused to instance authored GLB props (Phase 2) over
  // the same deterministic placements once the models load.
  const treeMatrices: THREE.Matrix4[] = [];
  let placedTrees = 0;
  for (let i = 0; i < treeCount * 4 && placedTrees < treeCount; i++) {
    const x = propRng.range(400, region.size - 400);
    const y = propRng.range(400, region.size - 400);
    if (!isClear(x, y)) continue;
    const s = propRng.range(0.8, 1.7);
    const h = heightAt(x, y);
    const wx = x / WORLD_SCALE;
    const wz = y / WORLD_SCALE;
    const qY = new THREE.Quaternion().setFromAxisAngle(yUp, propRng.range(0, Math.PI * 2));
    m4.compose(new THREE.Vector3(wx, h + 1.3 * s + 0.7, wz), qY, new THREE.Vector3(s, s, s));
    trees.setMatrixAt(placedTrees, m4);
    m4.compose(new THREE.Vector3(wx, h + 0.5, wz), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(placedTrees, m4);
    treeMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(wx, h, wz), qY, new THREE.Vector3(s, s, s)));
    obstacles.push(staticCircleObstacle({
      pos: { x, y },
      radius: FOLIAGE_COLLISION.tree.radius * s,
      id: `tree:${placedTrees}`,
      source: 'terrain:foliage',
      layer: FOLIAGE_COLLISION.tree.layer,
      blocksProjectiles: FOLIAGE_COLLISION.tree.blocksProjectiles,
      feedbackLabel: FOLIAGE_COLLISION.tree.label
    }));
    placedTrees++;
  }
  trees.count = placedTrees;
  trunks.count = placedTrees;
  markStaticShadowCaster(trees, staticPropShadows);
  group.add(trees);
  group.add(trunks);
  swapToInstancedModels(group, [trees, trunks], modelUrls(FOLIAGE_BASE, TREE_MODELS[region.biome] ?? TREE_MODELS.grass), treeMatrices, FOLIAGE_SIZES.tree.heightM, isLive, staticPropShadows);

  // rocks
  const rockGeo = new THREE.DodecahedronGeometry(0.8, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: colors.rock, flatShading: true, roughness: 0.7, metalness: 0.08 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  const rockMatrices: THREE.Matrix4[] = [];
  let placedRocks = 0;
  for (let i = 0; i < rockCount * 4 && placedRocks < rockCount; i++) {
    const x = propRng.range(400, region.size - 400);
    const y = propRng.range(400, region.size - 400);
    if (!isClear(x, y)) continue;
    const s = propRng.range(0.6, 2.2);
    const qR = new THREE.Quaternion().setFromEuler(new THREE.Euler(propRng.range(0, 1), propRng.range(0, Math.PI * 2), propRng.range(0, 1)));
    m4.compose(new THREE.Vector3(x / WORLD_SCALE, heightAt(x, y) + 0.3 * s, y / WORLD_SCALE), qR, new THREE.Vector3(s, s * 0.8, s));
    rocks.setMatrixAt(placedRocks, m4);
    rockMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x / WORLD_SCALE, heightAt(x, y), y / WORLD_SCALE), qR, new THREE.Vector3(s, s, s)));
    obstacles.push(staticCircleObstacle({
      pos: { x, y },
      radius: FOLIAGE_COLLISION.rock.radius * s,
      id: `rock:${placedRocks}`,
      source: 'terrain:foliage',
      layer: FOLIAGE_COLLISION.rock.layer,
      blocksProjectiles: FOLIAGE_COLLISION.rock.blocksProjectiles,
      feedbackLabel: FOLIAGE_COLLISION.rock.label
    }));
    placedRocks++;
  }
  rocks.count = placedRocks;
  markStaticShadowCaster(rocks, staticPropShadows);
  group.add(rocks);
  swapToInstancedModels(group, [rocks], modelUrls(FOLIAGE_BASE, ROCK_MODELS), rockMatrices, FOLIAGE_SIZES.rock.heightM, isLive, staticPropShadows);

  // grass tufts: tier-gated instanced billboards over the open ground
  const grass = buildGrassTufts(planGrassTufts(region, opts.grassDensity ?? 0), heightAt, colors);
  if (grass) group.add(grass);

  // town: stone circle + simple huts + shrine crystal
  const town = buildTown(region, heightAt, isLive, staticPropShadows, obstacles);
  group.add(town);

  const dungeonPortals = buildDungeonPortals(region, heightAt, staticPropShadows);
  group.add(dungeonPortals);
  pushRegionContactObstacles(region, obstacles);

  return {
    group,
    heightAt,
    obstacles,
    setStaticPropShadows: (enabled: boolean) => {
      group.traverse((obj) => {
        if (!obj.userData.staticPropCaster) return;
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = enabled;
      });
    },
    update: (time: number) => { waterMat.uniforms.uTime.value = time; }
  };
}

function buildTown(
  region: RegionDef,
  heightAt: (x: number, y: number) => number,
  isLive: SceneLiveCheck,
  staticPropShadows: boolean,
  obstacles?: CollisionObstacleInput[]
): THREE.Group {
  const g = new THREE.Group();
  const t = region.town.pos;
  const baseY = heightAt(t.x, t.y);
  const wx = t.x / WORLD_SCALE;
  const wz = t.y / WORLD_SCALE;
  const townRadius = region.town.radius / WORLD_SCALE;

  // plaza
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(townRadius * 0.36, townRadius * 0.39, 0.3, 24),
    new THREE.MeshStandardMaterial({ color: 0xb8a888, flatShading: true, roughness: 0.85, metalness: 0.04 })
  );
  plaza.position.set(wx, baseY + 0.12, wz);
  g.add(plaza);

  // Central landmark monument: the region's tallest read, anchored to the plaza centre.
  const monument = buildTownMonument();
  monument.position.set(wx, baseY, wz);
  monument.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { markStaticShadowCaster(m, staticPropShadows); m.receiveShadow = true; }
  });
  g.add(monument);
  pushWorldContactObstacle(obstacles, {
    id: 'town-landmark',
    pos: { ...t },
    source: 'terrain:town',
    spec: TOWN_LANDMARK_COLLISION
  });

  // huts around the plaza (procedural fallback; swapped for authored buildings below)
  const hutMat = new THREE.MeshStandardMaterial({ color: 0x9a7a52, flatShading: true, roughness: 0.88, metalness: 0.03 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xb84a32, flatShading: true, roughness: 0.7, metalness: 0.05 });
  const hutMeshes: THREE.Object3D[] = [];
  const townPlacements: { x: number; z: number; baseY: number; rotY: number }[] = [];
  // Ring radius is clamped so neighbouring buildings always leave a walkable lane
  // (see townBuildingRingRadius); a respawned party must never be sealed in town.
  const townBuildings = planTownBuildings(region);
  townBuildings.forEach((b, i) => {
    const ang = b.angle;
    const hx = b.pos.x / WORLD_SCALE;
    const hz = b.pos.y / WORLD_SCALE;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.4), hutMat);
    const hutBaseY = heightAt(b.pos.x, b.pos.y);
    hut.position.set(hx, hutBaseY + 1.0, hz);
    hut.rotation.y = ang;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.4, 4), roofMat);
    roof.position.set(hx, hutBaseY + 2.6, hz);
    roof.rotation.y = ang + Math.PI / 4;
    g.add(hut, roof);
    hutMeshes.push(hut, roof);
    obstacles?.push(staticCircleObstacle({
      pos: { ...b.pos },
      radius: b.radius,
      id: `town-building:${i}`,
      source: 'terrain:town',
      layer: TOWN_BUILDING_COLLISION.layer,
      blocksProjectiles: TOWN_BUILDING_COLLISION.blocksProjectiles,
      blocksVision: true,
      feedbackLabel: TOWN_BUILDING_COLLISION.label
    }));
    // Buildings face the plaza centre.
    townPlacements.push({ x: hx, z: hz, baseY: hutBaseY, rotY: ang + Math.PI });
  });
  for (const mesh of hutMeshes) {
    const m = mesh as THREE.Mesh;
    if (m.isMesh) {
      markStaticShadowCaster(m, staticPropShadows);
      m.receiveShadow = true;
    }
  }
  swapTownBuildings(g, hutMeshes, townPlacements, isLive, staticPropShadows);

  // shrine: floating crystal on a plinth
  const sx = region.shrine.pos.x / WORLD_SCALE;
  const sz = region.shrine.pos.y / WORLD_SCALE;
  const shrineBaseY = heightAt(region.shrine.pos.x, region.shrine.pos.y);
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.3, 0.9, 6),
    new THREE.MeshStandardMaterial({ color: 0x8d8d99, flatShading: true, roughness: 0.6, metalness: 0.15 })
  );
  plinth.position.set(sx, shrineBaseY + 0.6, sz);
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.8),
    new THREE.MeshStandardMaterial({ color: 0x7adfc4, emissive: 0x49f0c0, emissiveIntensity: 1.7, roughness: 0.15, metalness: 0.1 })
  );
  crystal.position.set(sx, shrineBaseY + 2.4, sz);
  crystal.name = 'shrine-crystal';
  markStaticShadowCaster(plinth, staticPropShadows);
  plinth.receiveShadow = true;
  markStaticShadowCaster(crystal, staticPropShadows);
  g.add(plinth, crystal);

  // Standing-stone ring around the shrine (VFX_ASSETS WS-G set dressing): one
  // InstancedMesh of weathered monoliths, deterministic + carved-world flavour.
  const STONES = 7;
  const stoneGeo = new THREE.DodecahedronGeometry(0.9, 0);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f6c75, flatShading: true, roughness: 0.82, metalness: 0.06 });
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, STONES);
  const stoneRng = new Rng(region.seed + 4242);
  const sm = new THREE.Matrix4();
  const stoneRingRadius = Math.max(1.25, Math.min(1.65, townRadius * 0.18));
  for (let i = 0; i < STONES; i++) {
    const ang = (i / STONES) * Math.PI * 2;
    const px = sx + Math.cos(ang) * stoneRingRadius;
    const pz = sz + Math.sin(ang) * stoneRingRadius;
    const h = 2.0 + stoneRng.next() * 1.4;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((stoneRng.next() - 0.5) * 0.18, ang, (stoneRng.next() - 0.5) * 0.18));
    sm.compose(new THREE.Vector3(px, shrineBaseY + h * 0.5, pz), q, new THREE.Vector3(0.52, h, 0.42));
    stones.setMatrixAt(i, sm);
  }
  markStaticShadowCaster(stones, staticPropShadows);
  stones.receiveShadow = true;
  g.add(stones);

  // shop stall: counter + awning
  const shopAngle = 0.4 + Math.PI / 6;
  const shopRadius = townRadius * 0.35;
  const shopX = wx + Math.cos(shopAngle) * shopRadius;
  const shopZ = wz + Math.sin(shopAngle) * shopRadius;
  const shopBaseY = heightAt(t.x + Math.cos(shopAngle) * (shopRadius * WORLD_SCALE), t.y + Math.sin(shopAngle) * (shopRadius * WORLD_SCALE));
  const shopRot = shopAngle + Math.PI;
  const shopPoint = (lx: number, ly: number, lz: number): THREE.Vector3 => {
    const c = Math.cos(shopRot);
    const s = Math.sin(shopRot);
    return new THREE.Vector3(shopX + lx * c - lz * s, shopBaseY + ly, shopZ + lx * s + lz * c);
  };
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x7a5a36, flatShading: true, roughness: 0.9, metalness: 0.03 }));
  counter.position.copy(shopPoint(0, 0.7, 0));
  counter.rotation.y = shopRot;
  const awning = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 2.0), new THREE.MeshStandardMaterial({ color: 0xd8b04a, flatShading: true, roughness: 0.65, metalness: 0.1 }));
  awning.position.copy(shopPoint(0, 2.3, 0));
  awning.rotation.y = counter.rotation.y;
  const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 5), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.8, metalness: 0.05 }));
  pole1.position.copy(shopPoint(-1.5, 1.4, 0.8));
  const pole2 = pole1.clone();
  pole2.position.copy(shopPoint(1.5, 1.4, 0.8));
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.1), new THREE.MeshStandardMaterial({ color: 0xe8c87c, emissive: 0x6a5a2c, emissiveIntensity: 0.7, roughness: 0.5, metalness: 0.1 }));
  sign.position.copy(shopPoint(0, 3.0, -0.65));
  sign.rotation.y = counter.rotation.y;
  sign.name = 'shop-sign';
  for (const merged of batchStaticProps([counter, awning, pole1, pole2, sign].map((obj) => ({ obj, shadow: true })), staticPropShadows)) {
    g.add(merged);
  }
  pushWorldContactObstacle(obstacles, {
    id: 'town-market-stall',
    pos: { x: shopX * WORLD_SCALE, y: shopZ * WORLD_SCALE },
    source: 'terrain:town',
    spec: DRESSING_PROP_COLLISION.market
  });

  // Set dressing + ambient presence (ASSET_GAPS P2).
  g.add(buildTownDressing(region, heightAt, isLive, staticPropShadows, obstacles));

  return g;
}

function buildDungeonPortals(region: RegionDef, heightAt: (x: number, y: number) => number, staticPropShadows = true): THREE.Group {
  const g = new THREE.Group();
  const portalMat = new THREE.MeshStandardMaterial({
    color: 0x6f4cff,
    emissive: 0x6f4cff,
    emissiveIntensity: 1.1,
    roughness: 0.35,
    metalness: 0.15
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xb28cff,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x2b2442, roughness: 0.7, metalness: 0.08 });

  for (const portal of region.dungeons ?? []) {
    const x = portal.pos.x / WORLD_SCALE;
    const z = portal.pos.y / WORLD_SCALE;
    const baseY = heightAt(portal.pos.x, portal.pos.y);
    const p = new THREE.Group();
    p.name = `dungeon-portal-${portal.dungeonId}`;
    p.position.set(x, baseY, z);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.95, 0.2, 24), padMat);
    pad.position.y = 0.1;
    pad.receiveShadow = true;

    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.12, 10, 36), portalMat);
    ring.position.y = 1.55;
    markStaticShadowCaster(ring, staticPropShadows);

    const core = new THREE.Mesh(new THREE.CircleGeometry(1.08, 32), coreMat);
    core.position.y = 1.55;
    core.position.z = 0.02;

    const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.2, 6), portalMat);
    beacon.position.y = 2.85;
    markStaticShadowCaster(beacon, staticPropShadows);

    p.add(pad, ring, core, beacon);
    g.add(p);
  }

  return g;
}
