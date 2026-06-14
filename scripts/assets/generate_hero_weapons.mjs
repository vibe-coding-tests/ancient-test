// Generate original low-poly per-hero weapon GLBs for the 80 humanoid authored
// heroes. These are deliberately simple, stylized meshes that attach to the
// resolved hand socket at runtime; item weapons can still override them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SPEC = path.join(HERE, 'specs', 'heroes.json');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'weapons', 'heroes');

const MATERIALS = ['primary', 'secondary', 'accent', 'dark'];

const STYLE_BY_HERO = {
  abaddon: 'greatsword',
  alchemist: 'cleaver',
  'anti-mage': 'glaive',
  'arc-warden': 'orb-staff',
  axe: 'axe',
  beastmaster: 'dual-axes',
  'bloodseeker': 'blood-blade',
  'bounty-hunter': 'dagger',
  brewmaster: 'keg-staff',
  bristleback: 'quill-club',
  'chaos-knight': 'greatsword',
  chen: 'staff',
  clockwerk: 'wrench',
  'crystal-maiden': 'frost-staff',
  'dark-seer': 'orb-staff',
  'dark-willow': 'wand',
  dawnbreaker: 'hammer',
  dazzle: 'staff',
  'death-prophet': 'spirit-staff',
  disruptor: 'lightning-staff',
  'dragon-knight': 'greatsword',
  'drow-ranger': 'bow',
  earthshaker: 'totem',
  'ember-spirit': 'flame-sword',
  enchantress: 'spear',
  'faceless-void': 'mace',
  grimstroke: 'brush-staff',
  huskar: 'spear',
  invoker: 'orb-staff',
  juggernaut: 'katana',
  'keeper-of-the-light': 'lantern-staff',
  kunkka: 'cutlass',
  'legion-commander': 'sword',
  lich: 'frost-staff',
  lifestealer: 'claws',
  lina: 'flame-staff',
  lion: 'staff',
  luna: 'glaive',
  magnus: 'poleaxe',
  marci: 'gauntlet',
  mars: 'spear',
  meepo: 'shovel',
  mirana: 'bow',
  'monkey-king': 'long-staff',
  'natures-prophet': 'branch-staff',
  necrophos: 'scythe',
  'ogre-magi': 'club',
  omniknight: 'hammer',
  'outworld-destroyer': 'orb-staff',
  pangolier: 'rapier',
  'phantom-assassin': 'dagger',
  'phantom-lancer': 'spear',
  pudge: 'hook',
  pugna: 'staff',
  'queen-of-pain': 'dagger',
  razor: 'whip',
  riki: 'dagger',
  rubick: 'staff',
  'shadow-shaman': 'staff',
  silencer: 'glaive',
  'skywrath-mage': 'wing-staff',
  slardar: 'spear',
  slark: 'dagger',
  sniper: 'rifle',
  'storm-spirit': 'lightning-staff',
  sven: 'greatsword',
  'templar-assassin': 'psi-blade',
  timbersaw: 'saw-axe',
  'troll-warlord': 'dual-axes',
  underlord: 'cleaver',
  undying: 'tomb-club',
  'vengeful-spirit': 'spear',
  'void-spirit': 'katana',
  warlock: 'staff',
  windranger: 'bow',
  'winter-wyvern': 'frost-staff',
  'witch-doctor': 'staff',
  'wraith-king': 'greatsword',
  zeus: 'lightning-staff'
};

function hexToLinearFactor(hex) {
  const h = hex.replace('#', '');
  const to = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [to(parseInt(h.slice(0, 2), 16)), to(parseInt(h.slice(2, 4), 16)), to(parseInt(h.slice(4, 6), 16)), 1];
}

function styleFor(item) {
  const heroId = path.basename(item.out, '.glb');
  if (STYLE_BY_HERO[heroId]) return STYLE_BY_HERO[heroId];
  const base = path.basename(item.src, '.glb').toLowerCase();
  if (base === 'mage') return 'staff';
  if (base === 'barbarian') return 'axe';
  if (base === 'rogue') return 'dagger';
  return 'sword';
}

function pushFace(positions, normals, indices, verts, normal) {
  const base = positions.length / 3;
  for (const v of verts) {
    positions.push(v[0], v[1], v[2]);
    normals.push(normal[0], normal[1], normal[2]);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function transformPoint(p, opts = {}) {
  const rz = opts.rz ?? 0;
  const c = Math.cos(rz);
  const s = Math.sin(rz);
  const x = p[0] * c - p[1] * s;
  const y = p[0] * s + p[1] * c;
  return [x + (opts.x ?? 0), y + (opts.y ?? 0), p[2] + (opts.z ?? 0)];
}

function transformNormal(n, opts = {}) {
  const rz = opts.rz ?? 0;
  const c = Math.cos(rz);
  const s = Math.sin(rz);
  return [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
}

function box(name, mat, sx, sy, sz, opts = {}) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const faces = [
    [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z], [1, 0, 0]],
    [[-x, y, -z], [-x, -y, -z], [-x, -y, z], [-x, y, z], [-1, 0, 0]],
    [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z], [0, 1, 0]],
    [[-x, -y, -z], [-x, -y, z], [x, -y, z], [x, -y, -z], [0, -1, 0]],
    [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1]],
    [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1]]
  ];
  const positions = [], normals = [], indices = [];
  for (const face of faces) {
    const normal = transformNormal(face[4], opts);
    pushFace(positions, normals, indices, face.slice(0, 4).map((p) => transformPoint(p, opts)), normal);
  }
  return { name, mat, positions, normals, indices };
}

function cylinder(name, mat, radius, length, axis = 'y', opts = {}, sides = 8) {
  const positions = [], normals = [], indices = [];
  const axisPoint = (t, a, r = radius) => {
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    if (axis === 'x') return [t * length / 2, c, s];
    if (axis === 'z') return [c, s, t * length / 2];
    return [c, t * length / 2, s];
  };
  const axisNormal = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    if (axis === 'x') return [0, c, s];
    if (axis === 'z') return [c, s, 0];
    return [c, 0, s];
  };
  const capNormal = (t) => axis === 'x' ? [t, 0, 0] : axis === 'z' ? [0, 0, t] : [0, t, 0];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    pushFace(
      positions,
      normals,
      indices,
      [axisPoint(-1, a0), axisPoint(1, a0), axisPoint(1, a1), axisPoint(-1, a1)].map((p) => transformPoint(p, opts)),
      transformNormal(axisNormal((a0 + a1) / 2), opts)
    );
    for (const t of [-1, 1]) {
      const center = axisPoint(t, 0, 0);
      const verts = t > 0 ? [center, axisPoint(t, a0), axisPoint(t, a1)] : [center, axisPoint(t, a1), axisPoint(t, a0)];
      const base = positions.length / 3;
      const n = transformNormal(capNormal(t), opts);
      for (const p of verts.map((v) => transformPoint(v, opts))) {
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
      }
      indices.push(base, base + 1, base + 2);
    }
  }
  return { name, mat, positions, normals, indices };
}

function cone(name, mat, radius, length, axis = 'x', opts = {}, sides = 8) {
  const positions = [], normals = [], indices = [];
  const point = (t, a, r = radius) => {
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    if (axis === 'x') return [t * length / 2, c, s];
    if (axis === 'z') return [c, s, t * length / 2];
    return [c, t * length / 2, s];
  };
  const tip = point(1, 0, 0);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const base0 = point(-1, a0);
    const base1 = point(-1, a1);
    const base = positions.length / 3;
    for (const p of [base0, tip, base1].map((v) => transformPoint(v, opts))) positions.push(p[0], p[1], p[2]);
    const n = transformNormal([0.7, Math.cos((a0 + a1) / 2) * 0.7, Math.sin((a0 + a1) / 2) * 0.7], opts);
    normals.push(...n, ...n, ...n);
    indices.push(base, base + 1, base + 2);
    const cb = positions.length / 3;
    for (const p of [[-length / 2, 0, 0], base1, base0].map((v) => transformPoint(axis === 'x' ? v : v, opts))) positions.push(p[0], p[1], p[2]);
    const cn = transformNormal(axis === 'x' ? [-1, 0, 0] : axis === 'y' ? [0, -1, 0] : [0, 0, -1], opts);
    normals.push(...cn, ...cn, ...cn);
    indices.push(cb, cb + 1, cb + 2);
  }
  return { name, mat, positions, normals, indices };
}

function partsFor(style, palette) {
  const p = [];
  const add = (...parts) => p.push(...parts);
  const blade = style.includes('flame') ? 'primary' : style.includes('frost') ? 'accent' : 'secondary';
  const glow = style.includes('lightning') || style.includes('orb') || style.includes('psi') ? 'accent' : 'primary';
  switch (style) {
    case 'staff':
    case 'frost-staff':
    case 'flame-staff':
    case 'spirit-staff':
    case 'lightning-staff':
    case 'lantern-staff':
    case 'branch-staff':
    case 'brush-staff':
    case 'wing-staff':
    case 'orb-staff':
      add(cylinder('shaft', 'secondary', 0.035, 1.45, 'y', { y: 0.15 }));
      add(box('head-gem', glow, 0.22, 0.22, 0.22, { y: 0.95, rz: Math.PI / 4 }));
      if (style === 'orb-staff' || style === 'lightning-staff') add(cylinder('halo', 'accent', 0.13, 0.035, 'z', { y: 0.95 }, 12));
      if (style === 'brush-staff') add(box('brush', 'primary', 0.16, 0.36, 0.12, { y: 0.92, rz: -0.25 }));
      break;
    case 'bow':
      add(box('upper-bow', 'secondary', 0.08, 0.9, 0.07, { x: 0.12, y: 0.28, rz: -0.32 }));
      add(box('lower-bow', 'secondary', 0.08, 0.9, 0.07, { x: 0.12, y: -0.28, rz: 0.32 }));
      add(cylinder('string', 'dark', 0.012, 1.35, 'y', { x: -0.08 }));
      break;
    case 'rifle':
      add(cylinder('barrel', 'secondary', 0.035, 1.15, 'x', { x: 0.5 }));
      add(box('stock', 'primary', 0.38, 0.14, 0.12, { x: -0.08 }));
      add(cylinder('scope', 'accent', 0.045, 0.32, 'x', { x: 0.36, y: 0.12 }));
      break;
    case 'hook':
      add(cylinder('chain', 'secondary', 0.028, 0.65, 'y', { y: -0.2 }));
      add(box('hook-spine', 'secondary', 0.12, 0.55, 0.08, { y: -0.65, rz: -0.4 }));
      add(cone('hook-tip', 'accent', 0.09, 0.24, 'x', { x: 0.22, y: -0.9, rz: -0.8 }));
      break;
    case 'hammer':
    case 'mace':
    case 'wrench':
      add(cylinder('haft', 'secondary', 0.035, 0.95, 'y', { y: 0.05 }));
      add(box('head', 'accent', style === 'hammer' ? 0.55 : 0.36, 0.26, 0.26, { y: -0.48 }));
      if (style === 'wrench') add(box('jaw', 'secondary', 0.22, 0.12, 0.28, { x: 0.24, y: -0.62 }));
      break;
    case 'totem':
    case 'club':
    case 'quill-club':
    case 'tomb-club':
    case 'keg-staff':
      add(cylinder('handle', 'secondary', 0.04, 1.05, 'y', { y: 0.12 }));
      add(box('head', 'primary', 0.36, 0.5, 0.36, { y: -0.5 }));
      if (style === 'keg-staff') add(cylinder('keg-band', 'accent', 0.24, 0.32, 'z', { y: -0.5 }, 12));
      break;
    case 'spear':
    case 'poleaxe':
    case 'long-staff':
      add(cylinder('shaft', 'secondary', 0.028, 1.65, 'x', { x: 0.58 }));
      if (style !== 'long-staff') add(cone('tip', 'accent', 0.11, 0.34, 'x', { x: 1.55 }));
      if (style === 'poleaxe') add(box('axe-head', 'accent', 0.3, 0.45, 0.06, { x: 1.32, y: -0.12 }));
      break;
    case 'axe':
    case 'dual-axes':
    case 'saw-axe':
      add(cylinder('haft', 'secondary', 0.035, 0.95, 'y', { y: 0.08 }));
      add(box('blade', 'accent', 0.42, 0.32, 0.06, { x: 0.16, y: -0.44 }));
      if (style === 'dual-axes') add(box('back-blade', 'accent', 0.36, 0.28, 0.06, { x: -0.16, y: -0.44 }));
      if (style === 'saw-axe') add(cylinder('saw', 'accent', 0.22, 0.055, 'z', { x: 0.28, y: -0.44 }, 14));
      break;
    case 'cleaver':
    case 'greatsword':
    case 'sword':
    case 'cutlass':
    case 'katana':
    case 'rapier':
    case 'flame-sword':
    case 'blood-blade':
    case 'glaive':
    case 'psi-blade':
      add(box('grip', 'dark', 0.18, 0.1, 0.09, { x: 0.02 }));
      add(box('guard', 'accent', 0.06, 0.34, 0.1, { x: 0.16 }));
      add(box('blade', blade, style === 'greatsword' ? 1.05 : style === 'rapier' ? 0.92 : 0.78, style === 'cleaver' ? 0.36 : 0.12, 0.05, { x: style === 'greatsword' ? 0.72 : 0.58 }));
      add(cone('tip', blade, style === 'rapier' ? 0.055 : 0.08, 0.24, 'x', { x: style === 'greatsword' ? 1.32 : 1.05 }));
      if (style === 'glaive') add(box('crescent', 'accent', 0.34, 0.55, 0.05, { x: 0.82, rz: 0.25 }));
      if (style === 'psi-blade') add(box('glow', 'accent', 0.72, 0.22, 0.04, { x: 0.64 }));
      break;
    case 'dagger':
    case 'claws':
    case 'gauntlet':
    case 'shovel':
      add(box('grip', 'dark', 0.16, 0.1, 0.1));
      add(box('edge', 'accent', style === 'shovel' ? 0.42 : 0.46, style === 'claws' ? 0.18 : 0.12, 0.05, { x: 0.36 }));
      if (style === 'claws') {
        add(box('claw-2', 'accent', 0.4, 0.08, 0.04, { x: 0.38, y: 0.12 }));
        add(box('claw-3', 'accent', 0.4, 0.08, 0.04, { x: 0.38, y: -0.12 }));
      }
      break;
    case 'scythe':
      add(cylinder('shaft', 'secondary', 0.03, 1.45, 'y', { y: 0.1 }));
      add(box('blade', 'accent', 0.56, 0.12, 0.05, { x: 0.28, y: 0.74, rz: -0.55 }));
      break;
    case 'whip':
      for (let i = 0; i < 6; i++) add(box(`segment-${i}`, i % 2 ? 'accent' : 'secondary', 0.16, 0.05, 0.05, { x: 0.18 + i * 0.13, y: Math.sin(i) * 0.08, rz: Math.sin(i * 0.7) * 0.35 }));
      break;
    default:
      add(box('grip', 'dark', 0.18, 0.1, 0.09));
      add(box('blade', 'secondary', 0.75, 0.12, 0.05, { x: 0.54 }));
      add(cone('tip', 'secondary', 0.08, 0.22, 'x', { x: 1.0 }));
  }
  return p.map((part) => ({ ...part, palette }));
}

function bounds(values) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], values[i + k]);
      max[k] = Math.max(max[k], values[i + k]);
    }
  }
  return { min, max };
}

function align4(n) {
  return (n + 3) & ~3;
}

function writeGlb(file, heroId, style, palette, parts) {
  const json = {
    asset: { version: '2.0', generator: 'ancients generate_hero_weapons.mjs' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: MATERIALS.map((role) => {
      const color = role === 'primary' ? palette[0] : role === 'secondary' ? palette[1] : role === 'accent' ? palette[2] : '#161820';
      return {
        name: role,
        pbrMetallicRoughness: {
          baseColorFactor: hexToLinearFactor(color),
          metallicFactor: role === 'secondary' ? 0.5 : role === 'accent' ? 0.35 : 0.08,
          roughnessFactor: role === 'accent' ? 0.32 : 0.68
        },
        emissiveFactor: role === 'accent' ? hexToLinearFactor(color).slice(0, 3).map((v) => v * 0.25) : [0, 0, 0]
      };
    }),
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: []
  };
  const chunks = [];
  const pushTyped = (array, target) => {
    const raw = Buffer.from(array.buffer);
    const offset = chunks.reduce((sum, b) => sum + b.length, 0);
    const padded = Buffer.concat([raw, Buffer.alloc(align4(raw.length) - raw.length)]);
    chunks.push(padded);
    const view = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: raw.length, target });
    return view;
  };
  for (const part of parts) {
    const pos = new Float32Array(part.positions);
    const nor = new Float32Array(part.normals);
    const idx = new Uint16Array(part.indices);
    const posView = pushTyped(pos, 34962);
    const norView = pushTyped(nor, 34962);
    const idxView = pushTyped(idx, 34963);
    const posAccessor = json.accessors.length;
    const b = bounds(part.positions);
    json.accessors.push({ bufferView: posView, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: b.min, max: b.max });
    const norAccessor = json.accessors.length;
    json.accessors.push({ bufferView: norView, componentType: 5126, count: nor.length / 3, type: 'VEC3' });
    const idxAccessor = json.accessors.length;
    json.accessors.push({ bufferView: idxView, componentType: 5123, count: idx.length, type: 'SCALAR' });
    const mesh = json.meshes.length;
    json.meshes.push({
      name: `${heroId}-${style}-${part.name}`,
      primitives: [{
        attributes: { POSITION: posAccessor, NORMAL: norAccessor },
        indices: idxAccessor,
        material: MATERIALS.indexOf(part.mat),
        mode: 4
      }]
    });
    const node = json.nodes.length;
    json.nodes.push({ name: `${heroId}-${part.name}`, mesh });
    json.scenes[0].nodes.push(node);
  }
  const bin = Buffer.concat(chunks);
  json.buffers[0].byteLength = bin.length;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(align4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc(align4(bin.length) - bin.length)]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4; // glTF
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonPadded.length, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4; // JSON
  jsonPadded.copy(out, o); o += jsonPadded.length;
  out.writeUInt32LE(binPadded.length, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4; // BIN
  binPadded.copy(out, o);
  fs.writeFileSync(file, out);
}

function main() {
  const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;
  for (const item of spec.items) {
    const heroId = path.basename(item.out, '.glb');
    const style = styleFor(item);
    const palette = item.recolor ?? ['#888888', '#444444', '#dddddd'];
    const file = path.join(OUT_DIR, `${heroId}.glb`);
    writeGlb(file, heroId, style, palette, partsFor(style, palette));
    count++;
  }
  console.log(`generated ${count} hero weapon GLBs in ${path.relative(ROOT, OUT_DIR)}`);
}

main();
