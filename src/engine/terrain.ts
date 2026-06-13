import * as THREE from 'three';
import { Rng, hashString } from '../core/rng';
import type { RegionDef } from '../core/types';
import { WORLD_SCALE } from './scale';

// ------------------------------------------------------------------
// Procedural low-poly terrain: vertex-jittered plane, painted height
// bands, scattered trees/rocks as instanced meshes (SPEC §3).
// Heights are gentle: gameplay treats the world as 2D with visual relief.
// ------------------------------------------------------------------

export interface TerrainInfo {
  group: THREE.Group;
  heightAt(simX: number, simY: number): number; // world-units height
  obstacles: { pos: { x: number; y: number }; radius: number }[];
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

const BIOME_COLORS: Record<string, { low: number; mid: number; high: number; tree: number; trunk: number; rock: number }> = {
  grass: { low: 0x4a7c3a, mid: 0x5c9447, high: 0x7daf5e, tree: 0x3e7a34, trunk: 0x6b4a2c, rock: 0x8d8d99 },
  snow: { low: 0xc8d8e8, mid: 0xe8f0f8, high: 0xffffff, tree: 0x4a6b5c, trunk: 0x52404a, rock: 0x9aa6b8 },
  desert: { low: 0xc8a05c, mid: 0xd8b06c, high: 0xe8c87c, tree: 0x7a8a3a, trunk: 0x8a6a3a, rock: 0xa08a6a },
  wasteland: { low: 0x5a4a4a, mid: 0x6b5a52, high: 0x7c6a5e, tree: 0x4a3a3a, trunk: 0x3a2a2a, rock: 0x6a5a5a },
  coast: { low: 0x5c9447, mid: 0x7daf5e, high: 0xc8b87c, tree: 0x3e7a34, trunk: 0x6b4a2c, rock: 0x8d8d99 },
  forest: { low: 0x2e5c28, mid: 0x3e7a34, high: 0x5c9447, tree: 0x2a5224, trunk: 0x52402c, rock: 0x7d7d89 }
};

export function buildTerrain(region: RegionDef): TerrainInfo {
  const group = new THREE.Group();
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
  const colorArr: number[] = [];
  const cLow = new THREE.Color(colors.low);
  const cMid = new THREE.Color(colors.mid);
  const cHigh = new THREE.Color(colors.high);
  const jitter = new Rng(region.seed + 77);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + sizeW / 2;
    const z = pos.getZ(i) + sizeW / 2;
    const u = x / sizeW;
    const v = z / sizeW;
    let h = heightAtUV(u, v);
    // low-poly jitter
    h += (jitter.next() - 0.5) * 0.35;
    pos.setY(i, h);
    const t = Math.min(1, h / 4.2);
    const c = t < 0.45 ? cLow.clone().lerp(cMid, t / 0.45) : cMid.clone().lerp(cHigh, (t - 0.45) / 0.55);
    // subtle patchiness
    const shade = 0.92 + jitter.next() * 0.16;
    colorArr.push(c.r * shade, c.g * shade, c.b * shade);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colorArr, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const ground = new THREE.Mesh(geo, mat);
  ground.position.set(sizeW / 2, 0, sizeW / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // water ring outside the playfield for vibes
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(sizeW * 3, sizeW * 3),
    new THREE.MeshLambertMaterial({ color: 0x2c5a78 })
  );
  water.rotateX(-Math.PI / 2);
  water.position.set(sizeW / 2, -1.2, sizeW / 2);
  group.add(water);

  const heightAt = (simX: number, simY: number): number => {
    const u = simX / region.size;
    const v = simY / region.size;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    return heightAtUV(u, v);
  };

  // scatter props (deterministic), keeping clearings around town/shrine/camps/spawns
  const obstacles: { pos: { x: number; y: number }; radius: number }[] = [];
  const clearings: { x: number; y: number; r: number }[] = [
    { x: region.town.pos.x, y: region.town.pos.y, r: region.town.radius + 250 },
    ...region.camps.map((c) => ({ x: c.pos.x, y: c.pos.y, r: c.radius + 320 })),
    ...region.heroSpawns.map((h) => ({ x: h.pos.x, y: h.pos.y, r: 420 }))
  ];
  const isClear = (x: number, y: number) => clearings.every((c) => Math.hypot(x - c.x, y - c.y) > c.r);

  const propRng = new Rng(region.seed + 1234);
  const treeCount = Math.floor(220 * region.props.treeDensity);
  const rockCount = Math.floor(90 * region.props.rockDensity);

  // trees: instanced cone + trunk
  const treeGeo = new THREE.ConeGeometry(0.95, 2.6, 6);
  const treeMat = new THREE.MeshLambertMaterial({ color: colors.tree, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.0, 5);
  const trunkMat = new THREE.MeshLambertMaterial({ color: colors.trunk, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const m4 = new THREE.Matrix4();
  let placedTrees = 0;
  for (let i = 0; i < treeCount * 4 && placedTrees < treeCount; i++) {
    const x = propRng.range(400, region.size - 400);
    const y = propRng.range(400, region.size - 400);
    if (!isClear(x, y)) continue;
    const s = propRng.range(0.8, 1.7);
    const h = heightAt(x, y);
    const wx = x / WORLD_SCALE;
    const wz = y / WORLD_SCALE;
    m4.compose(
      new THREE.Vector3(wx, h + 1.3 * s + 0.7, wz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), propRng.range(0, Math.PI * 2)),
      new THREE.Vector3(s, s, s)
    );
    trees.setMatrixAt(placedTrees, m4);
    m4.compose(new THREE.Vector3(wx, h + 0.5, wz), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(placedTrees, m4);
    obstacles.push({ pos: { x, y }, radius: 55 * s });
    placedTrees++;
  }
  trees.count = placedTrees;
  trunks.count = placedTrees;
  trees.castShadow = true;
  group.add(trees);
  group.add(trunks);

  // rocks
  const rockGeo = new THREE.DodecahedronGeometry(0.8, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: colors.rock, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  let placedRocks = 0;
  for (let i = 0; i < rockCount * 4 && placedRocks < rockCount; i++) {
    const x = propRng.range(400, region.size - 400);
    const y = propRng.range(400, region.size - 400);
    if (!isClear(x, y)) continue;
    const s = propRng.range(0.6, 2.2);
    m4.compose(
      new THREE.Vector3(x / WORLD_SCALE, heightAt(x, y) + 0.3 * s, y / WORLD_SCALE),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(propRng.range(0, 1), propRng.range(0, Math.PI * 2), propRng.range(0, 1))),
      new THREE.Vector3(s, s * 0.8, s)
    );
    rocks.setMatrixAt(placedRocks, m4);
    obstacles.push({ pos: { x, y }, radius: 60 * s });
    placedRocks++;
  }
  rocks.count = placedRocks;
  rocks.castShadow = true;
  group.add(rocks);

  // town: stone circle + simple huts + shrine crystal
  const town = buildTown(region, heightAt);
  group.add(town);

  return { group, heightAt, obstacles };
}

function buildTown(region: RegionDef, heightAt: (x: number, y: number) => number): THREE.Group {
  const g = new THREE.Group();
  const t = region.town.pos;
  const baseY = heightAt(t.x, t.y);
  const wx = t.x / WORLD_SCALE;
  const wz = t.y / WORLD_SCALE;

  // plaza
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(region.town.radius / WORLD_SCALE * 0.55, region.town.radius / WORLD_SCALE * 0.58, 0.3, 24),
    new THREE.MeshLambertMaterial({ color: 0xb8a888, flatShading: true })
  );
  plaza.position.set(wx, baseY + 0.12, wz);
  g.add(plaza);

  // huts around the plaza
  const hutMat = new THREE.MeshLambertMaterial({ color: 0x9a7a52, flatShading: true });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xb84a32, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.4;
    const r = region.town.radius / WORLD_SCALE * 0.42;
    const hx = wx + Math.cos(ang) * r;
    const hz = wz + Math.sin(ang) * r;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.4), hutMat);
    hut.position.set(hx, baseY + 1.0, hz);
    hut.rotation.y = ang;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.4, 4), roofMat);
    roof.position.set(hx, baseY + 2.6, hz);
    roof.rotation.y = ang + Math.PI / 4;
    g.add(hut, roof);
  }

  // shrine: floating crystal on a plinth
  const sx = region.shrine.pos.x / WORLD_SCALE;
  const sz = region.shrine.pos.y / WORLD_SCALE;
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.3, 0.9, 6),
    new THREE.MeshLambertMaterial({ color: 0x8d8d99, flatShading: true })
  );
  plinth.position.set(sx, baseY + 0.6, sz);
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.8),
    new THREE.MeshLambertMaterial({ color: 0x7adfc4, emissive: 0x2c8a6a })
  );
  crystal.position.set(sx, baseY + 2.4, sz);
  crystal.name = 'shrine-crystal';
  g.add(plinth, crystal);

  // shop stall: counter + awning
  const shopX = wx + 3.5;
  const shopZ = wz + 1.5;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.1, 1.2), new THREE.MeshLambertMaterial({ color: 0x7a5a36, flatShading: true }));
  counter.position.set(shopX, baseY + 0.7, shopZ);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 2.0), new THREE.MeshLambertMaterial({ color: 0xd8b04a, flatShading: true }));
  awning.position.set(shopX, baseY + 2.3, shopZ);
  const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 5), new THREE.MeshLambertMaterial({ color: 0x5a4a32 }));
  pole1.position.set(shopX - 1.5, baseY + 1.4, shopZ + 0.8);
  const pole2 = pole1.clone();
  pole2.position.x = shopX + 1.5;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.1), new THREE.MeshLambertMaterial({ color: 0xe8c87c, emissive: 0x6a5a2c }));
  sign.position.set(shopX, baseY + 3.0, shopZ);
  sign.name = 'shop-sign';
  g.add(counter, awning, pole1, pole2, sign);

  return g;
}
