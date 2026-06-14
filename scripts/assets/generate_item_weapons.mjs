// Generate original low-poly signature held-weapon GLBs for a handful of marquee
// artifacts (ASSET_GAPS P3). These ship into public/assets/weapons/items/ and are
// wired through ITEM_WEAPON_GLB in engine/assets.ts; at runtime they override the
// hero's default hand weapon when the artifact is equipped. Items keep their
// procedural `appearance.weapon` as the guaranteed fallback when assets are absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'weapons', 'items');

const MATERIALS = ['primary', 'secondary', 'accent', 'dark'];

// Marquee artifacts → palette [primary, secondary, accent]. `accent` is emissive.
const ITEMS = {
  daedalus: { palette: ['#d23b32', '#c8ccd6', '#ff6a4a'], style: 'crit-greatsword' },
  radiance: { palette: ['#ffd94a', '#fff4c2', '#fff2a0'], style: 'sun-blade' },
  battlefury: { palette: ['#9aa4b2', '#c8cdd8', '#7ad98a'], style: 'great-cleaver' },
  'divine-rapier': { palette: ['#ffe27d', '#fff6d0', '#ffcf4a'], style: 'divine-rapier' },
  butterfly: { palette: ['#9affbd', '#d8fff0', '#ffffff'], style: 'wing-blades' },
  'scythe-of-vyse': { palette: ['#b88cff', '#4a2a6a', '#ffd96a'], style: 'hex-scythe' },
  'eye-of-skadi': { palette: ['#9fe8ff', '#d8fbff', '#ffffff'], style: 'frost-orb' },
  'monkey-king-bar': { palette: ['#f0d36a', '#8a5a22', '#fff0a8'], style: 'king-staff' },
  'abyssal-blade': { palette: ['#8a3cff', '#241038', '#d8a8ff'], style: 'abyssal-mace' },
  mjollnir: { palette: ['#7ddcff', '#c8f2ff', '#ffffff'], style: 'storm-hammer' },
  satanic: { palette: ['#b01818', '#4a0a0a', '#ff9a5a'], style: 'blood-axe' },
  bloodthorn: { palette: ['#b0185a', '#3a1024', '#ff86c8'], style: 'thorn-rapier' },
  desolator: { palette: ['#d92727', '#2a1111', '#ffb0a0'], style: 'shred-blade' }
};

function hexToLinearFactor(hex) {
  const h = hex.replace('#', '');
  const to = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [to(parseInt(h.slice(0, 2), 16)), to(parseInt(h.slice(2, 4), 16)), to(parseInt(h.slice(4, 6), 16)), 1];
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
    for (const p of [[-length / 2, 0, 0], base1, base0].map((v) => transformPoint(v, opts))) positions.push(p[0], p[1], p[2]);
    const cn = transformNormal(axis === 'x' ? [-1, 0, 0] : axis === 'y' ? [0, -1, 0] : [0, 0, -1], opts);
    normals.push(...cn, ...cn, ...cn);
    indices.push(cb, cb + 1, cb + 2);
  }
  return { name, mat, positions, normals, indices };
}

function ellipsoid(name, mat, rx, ry, rz, opts = {}, cols = 14, rows = 7) {
  const positions = [], normals = [], indices = [];
  for (let y = 0; y <= rows; y++) {
    const v = y / rows;
    const phi = -Math.PI / 2 + v * Math.PI;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    for (let x = 0; x <= cols; x++) {
      const u = x / cols;
      const theta = u * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      const p = [ct * cp * rx, sp * ry, st * cp * rz];
      positions.push(...transformPoint(p, opts));
      const n = transformNormal([ct * cp, sp, st * cp], opts);
      normals.push(...n);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = y * (cols + 1) + x;
      const b = a + cols + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { name, mat, positions, normals, indices };
}

function taperedBlade(name, mat, length, rootWidth, tipWidth, thickness, opts = {}) {
  const x0 = -length / 2;
  const x1 = length / 2;
  const r = rootWidth / 2;
  const t = tipWidth / 2;
  const z = thickness / 2;
  const verts = {
    lbf: [x0, -r, z], ltf: [x0, r, z], rbf: [x1, -t, z], rtf: [x1, t, z],
    lbb: [x0, -r, -z], ltb: [x0, r, -z], rbb: [x1, -t, -z], rtb: [x1, t, -z]
  };
  const positions = [], normals = [], indices = [];
  const face = (names, normal) => pushFace(
    positions,
    normals,
    indices,
    names.map((k) => transformPoint(verts[k], opts)),
    transformNormal(normal, opts)
  );
  face(['lbf', 'rbf', 'rtf', 'ltf'], [0, 0, 1]);
  face(['ltb', 'rtb', 'rbb', 'lbb'], [0, 0, -1]);
  face(['ltf', 'rtf', 'rtb', 'ltb'], [0, 1, 0]);
  face(['lbb', 'rbb', 'rbf', 'lbf'], [0, -1, 0]);
  face(['rbf', 'rbb', 'rtb', 'rtf'], [1, 0, 0]);
  face(['lbb', 'lbf', 'ltf', 'ltb'], [-1, 0, 0]);
  return { name, mat, positions, normals, indices };
}

function partsFor(style) {
  const p = [];
  const add = (...parts) => p.push(...parts);
  switch (style) {
    case 'crit-greatsword':
      // Daedalus: brutal broad greatsword with a crimson crystal edge.
      add(box('grip', 'dark', 0.22, 0.11, 0.1, { x: -0.05 }));
      add(ellipsoid('pommel-gem', 'secondary', 0.08, 0.11, 0.09, { x: -0.18 }, 10, 5));
      add(box('guard', 'accent', 0.07, 0.46, 0.13, { x: 0.12 }));
      add(taperedBlade('broad-blade', 'secondary', 1.28, 0.34, 0.12, 0.06, { x: 0.78 }));
      add(taperedBlade('crystal-edge', 'primary', 1.04, 0.12, 0.04, 0.078, { x: 0.74, y: 0.13 }));
      add(cone('tip', 'primary', 0.12, 0.32, 'x', { x: 1.5 }));
      break;
    case 'sun-blade':
      // Radiance: a glowing curved sun-blade with a radiant disc at the hilt.
      add(box('grip', 'dark', 0.2, 0.1, 0.09, { x: -0.04 }));
      add(cylinder('sun-disc', 'accent', 0.2, 0.05, 'z', { x: 0.1 }, 16));
      add(taperedBlade('curved-blade', 'accent', 0.98, 0.18, 0.05, 0.05, { x: 0.62, rz: 0.12 }));
      add(taperedBlade('inner-flame', 'primary', 0.82, 0.07, 0.02, 0.06, { x: 0.58, y: 0.1, rz: 0.12 }));
      add(ellipsoid('sun-core', 'accent', 0.11, 0.11, 0.035, { x: 0.1 }, 12, 5));
      add(cone('tip', 'accent', 0.07, 0.26, 'x', { x: 1.16, y: 0.13, rz: 0.12 }));
      break;
    case 'great-cleaver':
      // Battle Fury: massive cleaver-axe with a green energy edge.
      add(cylinder('haft', 'secondary', 0.045, 1.05, 'y', { y: 0.1 }));
      add(box('grip-wrap', 'dark', 0.1, 0.5, 0.1, { y: 0.2 }));
      add(taperedBlade('cleaver', 'secondary', 0.7, 0.66, 0.28, 0.07, { x: 0.23, y: -0.5, rz: -0.12 }));
      add(taperedBlade('energy-edge', 'accent', 0.68, 0.12, 0.04, 0.085, { x: 0.5, y: -0.5, rz: -0.12 }));
      add(box('back-spike', 'secondary', 0.28, 0.16, 0.06, { x: -0.18, y: -0.5 }));
      break;
    case 'divine-rapier':
      // Divine Rapier: a long, fine, golden glowing blade with an ornate guard.
      add(box('grip', 'dark', 0.24, 0.08, 0.08, { x: -0.06 }));
      add(ellipsoid('pommel', 'accent', 0.06, 0.08, 0.08, { x: -0.2 }, 10, 5));
      add(cylinder('guard', 'accent', 0.14, 0.06, 'z', { x: 0.1 }, 12));
      add(box('quillon', 'accent', 0.05, 0.4, 0.07, { x: 0.1 }));
      add(taperedBlade('blade', 'accent', 1.34, 0.08, 0.025, 0.045, { x: 0.86 }));
      add(taperedBlade('fuller', 'primary', 1.15, 0.025, 0.008, 0.06, { x: 0.82 }));
      add(cone('tip', 'accent', 0.045, 0.3, 'x', { x: 1.62 }));
      break;
    case 'wing-blades':
      // Butterfly: paired wing-like blades around a short grip.
      add(box('grip', 'dark', 0.22, 0.08, 0.08, { x: -0.06 }));
      add(taperedBlade('wing-upper', 'primary', 0.86, 0.14, 0.035, 0.05, { x: 0.52, y: 0.13, rz: 0.22 }));
      add(taperedBlade('wing-lower', 'primary', 0.78, 0.11, 0.03, 0.05, { x: 0.5, y: -0.11, rz: -0.2 }));
      add(ellipsoid('hilt-orb', 'accent', 0.08, 0.08, 0.06, { x: 0.12 }, 10, 5));
      add(cone('upper-tip', 'accent', 0.06, 0.2, 'x', { x: 0.96, y: 0.23, rz: 0.22 }));
      add(cone('lower-tip', 'accent', 0.05, 0.18, 'x', { x: 0.88, y: -0.18, rz: -0.2 }));
      break;
    case 'hex-scythe':
      // Scythe of Vyse: crooked purple shaft with a hooked golden sheep-hex blade.
      add(cylinder('shaft', 'secondary', 0.045, 1.1, 'y', { y: 0.1, rz: 0.18 }, 12));
      add(box('grip-wrap', 'dark', 0.1, 0.36, 0.1, { y: -0.2 }));
      add(taperedBlade('crescent-back', 'accent', 0.5, 0.14, 0.04, 0.06, { x: 0.28, y: 0.66, rz: -0.4 }));
      add(taperedBlade('crescent-hook', 'accent', 0.44, 0.12, 0.035, 0.06, { x: 0.52, y: 0.46, rz: 0.44 }));
      add(ellipsoid('hex-gem', 'primary', 0.13, 0.13, 0.08, { x: 0.1, y: 0.48 }, 8, 5));
      break;
    case 'frost-orb':
      // Eye of Skadi: ice orb mounted as a hand-held scepter.
      add(cylinder('short-haft', 'secondary', 0.045, 0.8, 'y', { y: -0.08 }, 8));
      add(ellipsoid('orb-core', 'primary', 0.18, 0.18, 0.18, { y: 0.42 }, 16, 8));
      add(cylinder('orb-ring-x', 'accent', 0.025, 0.52, 'x', { y: 0.42 }, 12));
      add(cylinder('orb-ring-z', 'accent', 0.025, 0.52, 'z', { y: 0.42 }, 12));
      for (let i = 0; i < 4; i++) add(cone(`ice-spike-${i}`, 'accent', 0.04, 0.22, 'x', { x: 0.18 + i * 0.04, y: 0.42, z: (i - 1.5) * 0.1 }, 6));
      break;
    case 'king-staff':
      // Monkey King Bar: ornate gold fighting staff.
      add(cylinder('staff', 'primary', 0.05, 1.55, 'x', { x: 0.56 }, 10));
      add(cylinder('band-l', 'accent', 0.075, 0.05, 'x', { x: -0.12 }, 10));
      add(cylinder('band-r', 'accent', 0.075, 0.05, 'x', { x: 1.24 }, 10));
      add(box('grip-wrap', 'dark', 0.38, 0.1, 0.1, { x: 0.24 }));
      add(cone('tip-l', 'accent', 0.07, 0.16, 'x', { x: -0.28, rz: Math.PI }, 8));
      add(cone('tip-r', 'accent', 0.07, 0.16, 'x', { x: 1.42 }, 8));
      break;
    case 'abyssal-mace':
      // Abyssal Blade: heavy void mace with a cleaver spike.
      add(cylinder('haft', 'dark', 0.05, 0.85, 'x', { x: 0.28 }, 8));
      add(ellipsoid('void-head', 'primary', 0.22, 0.22, 0.18, { x: 0.82 }, 12, 6));
      add(cone('void-spike', 'accent', 0.16, 0.32, 'x', { x: 1.08 }, 8));
      add(taperedBlade('side-blade-l', 'secondary', 0.42, 0.12, 0.035, 0.06, { x: 0.72, y: 0.26, rz: Math.PI / 2 }));
      add(taperedBlade('side-blade-r', 'secondary', 0.42, 0.12, 0.035, 0.06, { x: 0.72, y: -0.26, rz: -Math.PI / 2 }));
      break;
    case 'storm-hammer':
      // Mjollnir: compact storm hammer with charged prongs.
      add(cylinder('grip', 'dark', 0.045, 0.8, 'y', { y: -0.12 }, 8));
      add(ellipsoid('hammer-head', 'secondary', 0.34, 0.16, 0.16, { y: 0.32 }, 14, 6));
      add(ellipsoid('storm-core', 'accent', 0.13, 0.13, 0.18, { y: 0.32 }, 12, 6));
      add(cone('spark-l', 'accent', 0.04, 0.2, 'x', { x: 0.36, y: 0.32 }, 6));
      add(cone('spark-r', 'accent', 0.04, 0.2, 'x', { x: -0.36, y: 0.32, rz: Math.PI }, 6));
      break;
    case 'blood-axe':
      // Satanic: dark red lifesteal axe with a horned blade.
      add(cylinder('haft', 'dark', 0.05, 1.0, 'y', { y: 0.05 }, 8));
      add(taperedBlade('axe-blade', 'primary', 0.58, 0.5, 0.14, 0.07, { x: 0.26, y: 0.44, rz: Math.PI / 2 }));
      add(cone('horn-top', 'accent', 0.07, 0.28, 'y', { x: 0.12, y: 0.86 }, 8));
      add(cone('horn-bottom', 'accent', 0.07, 0.24, 'y', { x: 0.12, y: 0.08, rz: Math.PI }, 8));
      add(taperedBlade('blood-edge', 'accent', 0.5, 0.08, 0.025, 0.08, { x: 0.48, y: 0.44 }));
      break;
    case 'thorn-rapier':
      // Bloodthorn: thin rapier wrapped in thorn spikes.
      add(box('grip', 'dark', 0.24, 0.07, 0.07, { x: -0.06 }));
      add(cylinder('guard', 'primary', 0.13, 0.04, 'z', { x: 0.1 }, 10));
      add(taperedBlade('needle', 'primary', 1.12, 0.05, 0.012, 0.04, { x: 0.74 }));
      add(cone('tip', 'accent', 0.04, 0.22, 'x', { x: 1.4 }, 8));
      for (let i = 0; i < 5; i++) add(cone(`thorn-${i}`, 'accent', 0.035, 0.14, 'y', { x: 0.28 + i * 0.18, y: 0.08 * (i % 2 ? 1 : -1) }, 6));
      break;
    case 'shred-blade':
      // Desolator: red serrated armor-shred sword.
      add(box('grip', 'dark', 0.24, 0.08, 0.08, { x: -0.05 }));
      add(box('guard', 'secondary', 0.06, 0.42, 0.08, { x: 0.12 }));
      add(taperedBlade('serrated-blade', 'primary', 1.02, 0.2, 0.06, 0.055, { x: 0.72 }));
      for (let i = 0; i < 5; i++) add(cone(`tooth-${i}`, 'accent', 0.04, 0.14, 'y', { x: 0.34 + i * 0.14, y: 0.16 }, 6));
      add(cone('tip', 'primary', 0.08, 0.24, 'x', { x: 1.26 }));
      break;
    default:
      add(box('grip', 'dark', 0.18, 0.1, 0.09));
      add(box('blade', 'secondary', 0.75, 0.12, 0.05, { x: 0.54 }));
      add(cone('tip', 'secondary', 0.08, 0.22, 'x', { x: 1.0 }));
  }
  return p;
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

function writeGlb(file, itemId, style, palette, parts) {
  const json = {
    asset: { version: '2.0', generator: 'ancients generate_item_weapons.mjs' },
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
          metallicFactor: role === 'secondary' ? 0.6 : role === 'accent' ? 0.3 : 0.1,
          roughnessFactor: role === 'accent' ? 0.28 : 0.6
        },
        emissiveFactor: role === 'accent' ? hexToLinearFactor(color).slice(0, 3).map((v) => v * 0.5) : [0, 0, 0]
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
      name: `${itemId}-${style}-${part.name}`,
      primitives: [{
        attributes: { POSITION: posAccessor, NORMAL: norAccessor },
        indices: idxAccessor,
        material: MATERIALS.indexOf(part.mat),
        mode: 4
      }]
    });
    const node = json.nodes.length;
    json.nodes.push({ name: `${itemId}-${part.name}`, mesh });
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
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;
  for (const [id, def] of Object.entries(ITEMS)) {
    writeGlb(path.join(OUT_DIR, `${id}.glb`), id, def.style, def.palette, partsFor(def.style));
    count++;
  }
  console.log(`generated ${count} item weapon GLBs in ${path.relative(ROOT, OUT_DIR)}`);
}

main();
