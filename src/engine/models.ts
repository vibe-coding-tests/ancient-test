import * as THREE from 'three';
import type { SilhouetteSpec } from '../core/types';

// ------------------------------------------------------------------
// Procedural unit models (SPEC §3): primitive-built, palette-driven,
// readable at gameplay zoom. Returns a rig of named parts that the
// animator drives. No external assets, ever.
// ------------------------------------------------------------------

export interface UnitRig {
  root: THREE.Group;       // positioned at unit origin (feet)
  body: THREE.Group;       // bobs/leans
  head?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  weapon?: THREE.Object3D;
  height: number;
  materials: THREE.MeshLambertMaterial[];
}

function lam(color: string | number, emissive = 0): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: false, emissive });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildUnitRig(sil: SilhouetteSpec, palette: [string, string, string]): UnitRig {
  const [primary, secondary, accent] = palette;
  const matP = lam(primary);
  const matS = lam(secondary);
  const matA = lam(accent);
  const materials = [matP, matS, matA];
  const s = sil.scale;

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const rig: UnitRig = { root, body, height: 1.8 * s, materials };

  switch (sil.build) {
    case 'ward': {
      const post = mesh(new THREE.CylinderGeometry(0.16 * s, 0.22 * s, 1.4 * s, 10), matS);
      post.position.y = 0.7 * s;
      const eye = mesh(new THREE.OctahedronGeometry(0.34 * s), matA);
      eye.position.y = 1.6 * s;
      eye.name = 'ward-eye';
      body.add(post, eye);
      rig.head = eye;
      rig.height = 1.9 * s;
      return rig;
    }
    case 'blob': {
      const blob = mesh(new THREE.SphereGeometry(0.7 * s, 14, 10), matP);
      blob.position.y = 0.65 * s;
      blob.scale.y = 0.85;
      const eyeL = mesh(new THREE.SphereGeometry(0.09 * s, 8, 6), matA);
      eyeL.position.set(0.5 * s, 0.8 * s, 0.22 * s);
      const eyeR = eyeL.clone();
      eyeR.position.z = -0.22 * s;
      body.add(blob, eyeL, eyeR);
      rig.height = 1.3 * s;
      return rig;
    }
    case 'quad': {
      const torso = mesh(new THREE.BoxGeometry(1.5 * s, 0.7 * s, 0.8 * s), matP);
      torso.position.y = 0.75 * s;
      body.add(torso);
      const head = mesh(new THREE.BoxGeometry(0.55 * s, 0.5 * s, 0.5 * s), matS);
      head.position.set(0.95 * s, 1.0 * s, 0);
      body.add(head);
      rig.head = head;
      const legGeo = new THREE.CylinderGeometry(0.1 * s, 0.13 * s, 0.7 * s, 10);
      const legs: THREE.Object3D[] = [];
      for (const [lx, lz] of [[0.55, 0.3], [0.55, -0.3], [-0.55, 0.3], [-0.55, -0.3]]) {
        const leg = mesh(legGeo, matS);
        leg.position.set(lx * s, 0.35 * s, lz * s);
        body.add(leg);
        legs.push(leg);
      }
      rig.legL = legs[0];
      rig.legR = legs[1];
      rig.height = 1.4 * s;
      return rig;
    }
    case 'bird': {
      const torso = mesh(new THREE.SphereGeometry(0.5 * s, 12, 8), matP);
      torso.position.y = 1.1 * s;
      const head = mesh(new THREE.SphereGeometry(0.28 * s, 12, 8), matS);
      head.position.set(0.4 * s, 1.6 * s, 0);
      const beak = mesh(new THREE.ConeGeometry(0.1 * s, 0.35 * s, 8), matA);
      beak.rotation.z = -Math.PI / 2;
      beak.position.set(0.72 * s, 1.6 * s, 0);
      const wingGeo = new THREE.BoxGeometry(0.5 * s, 0.08 * s, 0.9 * s);
      const wingL = mesh(wingGeo, matS);
      wingL.position.set(-0.1 * s, 1.25 * s, 0.6 * s);
      const wingR = mesh(wingGeo, matS);
      wingR.position.set(-0.1 * s, 1.25 * s, -0.6 * s);
      body.add(torso, head, beak, wingL, wingR);
      rig.head = head;
      rig.armL = wingL;
      rig.armR = wingR;
      rig.height = 1.9 * s;
      return rig;
    }
    case 'golem': {
      const torso = mesh(new THREE.DodecahedronGeometry(0.8 * s, 1), matP);
      torso.position.y = 1.2 * s;
      torso.scale.set(1, 1.15, 0.85);
      body.add(torso);
      const head = mesh(new THREE.DodecahedronGeometry(0.32 * s, 1), matS);
      head.position.y = 2.25 * s;
      body.add(head);
      rig.head = head;
      const armGeo = new THREE.DodecahedronGeometry(0.34 * s, 1);
      const armL = new THREE.Group();
      const armR = new THREE.Group();
      const fistL = mesh(armGeo, matS);
      fistL.position.y = -0.8 * s;
      const fistR = mesh(armGeo, matS);
      fistR.position.y = -0.8 * s;
      armL.add(fistL);
      armR.add(fistR);
      armL.position.set(0, 1.8 * s, 0.95 * s);
      armR.position.set(0, 1.8 * s, -0.95 * s);
      body.add(armL, armR);
      rig.armL = armL;
      rig.armR = armR;
      const legGeo = new THREE.BoxGeometry(0.4 * s, 0.6 * s, 0.4 * s);
      const legL = mesh(legGeo, matS);
      legL.position.set(0, 0.3 * s, 0.4 * s);
      const legR = mesh(legGeo, matS);
      legR.position.set(0, 0.3 * s, -0.4 * s);
      body.add(legL, legR);
      rig.legL = legL;
      rig.legR = legR;
      rig.height = 2.6 * s;
      return rig;
    }
    case 'brute':
    case 'biped':
    default: {
      const brute = sil.build === 'brute';
      const wide = sil.bodyShape === 'bulky' || brute;
      const robed = sil.bodyShape === 'robed';

      // torso
      const torsoGeo = robed
        ? new THREE.ConeGeometry(0.55 * s, 1.3 * s, 12)
        : new THREE.BoxGeometry((wide ? 0.95 : 0.62) * s, 0.95 * s, (wide ? 0.7 : 0.45) * s);
      const torso = mesh(torsoGeo, matP);
      torso.position.y = (robed ? 0.85 : 1.05) * s;
      body.add(torso);

      // belt
      if (sil.extras?.includes('belt') && !robed) {
        const belt = mesh(new THREE.BoxGeometry((wide ? 1.0 : 0.68) * s, 0.16 * s, (wide ? 0.74 : 0.5) * s), matA);
        belt.position.y = 0.68 * s;
        body.add(belt);
      }

      // head
      const headGroup = new THREE.Group();
      headGroup.position.y = (robed ? 1.75 : 1.85) * s;
      let headMesh: THREE.Mesh;
      switch (sil.head) {
        case 'helm':
          headMesh = mesh(new THREE.CylinderGeometry(0.24 * s, 0.28 * s, 0.42 * s, 12), matS);
          break;
        case 'hood':
          headMesh = mesh(new THREE.ConeGeometry(0.3 * s, 0.55 * s, 12), matS);
          headMesh.position.y = 0.05 * s;
          break;
        case 'mask':
          headMesh = mesh(new THREE.SphereGeometry(0.26 * s, 12, 8), matS);
          break;
        case 'skull':
          headMesh = mesh(new THREE.SphereGeometry(0.26 * s, 12, 8), lam('#e8e8d8'));
          break;
        case 'horned':
          headMesh = mesh(new THREE.SphereGeometry(0.28 * s, 12, 8), matS);
          break;
        default:
          headMesh = mesh(new THREE.SphereGeometry(0.25 * s, 12, 8), matS);
      }
      headGroup.add(headMesh);
      if (sil.head === 'mask') {
        const visor = mesh(new THREE.BoxGeometry(0.34 * s, 0.18 * s, 0.12 * s), matA);
        visor.position.set(0.18 * s, 0.02 * s, 0);
        headGroup.add(visor);
      }
      if (sil.head === 'horned' || sil.extras?.includes('horns')) {
        const hornGeo = new THREE.ConeGeometry(0.07 * s, 0.4 * s, 8);
        const hornL = mesh(hornGeo, matA);
        hornL.position.set(0, 0.22 * s, 0.22 * s);
        hornL.rotation.x = 0.5;
        const hornR = mesh(hornGeo, matA);
        hornR.position.set(0, 0.22 * s, -0.22 * s);
        hornR.rotation.x = -0.5;
        headGroup.add(hornL, hornR);
      }
      if (sil.extras?.includes('crown')) {
        const crown = mesh(new THREE.CylinderGeometry(0.2 * s, 0.24 * s, 0.16 * s, 12), matA);
        crown.position.y = 0.3 * s;
        headGroup.add(crown);
      }
      body.add(headGroup);
      rig.head = headGroup;

      // shoulderpads
      if (sil.extras?.includes('shoulderpads')) {
        const padGeo = new THREE.SphereGeometry(0.22 * s, 10, 8);
        const padL = mesh(padGeo, matA);
        padL.position.set(0, 1.5 * s, (wide ? 0.55 : 0.42) * s);
        const padR = mesh(padGeo, matA);
        padR.position.set(0, 1.5 * s, -(wide ? 0.55 : 0.42) * s);
        body.add(padL, padR);
      }

      // cape
      if (sil.extras?.includes('cape')) {
        const cape = mesh(new THREE.BoxGeometry(0.08 * s, 1.15 * s, 0.55 * s), matA);
        cape.position.set(-0.3 * s, 1.05 * s, 0);
        body.add(cape);
      }

      // arms (pivot at shoulder)
      const armLen = (brute ? 0.95 : 0.75) * s;
      const armGeo = new THREE.CylinderGeometry(0.09 * s, (brute ? 0.16 : 0.1) * s, armLen, 10);
      const mkArm = (side: 1 | -1): THREE.Group => {
        const arm = new THREE.Group();
        const limb = mesh(armGeo, matS);
        limb.position.y = -armLen / 2;
        arm.add(limb);
        if (brute) {
          const fist = mesh(new THREE.SphereGeometry(0.18 * s, 10, 8), matS);
          fist.position.y = -armLen;
          arm.add(fist);
        }
        arm.position.set(0, 1.5 * s, side * ((wide ? 0.6 : 0.42) * s));
        return arm;
      };
      const armL = mkArm(1);
      const armR = mkArm(-1);
      body.add(armL, armR);
      rig.armL = armL;
      rig.armR = armR;

      // legs (hidden under robe)
      if (!robed) {
        const legLen = 0.62 * s;
        const legGeo = new THREE.CylinderGeometry(0.1 * s, 0.12 * s, legLen, 10);
        const mkLeg = (side: 1 | -1): THREE.Group => {
          const leg = new THREE.Group();
          const limb = mesh(legGeo, matS);
          limb.position.y = -legLen / 2;
          leg.add(limb);
          leg.position.set(0, 0.6 * s, side * 0.2 * s);
          return leg;
        };
        const legL = mkLeg(1);
        const legR = mkLeg(-1);
        body.add(legL, legR);
        rig.legL = legL;
        rig.legR = legR;
      }

      // weapon in right hand
      const weapon = buildWeapon(sil.weapon, s, matS, matA);
      if (weapon) {
        weapon.position.set(0.15 * s, -armLen * 0.9, 0);
        armR.add(weapon);
        rig.weapon = weapon;
      }

      if (sil.extras?.includes('quiver')) {
        const quiver = mesh(new THREE.CylinderGeometry(0.1 * s, 0.12 * s, 0.6 * s, 10), matA);
        quiver.position.set(-0.32 * s, 1.35 * s, 0.15 * s);
        quiver.rotation.x = 0.4;
        body.add(quiver);
      }

      rig.height = (robed ? 2.05 : 2.15) * s;
      return rig;
    }
  }
}

function buildWeapon(
  kind: SilhouetteSpec['weapon'],
  s: number,
  matS: THREE.MeshLambertMaterial,
  matA: THREE.MeshLambertMaterial
): THREE.Group | null {
  if (!kind || kind === 'none') return null;
  const g = new THREE.Group();
  switch (kind) {
    case 'sword': {
      const blade = mesh(new THREE.BoxGeometry(0.85 * s, 0.14 * s, 0.04 * s), lam('#d8dce8'));
      blade.position.x = 0.5 * s;
      const guard = mesh(new THREE.BoxGeometry(0.06 * s, 0.26 * s, 0.08 * s), matA);
      guard.position.x = 0.08 * s;
      g.add(blade, guard);
      break;
    }
    case 'staff': {
      const shaft = mesh(new THREE.CylinderGeometry(0.045 * s, 0.045 * s, 1.5 * s, 10), matS);
      const gem = mesh(new THREE.OctahedronGeometry(0.14 * s), matA);
      gem.position.y = 0.85 * s;
      g.add(shaft, gem);
      break;
    }
    case 'hook': {
      const chain = mesh(new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.5 * s, 10), matS);
      const hook = mesh(new THREE.TorusGeometry(0.16 * s, 0.05 * s, 8, 18, Math.PI * 1.4), lam('#a8b0b8'));
      hook.position.y = -0.35 * s;
      g.add(chain, hook);
      break;
    }
    case 'totem': {
      const head = mesh(new THREE.BoxGeometry(0.45 * s, 0.6 * s, 0.45 * s), matA);
      head.position.y = -0.2 * s;
      const haft = mesh(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.9 * s, 10), matS);
      haft.position.y = 0.3 * s;
      g.add(head, haft);
      break;
    }
    case 'rifle': {
      const barrel = mesh(new THREE.CylinderGeometry(0.045 * s, 0.05 * s, 1.3 * s, 10), matS);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.x = 0.4 * s;
      const stock = mesh(new THREE.BoxGeometry(0.35 * s, 0.12 * s, 0.08 * s), matA);
      stock.position.x = -0.15 * s;
      const scope = mesh(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.18 * s, 10), matA);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(0.25 * s, 0.1 * s, 0);
      g.add(barrel, stock, scope);
      break;
    }
    case 'cleaver': {
      const blade = mesh(new THREE.BoxGeometry(0.6 * s, 0.4 * s, 0.05 * s), lam('#b8bcc8'));
      blade.position.x = 0.35 * s;
      g.add(blade);
      break;
    }
  }
  return g;
}

/** Team/selection ring shown under units. */
export function buildSelectionRing(radiusWorld: number, color: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radiusWorld * 0.85, radiusWorld, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  return ring;
}
