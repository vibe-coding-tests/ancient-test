// Asset build pipeline (GRAPHICS_SPEC §13.5 Phase 0).
//
// Turns raw, downloaded Creative Commons packs — CC0/CC-BY and, since this is a
// non-commercial project, NC/SA too (DECISIONS 2026-06-14) — (kept out of git under tmp/asset_src/)
// into small, shipping files under public/assets/. Only the optimized output is
// committed; the raw packs never are. This mirrors the proven gltf-transform +
// meshopt + sharp flow and keeps the repo light enough to boot instantly.
//
// Usage:
//   npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//   node scripts/assets/build_assets.mjs scripts/assets/specs/<pack>.json [...more]
//
// Spec format (one JSON file per pack, kept beside this script under specs/):
//   { "items": [ {
//     "src":  "tmp/asset_src/Quaternius/Nature/Oak_1.glb", // .glb / .gltf (+ .bin/png)
//     "out":  "models/props/oak_1.glb",                    // relative to public/assets/
//     "type": "model" | "copy",                            // "copy" = byte-for-byte (HDRI/JPG)
//     "keepClips":   ["Idle", "Walk", "Attack"],           // optional: drop other animations
//     "renameClips": { "Armature|Idle": "Idle" },          // optional: applied after '|' strip
//     "maxTex": 512                                        // optional: clamp embedded texture px
//   } ] }
//
// Notes:
// - Clip names like "AnimalArmature|Idle" are stripped to the segment after the
//   last '|', then deduped. keepClips/renameClips run against the stripped name.
// - "model" runs resample + prune + dedup + optional texture webp resize +
//   meshopt(high). It never joins/flattens/simplifies (that corrupts low-poly
//   rigs and hard edges).
// - "copy" is a straight file copy for HDRIs and standalone PBR/normal JPGs that
//   are loaded directly (terrain splats, sky maps, water normals).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PUBLIC_ASSETS = path.join(ROOT, 'public', 'assets');
const MANIFEST_PATH = path.join(PUBLIC_ASSETS, 'manifest.json');
// OVERWORLD_PLANNING §5.6: path -> declared WorldSize the build fits to. Generated
// from the TS resolver (src/test/asset-world-sizes.test.ts) so a .mjs build with no
// TS runtime still knows each entity's lifelike height. Refresh via that test.
const WORLD_SIZES_PATH = path.join(HERE, 'world-sizes.generated.json');
function loadWorldSizes() {
  try {
    return JSON.parse(fs.readFileSync(WORLD_SIZES_PATH, 'utf8')).sizes ?? {};
  } catch {
    return {};
  }
}
const WORLD_SIZES = loadWorldSizes();
// No-budget policy (DECISIONS 2026-06-13): download/repo size is explicitly NOT a
// constraint. We ship a per-hero retextured GLB for every cohort member (80+ heroes)
// and any HDRIs/props/music the theme wants. These caps are kept only as a sanity
// ceiling against a runaway/corrupt build, set far above the real footprint — not as
// a size gate. Per-file caps still guard against a single pathological asset.
const GB = 1024 * 1024 * 1024;
const DEFAULT_BUDGETS = {
  maxTotalBytes: 4 * GB,
  maxGroupBytes: {
    creep: 1 * GB,
    terrain: 1 * GB,
    town: 1 * GB,
    hero: 2 * GB,
    holdout: 128 * 1024 * 1024,
    weapon: 512 * 1024 * 1024,
    env: 1 * GB,
    audio: 512 * 1024 * 1024,
    ui: 256 * 1024 * 1024
  },
  maxFileBytesByGroup: {
    creep: 64 * 1024 * 1024,
    terrain: 64 * 1024 * 1024,
    town: 64 * 1024 * 1024,
    hero: 64 * 1024 * 1024,
    holdout: 16 * 1024 * 1024,
    weapon: 16 * 1024 * 1024,
    env: 128 * 1024 * 1024,
    audio: 32 * 1024 * 1024,
    ui: 32 * 1024 * 1024
  }
};

function resolveSrc(src) {
  return path.isAbsolute(src) ? src : path.join(ROOT, src);
}

function relAssetPath(filePath) {
  return path.relative(PUBLIC_ASSETS, filePath).split(path.sep).join('/');
}

function assetUrl(rel) {
  return `/assets/${rel}`;
}

function assetGroup(rel) {
  if (rel.startsWith('creeps/')) return 'creep';
  if (rel.startsWith('heroes/')) return 'hero';
  if (rel.startsWith('holdouts/')) return 'holdout';
  if (rel.startsWith('weapons/')) return 'weapon';
  if (rel.startsWith('env/')) return 'env';
  if (rel.startsWith('audio/')) return 'audio';
  if (rel.startsWith('ui/')) return 'ui';
  if (rel.startsWith('vfx/')) return 'vfx';
  if (rel.startsWith('props/town/')) return 'town';
  if (rel.startsWith('props/') || rel.startsWith('textures/terrain/')) return 'terrain';
  if (rel.startsWith('textures/')) return 'terrain';
  return 'ui';
}

function assetType(rel) {
  const ext = path.extname(rel).slice(1).toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (ext === 'hdr') return 'hdr';
  if (['jpg', 'jpeg', 'png', 'webp', 'ktx2'].includes(ext)) return 'texture';
  if (['woff', 'woff2'].includes(ext)) return 'font';
  if (['wav', 'ogg', 'mp3', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (['json'].includes(ext)) return 'data';
  return ext || 'file';
}

function inferredSource(rel) {
  if (rel.startsWith('heroes/')) {
    if (['heroes/gyrocopter.glb', 'heroes/hoodwink.glb', 'heroes/snapfire.glb', 'heroes/tusk.glb'].includes(rel)) {
      return 'generated in-repo: generate_creature_families.mjs';
    }
    return 'KayKit Adventurers base, tri-tone palette retexture by us — CC0';
  }
  if (rel === 'creeps/serpent.glb') return 'Quaternius snake via Poly Pizza — CC0';
  if (['creeps/flier.glb', 'creeps/bear.glb', 'creeps/treant.glb', 'creeps/scorpion.glb', 'creeps/centaur.glb', 'creeps/gnoll.glb', 'creeps/owlbear.glb', 'creeps/energy.glb', 'creeps/abomination.glb', 'creeps/fishman.glb'].includes(rel)) return 'generated in-repo: generate_creature_families.mjs';
  if (rel.startsWith('creeps/')) return 'Quaternius creature pack — CC0';
  if (rel.startsWith('holdouts/')) return 'generated in-repo: generate_holdout_signatures.mjs';
  if (rel.startsWith('weapons/heroes/')) return 'generated in-repo: generate_hero_weapons.mjs';
  if (rel.startsWith('weapons/items/')) return 'generated in-repo: generate_item_weapons.mjs';
  if (rel.startsWith('ui/items/')) return 'game-icons.net curated item silhouettes — CC BY 3.0';
  if (rel.startsWith('ui/frames/')) return 'generated in-repo: generate_ui_assets.mjs';
  if (rel.startsWith('ui/fonts/')) return 'Cinzel font — OFL 1.1';
  if (rel.startsWith('vfx/')) return 'generated in-repo: vfx asset generators';
  if (rel.startsWith('audio/sfx/kenney/')) return 'Kenney audio packs — CC0';
  if (rel.startsWith('audio/')) return 'generated in-repo: generate_audio.mjs';
  if (rel.startsWith('textures/water/')) return 'generated in-repo: generate_water_normal.mjs';
  if (rel.startsWith('textures/terrain/')) return 'ambientCG terrain textures — CC0';
  if (rel.startsWith('env/')) return 'Poly Haven sky and environment maps — CC0';
  if (rel.startsWith('props/')) return 'Quaternius/KayKit prop assets — CC0';
  return null;
}

function manifestSource(rel, meta) {
  const explicit = meta.source ?? meta.src ?? null;
  if (explicit && !String(explicit).startsWith('tmp/asset_src/')) return explicit;
  return inferredSource(rel) ?? explicit;
}

function isBodyModel(rel) {
  return rel.endsWith('.glb') && (
    rel.startsWith('heroes/') ||
    rel.startsWith('creeps/') ||
    rel.startsWith('holdouts/replacements/')
  );
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024).toFixed(0)}KB`;
}

function hasClip(names, patterns) {
  return names.some((name) => {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return patterns.some((pattern) => pattern.test(normalized));
  });
}

function walkAssets(dir = PUBLIC_ASSETS, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkAssets(p, out);
      continue;
    }
    const rel = relAssetPath(p);
    if (rel === 'manifest.json' || path.basename(rel).startsWith('.')) continue;
    out.push(rel);
  }
  return out.sort();
}

function sourceKey(specFile) {
  return path.relative(ROOT, path.resolve(specFile)).split(path.sep).join('/');
}

function complexityForRoot(root) {
  const textures = root.listTextures().map((tex) => {
    let size = null;
    try {
      const s = typeof tex.getSize === 'function' ? tex.getSize() : null;
      if (Array.isArray(s)) size = { width: s[0], height: s[1] };
    } catch {
      size = null;
    }
    return { name: tex.getName() || '', ...size };
  });
  return {
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    materialNames: root.listMaterials().map((m) => m.getName() || '(unnamed)'),
    textures: textures.length,
    textureDimensions: textures.filter((t) => t.width && t.height),
    animations: root.listAnimations().length
  };
}

function stripClipName(name) {
  const i = name.lastIndexOf('|');
  return i >= 0 ? name.slice(i + 1) : name;
}

function gltfAnimationNames(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  let json;
  if (ext === '.gltf') {
    json = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } else {
    const buf = fs.readFileSync(absPath);
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) {
      throw new Error('not a GLB file');
    }
    const jsonLength = buf.readUInt32LE(12);
    const chunkType = buf.readUInt32LE(16);
    if (chunkType !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
    json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8').trim());
  }
  return (json.animations ?? []).map((anim, i) => String(anim.name || `animation-${i}`));
}

// OVERWORLD_PLANNING §5.4: measure the model's authored bounding box from its
// POSITION accessors so the manifest can carry a real dimension to lint against
// the declared WorldSize. Node transforms are not composed (these props ship as
// single-root meshes), so this is the authored local-space AABB — good enough to
// catch a model that fits to height but has a wildly wrong footprint.
function authoredDims(root) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let seen = false;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const lo = pos.getMin([]);
      const hi = pos.getMax([]);
      if (!Array.isArray(lo) || !Array.isArray(hi)) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], lo[i]);
        max[i] = Math.max(max[i], hi[i]);
      }
      seen = true;
    }
  }
  if (!seen) return null;
  const r3 = (v) => +v.toFixed(4);
  return { w: r3(max[0] - min[0]), h: r3(max[1] - min[1]), d: r3(max[2] - min[2]) };
}

// sRGB hex -> linear RGB triplet (glTF baseColorFactor is linear).
function hexToLinear(hex) {
  const h = hex.replace('#', '');
  const to = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [to(parseInt(h.slice(0, 2), 16)), to(parseInt(h.slice(2, 4), 16)), to(parseInt(h.slice(4, 6), 16))];
}

function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Retexture a base mesh to a hero's three-color palette (GRAPHICS_SPEC §13 Phase 5):
 * primary reads as cloth/skin, secondary as worked metal/armour, accent as trim/gem.
 * Each material is mapped to a role by an explicit `materialMap` keyword match on its
 * name, else bucketed by the luminance of its current base color. The factor tints any
 * base-color texture, so atlas detail/AO survives while the hue swings to the palette.
 */
function recolorToPalette(root, palette, materialMap) {
  const [primary, secondary, accent] = palette.map(hexToLinear);
  const roleColor = { primary, secondary, accent };
  const keywords = Object.entries(materialMap ?? {});
  for (const mat of root.listMaterials()) {
    const name = (mat.getName() || '').toLowerCase();
    let role = null;
    for (const [kw, r] of keywords) {
      if (name.includes(kw.toLowerCase())) { role = r; break; }
    }
    if (!role) {
      const cur = mat.getBaseColorFactor();
      const l = luminance([cur[0], cur[1], cur[2]]);
      role = l < 0.18 ? 'secondary' : l > 0.62 ? 'accent' : 'primary';
    }
    const [r, g, b] = roleColor[role] ?? primary;
    const alpha = mat.getBaseColorFactor()[3] ?? 1;
    mat.setBaseColorFactor([r, g, b, alpha]);
  }
}

function hexToRgb255(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lerp255(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

/**
 * Generated multi-zone retexture (VFX_ASSETS A4): gradient-map a base atlas through
 * a hero's three-color palette in TEXTURE space, instead of multiplying the whole
 * atlas by one flat baseColorFactor (which reads mono-tone — the "single-atlas
 * recolor reads flat" risk). The source atlas's own per-pixel luminance drives a
 * FIVE-stop ramp — deepened shadow → secondary → primary body → accent →
 * hot specular — so KayKit's baked shading/AO and its distinct zones (armour vs
 * cloth vs skin/trim) survive as separate, richly shaded palette tones rather than
 * a single midtone wash. On top of that, source chroma is read per pixel: bright,
 * saturated source zones (trim, gems, metal highlights) bias toward the accent so
 * they pop as their own painted-looking zone instead of collapsing into the body.
 * The base-color texture is rewritten and the material factor is neutralized to
 * white so nothing double-tints at runtime. Fully deterministic and generated end
 * to end. `mid` biases where the dominant body tone sits in the luminance range.
 */
async function retextureAtlas(doc, sharp, palette, mid = 0.5) {
  const [primary, secondary, accent] = palette.map(hexToRgb255);
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  // Five identity-derived tones: a deepened shadow under the secondary, the primary
  // body, a brightened body that leans into the accent, and a hot specular tip.
  const deep = lerp255(secondary, black, 0.45);
  const light = lerp255(primary, accent, 0.5);
  const spec = lerp255(accent, white, 0.4);
  const stops = [deep, secondary, primary, light, spec];
  // Position the body tone by `mid`, then space the remaining stops around it so the
  // dominant identity color owns the most luminance while shadows/highlights frame it.
  const body = Math.min(Math.max(mid, 0.15), 0.85);
  const stopPos = [0, body * 0.5, body, body + (1 - body) * 0.5, 1];
  const sample = (t) => {
    let i = 0;
    while (i < stopPos.length - 2 && t > stopPos[i + 1]) i++;
    const span = stopPos[i + 1] - stopPos[i] || 1;
    return lerp255(stops[i], stops[i + 1], Math.min(1, Math.max(0, (t - stopPos[i]) / span)));
  };
  // 256-entry lookup keyed by source luminance (sRGB byte space) for a fast remap.
  const ramp = new Array(256);
  for (let l = 0; l < 256; l++) ramp[l] = sample(l / 255);

  let touched = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getBaseColorTexture();
    if (!tex || !tex.getImage()) continue;
    const { data, info } = await sharp(Buffer.from(tex.getImage()))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0; // source chroma → a distinct material zone
      const base = ramp[lum];
      // Bright, saturated source zones (trim/gems/metal) lean toward the accent so
      // they read as their own zone; flat/dark cloth stays on the body ramp.
      const pop = sat * (lum / 255) * 0.5;
      const [or, og, ob] = lerp255(base, accent, pop);
      data[i] = or;
      data[i + 1] = og;
      data[i + 2] = ob;
      // data[i + 3] (alpha) is preserved so cutout/transparent regions stay intact.
    }
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    tex.setImage(png);
    tex.setMimeType('image/png');
    const alpha = mat.getBaseColorFactor()[3] ?? 1;
    mat.setBaseColorFactor([1, 1, 1, alpha]);
    touched++;
  }
  if (!touched) console.warn('  WARN retexture: no base-color textures found to remap');
}

async function processModel(io, fns, item) {
  const { dedup, meshopt, prune, resample, textureCompress } = fns.functions;
  const { MeshoptEncoder } = fns.meshopt;
  const sharp = fns.sharp;

  const srcPath = resolveSrc(item.src);
  const outPath = path.join(PUBLIC_ASSETS, item.out);
  const doc = await io.read(srcPath);
  const root = doc.getRoot();

  // Normalize + filter animation clips so we ship only what the animator drives.
  const seen = new Set();
  for (const anim of root.listAnimations()) {
    let name = stripClipName(anim.getName());
    if (item.renameClips && item.renameClips[name]) name = item.renameClips[name];
    const drop = (item.keepClips && !item.keepClips.includes(name)) || seen.has(name);
    if (drop) {
      anim.dispose();
      continue;
    }
    seen.add(name);
    anim.setName(name);
  }
  if (item.keepClips) {
    const missing = item.keepClips.filter((c) => !seen.has(c));
    if (missing.length) console.warn(`  WARN ${item.out}: missing clips ${missing.join(', ')}`);
  }

  if (process.env.ASSET_DEBUG_MATERIALS) {
    console.log(`  [materials] ${item.out}: ${root.listMaterials().map((m) => m.getName() || '(unnamed)').join(', ') || '(none)'}`);
  }

  // Retexture to a hero palette before compression (Phase 5). Runs on the raw
  // materials so the keyword/luminance mapping sees their original names + colors.
  // 'tritone' (A4 bespoke) gradient-maps the atlas in texture space for a multi-tone
  // read; the default factor tint stays the fast cohort path.
  if (item.recolor) {
    if (item.recolorMode === 'tritone') {
      await retextureAtlas(doc, sharp, item.recolor, item.recolorMid);
    } else {
      recolorToPalette(root, item.recolor, item.materialMap);
    }
  }

  const transforms = [resample(), prune(), dedup()];
  if (item.maxTex) {
    transforms.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [item.maxTex, item.maxTex] }));
  }
  transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...transforms);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const bytes = fs.statSync(outPath).size;
  const complexity = complexityForRoot(root);
  const dims = authoredDims(root);
  console.log(
    `  ${item.out}  ${formatBytes(bytes)}` +
    ` (${complexity.meshes} meshes, ${complexity.materials} materials` +
    `${complexity.animations ? `, ${complexity.animations} clips` : ''})`
  );
  return { rel: item.out, bytes, type: 'model', complexity, dims };
}

function processCopy(item) {
  const srcPath = resolveSrc(item.src);
  const outPath = path.join(PUBLIC_ASSETS, item.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(srcPath, outPath);
  const bytes = fs.statSync(outPath).size;
  console.log(`  ${item.out}  ${formatBytes(bytes)} (copy)`);
  return { rel: item.out, bytes, type: assetType(item.out), complexity: null };
}

async function measureExistingDims(io, rel) {
  try {
    const doc = await io.read(path.join(PUBLIC_ASSETS, rel));
    return authoredDims(doc.getRoot());
  } catch (err) {
    console.warn(`  WARN ${rel}: could not measure dims (${err instanceof Error ? err.message : err})`);
    return null;
  }
}

async function buildManifest(sourceByOut, io = null) {
  const previousByPath = new Map();
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const previous = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      for (const file of previous.files ?? []) previousByPath.set(file.path, file);
    } catch {
      previousByPath.clear();
    }
  }
  const files = [];
  for (const rel of walkAssets()) {
    const abs = path.join(PUBLIC_ASSETS, rel);
    const meta = sourceByOut.get(rel) ?? previousByPath.get(rel) ?? {};
    const bytes = fs.statSync(abs).size;
    const group = meta.group ?? meta.preloadGroup ?? assetGroup(rel);
    // The declared WorldSize for this path, if any (heroes/props/critters/etc).
    const worldSize = meta.worldSize ?? WORLD_SIZES[rel] ?? null;
    const targetHeightM = meta.targetHeightM ?? worldSize?.heightM ?? null;
    let dims = meta.dims ?? null;
    if (!dims && targetHeightM && io && ['glb', 'gltf'].includes(path.extname(rel).slice(1).toLowerCase())) {
      dims = await measureExistingDims(io, rel);
    }
    const animations = isBodyModel(rel) ? (meta.animations ?? gltfAnimationNames(abs)) : null;
    // Post-fit meters: scale the authored AABB to the declared fit target so lint
    // can compare against the entity's WorldSize.heightM (§5.4 / §9.5).
    let dimsM = meta.dimsM ?? null;
    if (dims && targetHeightM && dims.h > 0) {
      const k = targetHeightM / dims.h;
      const r3 = (v) => +(v * k).toFixed(4);
      dimsM = { h: targetHeightM, w: r3(dims.w), d: r3(dims.d) };
    }
    files.push({
      path: rel,
      url: assetUrl(rel),
      bytes,
      type: meta.assetType ?? assetType(rel),
      group,
      preloadGroup: meta.preloadGroup ?? group,
      sourceSpec: meta.sourceSpec ?? null,
      source: manifestSource(rel, meta),
      ...(animations ? { animations } : {}),
      ...(worldSize ? { worldSize } : {}),
      ...(dims ? { dims } : {}),
      ...(dimsM ? { dimsM } : {})
    });
  }
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const groups = {};
  for (const file of files) {
    const g = groups[file.group] ?? { count: 0, bytes: 0 };
    g.count++;
    g.bytes += file.bytes;
    groups[file.group] = g;
  }
  const hash = createHash('sha256')
    .update(JSON.stringify(files.map((f) => [f.path, f.bytes, f.group, f.type])))
    .digest('hex')
    .slice(0, 12);
  return {
    version: 1,
    hash,
    generatedAt: new Date().toISOString(),
    assetRoot: '/assets/',
    totalBytes,
    groups,
    files
  };
}

function writeManifest(manifest) {
  fs.mkdirSync(PUBLIC_ASSETS, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: ${path.relative(ROOT, MANIFEST_PATH)} (${manifest.files.length} files, ${formatBytes(manifest.totalBytes)}, hash ${manifest.hash})`);
}

function printReport(manifest, built) {
  console.log('\nasset report');
  console.log(`  total: ${formatBytes(manifest.totalBytes)} across ${manifest.files.length} files`);
  for (const [group, stats] of Object.entries(manifest.groups).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${group}: ${stats.count} files, ${formatBytes(stats.bytes)}`);
  }
  const largest = [...manifest.files].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  if (largest.length) {
    console.log('  largest:');
    for (const f of largest) console.log(`    ${formatBytes(f.bytes).padStart(8)}  ${f.path}`);
  }
  const complex = built.filter((b) => b.complexity);
  if (complex.length) {
    console.log('  model complexity:');
    for (const b of complex) {
      const c = b.complexity;
      console.log(
        `    ${b.rel}: ${c.meshes} meshes, ${c.materials} materials, ` +
        `${c.textures} textures, ${c.animations} animations`
      );
      for (const tex of c.textureDimensions.slice(0, 6)) {
        console.log(`      tex ${tex.name || '(unnamed)'} ${tex.width}x${tex.height}`);
      }
    }
  }
}

function checkBudgets(manifest, budgets = DEFAULT_BUDGETS) {
  const failures = [];
  if (manifest.totalBytes > budgets.maxTotalBytes) {
    failures.push(`total ${formatBytes(manifest.totalBytes)} > ${formatBytes(budgets.maxTotalBytes)}`);
  }
  for (const [group, limit] of Object.entries(budgets.maxGroupBytes)) {
    const bytes = manifest.groups[group]?.bytes ?? 0;
    if (bytes > limit) failures.push(`${group} group ${formatBytes(bytes)} > ${formatBytes(limit)}`);
  }
  for (const file of manifest.files) {
    const limit = budgets.maxFileBytesByGroup[file.group];
    if (limit && file.bytes > limit) failures.push(`${file.path} ${formatBytes(file.bytes)} > ${formatBytes(limit)}`);
  }
  return failures;
}

function checkBodyAnimations(manifest) {
  const failures = [];
  for (const file of manifest.files) {
    if (!isBodyModel(file.path)) continue;
    const names = file.animations ?? [];
    const hasIdle = hasClip(names, [/idle/, /stand/]);
    const hasLocomotion = hasClip(names, [/run/, /walk/, /fly/, /move/, /crawl/, /swim/, /locomotion/]);
    if (!hasIdle || !hasLocomotion) {
      const missing = !hasIdle && !hasLocomotion ? 'idle and locomotion' : !hasIdle ? 'idle' : 'locomotion';
      failures.push(`${file.path} missing ${missing} clip (${names.join(', ') || 'no animations'})`);
    }
  }
  return failures;
}

async function loadDeps() {
  // Imported lazily so `node --check` and a deps-free checkout don't fail; the
  // script only needs them when actually building.
  try {
    const [{ NodeIO }, { ALL_EXTENSIONS }, functions, meshopt, sharpMod] = await Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/extensions'),
      import('@gltf-transform/functions'),
      import('meshoptimizer'),
      import('sharp')
    ]);
    return { NodeIO, ALL_EXTENSIONS, functions, meshopt, sharp: sharpMod.default ?? sharpMod };
  } catch (err) {
    console.error('Missing build deps. Install them with:');
    console.error('  npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp');
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const specs = args.filter((a) => !a.startsWith('--'));
  const wantsManifest = specs.length > 0 || flags.has('--manifest');
  const wantsReport = specs.length > 0 || flags.has('--report');
  const wantsBudgetCheck = flags.has('--check-budgets') || flags.has('--check-budget');

  if (!specs.length && !wantsManifest && !wantsReport && !wantsBudgetCheck) {
    console.error('usage: node scripts/assets/build_assets.mjs [--manifest] [--report] [--check-budgets] <spec.json> [...]');
    process.exit(1);
  }

  let failures = 0;
  const built = [];
  const sourceByOut = new Map();

  if (specs.length) {
    const deps = await loadDeps();
    await deps.meshopt.MeshoptEncoder.ready;
    await deps.meshopt.MeshoptDecoder.ready;
    const io = new deps.NodeIO()
      .registerExtensions(deps.ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.encoder': deps.meshopt.MeshoptEncoder, 'meshopt.decoder': deps.meshopt.MeshoptDecoder });

    for (const specFile of specs) {
      const specPath = sourceKey(specFile);
      const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
      console.log(`spec: ${specFile} (${spec.items.length} items)`);
      for (const item of spec.items) {
        sourceByOut.set(item.out, {
          sourceSpec: specPath,
          src: item.src,
          source: item.source,
          group: item.group,
          preloadGroup: item.preloadGroup,
          assetType: item.assetType,
          // OVERWORLD_PLANNING §5.6: the declared fit target travels with the spec
          // so the manifest can record post-fit meters (dimsM) for the §9.5 gate.
          targetHeightM: item.targetHeightM
        });
        try {
          const result = item.type === 'copy' ? processCopy(item) : await processModel(io, deps, item);
          built.push(result);
          if (result.dims) {
            const meta = sourceByOut.get(result.rel);
            if (meta) meta.dims = result.dims;
          }
        } catch (err) {
          failures++;
          console.error(`  FAIL ${item.src}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  if (failures) {
    console.error(`${failures} item(s) failed`);
    process.exit(1);
  }

  if (wantsManifest || wantsReport || wantsBudgetCheck) {
    let manifestIo = null;
    if (!specs.length && Object.keys(WORLD_SIZES).length > 0) {
      const deps = await loadDeps();
      await deps.meshopt.MeshoptDecoder.ready;
      manifestIo = new deps.NodeIO()
        .registerExtensions(deps.ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': deps.meshopt.MeshoptDecoder });
    }
    const manifest = await buildManifest(sourceByOut, manifestIo);
    if (wantsManifest) writeManifest(manifest);
    if (wantsReport) printReport(manifest, built);
    if (wantsBudgetCheck) {
      const budgetFailures = checkBudgets(manifest);
      const animationFailures = checkBodyAnimations(manifest);
      if (budgetFailures.length || animationFailures.length) {
        console.error('\nasset check failed:');
        for (const fail of budgetFailures) console.error(`  - budget: ${fail}`);
        for (const fail of animationFailures) console.error(`  - animation: ${fail}`);
        process.exit(1);
      }
      console.log(`asset budget check passed (${formatBytes(manifest.totalBytes)} / ${formatBytes(DEFAULT_BUDGETS.maxTotalBytes)})`);
      console.log('asset body animation check passed');
    }
  }
  console.log('done.');
}

main();
