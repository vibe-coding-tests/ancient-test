import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { applyAuthoredSilhouette, applyHeroLikeness, applyItemAppearances, attachHeroWeaponModel, attachHoldoutSignatureModel, attachSignatureItemWeapon, buildUnitRig, disableFrustumCulling, heroProportions, heroSilhouetteKit, modelGeometryCacheSize, mountHeroModel, recolorToPalette } from '../engine/models';
import { BESPOKE_HERO_MODEL_ASSETS, BESPOKE_HERO_MODELS, ENABLED_HERO_MODELS, ENABLED_HERO_BASES, ENABLED_HOLDOUT_MODELS, ENABLED_HOLDOUT_SIGNATURES, HERO_BASE, creepCreatureUrl, heroAssetEntry, heroBaseId, heroBaseUrl, holdoutReplacementUrl, holdoutSignatureUrl, itemWeaponGlbUrl, PHASE5_STARTER_ASSETS } from '../engine/assets';
import { ALL_HEROES } from '../data/index';

/** A stand-in mounted base: a 2×6×2 box the loader would normally fit + seat. */
function mountStandIn(heroId: string): { rig: ReturnType<typeof buildUnitRig>; model: THREE.Mesh } {
  const hero = ALL_HEROES.find((h) => h.id === heroId)!;
  const rig = buildUnitRig(hero.silhouette, hero.palette);
  const model = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshStandardMaterial());
  mountHeroModel(rig, model);
  return { rig, model };
}

describe('procedural model cache', () => {
  it('shares canonical geometry across repeated rigs', () => {
    const before = modelGeometryCacheSize();
    const a = buildUnitRig({ build: 'blob', scale: 1 }, ['#88aaff', '#446688', '#ffffff']);
    const b = buildUnitRig({ build: 'blob', scale: 1 }, ['#88aaff', '#446688', '#ffffff']);

    const firstMeshA = a.body.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const firstMeshB = b.body.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);

    expect(firstMeshA?.geometry).toBe(firstMeshB?.geometry);
    expect(modelGeometryCacheSize()).toBeGreaterThan(before);
  });

  it('builds a procedural likeness for every shipped hero without throwing (WS-A render smoke)', () => {
    for (const hero of ALL_HEROES) {
      const rig = buildUnitRig(hero.silhouette, hero.palette);
      const basePartCount = rig.body.children.length;
      expect(() => applyHeroLikeness(rig, hero.id)).not.toThrow();
      // The likeness overlay should add at least one detail mesh to the body.
      expect(rig.body.children.length, `${hero.id} likeness parts`).toBeGreaterThan(basePartCount);
    }
  });

  it('builds D2 item parts without external assets', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1 }, ['#88aaff', '#446688', '#ffffff']);
    applyItemAppearances(rig, [{ parts: ['cloak', 'halo'], tint: '#b89fff' }]);

    expect(rig.itemLayer.children.length).toBeGreaterThanOrEqual(3);
  });
});

describe('pluggable hero rig (Phase 5)', () => {
  it('resolves an asset entry only for heroes whose GLB is enabled', () => {
    // Every hero in an enabled KayKit cohort ships a retextured CC0 GLB + resolves an entry.
    for (const a of PHASE5_STARTER_ASSETS) {
      expect(ENABLED_HERO_MODELS.has(a.heroId), `${a.heroId} enabled`).toBe(true);
      expect(heroAssetEntry(a.heroId), `${a.heroId} entry`).not.toBeNull();
      expect(a.weaponUrl, `${a.heroId} weapon`).toBe(`/assets/weapons/heroes/${a.heroId}.glb`);
    }
    for (const a of BESPOKE_HERO_MODEL_ASSETS) {
      expect(ENABLED_HERO_MODELS.has(a.heroId), `${a.heroId} bespoke enabled`).toBe(true);
      expect(BESPOKE_HERO_MODELS.has(a.heroId), `${a.heroId} bespoke set`).toBe(true);
      expect(heroAssetEntry(a.heroId)?.modelUrl).toBe(`/assets/heroes/${a.heroId}.glb`);
    }
    // Creature-cohort heroes usually mount through shared bases; bespoke polish
    // entries above are the explicit exceptions.
    expect(heroAssetEntry('broodmother')).toBeNull();
    expect(heroAssetEntry('io')?.modelUrl).toBe('/assets/holdouts/replacements/io.glb');
    expect(heroAssetEntry('unknown-hero')).toBeNull();
    expect(heroAssetEntry(undefined)).toBeNull();
    // The gate matches all dedicated hero-model entries: humanoids + animated bespoke
    // creature heroes + the truly abstract holdout replacements.
    expect(ENABLED_HERO_MODELS.size).toBe(PHASE5_STARTER_ASSETS.length + BESPOKE_HERO_MODEL_ASSETS.length + ENABLED_HOLDOUT_MODELS.size);
  });

  it('mounts an authored model over the procedural body, fitting height + seating feet', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1 }, ['#888899', '#666677', '#aaaabb']);
    applyHeroLikeness(rig, 'juggernaut');
    const proceduralCount = rig.body.children.length;

    // A stand-in authored mesh, deliberately the wrong size and off the ground.
    const model = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 4), new THREE.MeshStandardMaterial());
    model.position.set(1, 5, 2);
    mountHeroModel(rig, model);

    // Procedural parts hidden (fallback-ready), authored model added + flagged.
    for (let i = 0; i < proceduralCount; i++) expect(rig.body.children[i].visible).toBe(false);
    expect(rig.body.children).toContain(model);
    expect(model.userData.heroModel).toBe(true);

    const box = new THREE.Box3().setFromObject(model);
    expect(box.max.y - box.min.y).toBeCloseTo(rig.height, 2); // fit to silhouette height
    expect(box.min.y).toBeCloseTo(0, 2); // feet seated on the ground
    expect(model.castShadow).toBe(true);
  });

  it('can mount creature models without hiding the procedural fallback', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 0.55 }, ['#b8743c', '#7a4a22', '#e8d8a0']);
    const proceduralCount = rig.body.children.length;
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());

    mountHeroModel(rig, model, [], undefined, { hideProcedural: false });

    for (let i = 0; i < proceduralCount; i++) expect(rig.body.children[i].visible).toBe(true);
    expect(rig.body.children).toContain(model);
  });

  it('resolves base-mesh sockets and hangs the weapon off the authored hand (WS-B)', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);

    // Stand-in base mesh exposing KayKit-style bone names for hand/head/back.
    const model = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshStandardMaterial());
    const hand = new THREE.Object3D(); hand.name = 'Hand_R';
    const headBone = new THREE.Object3D(); headBone.name = 'Head';
    const backBone = new THREE.Object3D(); backBone.name = 'Spine';
    model.add(torso, hand, headBone, backBone);
    mountHeroModel(rig, model);

    expect(rig.sockets?.weapon).toBe(hand);
    expect(rig.sockets?.head).toBe(headBone);
    expect(rig.sockets?.back).toBe(backBone);
    expect(rig.rightHand).toBe(hand);

    // The worn weapon should parent to the resolved hand bone (visible), not the
    // hidden procedural arm, and be counter-scaled for the model's height fit.
    applyItemAppearances(rig, [{ weapon: { kind: 'sword', color: '#d8dce8' } }]);
    expect(rig.weapon?.parent).toBe(hand);
    const k = model.scale.x;
    expect(rig.weapon?.scale.x).toBeCloseTo(1 / k, 4);
  });

  it('keeps the weapon visible when a base mesh exposes no hand bone (WS-B fallback)', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const model = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshStandardMaterial());
    mountHeroModel(rig, model);

    expect(rig.sockets?.weapon).toBeUndefined();
    expect(rig.rightHand).toBeUndefined();
    applyItemAppearances(rig, [{ weapon: { kind: 'sword', color: '#d8dce8' } }]);
    // Falls back to the item layer (on root, always visible) rather than vanishing.
    expect(rig.weapon?.parent).toBe(rig.itemLayer);
  });

  it('attaches generated hero weapon GLBs as the default and lets item weapons override them', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const model = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshStandardMaterial());
    const hand = new THREE.Object3D(); hand.name = 'Hand_R';
    model.add(torso, hand);
    mountHeroModel(rig, model);

    const heroWeapon = new THREE.Group();
    heroWeapon.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), new THREE.MeshStandardMaterial()));
    attachHeroWeaponModel(rig, heroWeapon);

    expect(rig.defaultWeapon).toBe(heroWeapon);
    expect(rig.weapon).toBe(heroWeapon);
    expect(heroWeapon.parent).toBe(hand);

    applyItemAppearances(rig, [{ weapon: { kind: 'glowing-blade', color: '#ffd86a' } }]);
    expect(rig.weapon).not.toBe(heroWeapon);
    expect(heroWeapon.parent).toBeNull();

    applyItemAppearances(rig, []);
    expect(rig.weapon).toBe(heroWeapon);
    expect(heroWeapon.parent).toBe(hand);
  });

  it('keeps the body and a hand weapon intact when two item appearances refresh at once (Bug 7)', () => {
    // Simulates using two items in the same beat: the visual layer refreshes with
    // multiple appearance specs. The hero body must survive and exactly one weapon
    // must remain hosted (no empty hand, no deleted model).
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const model = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshStandardMaterial());
    const hand = new THREE.Object3D(); hand.name = 'Hand_R';
    model.add(torso, hand);
    mountHeroModel(rig, model);
    attachHeroWeaponModel(rig, new THREE.Group());
    const bodyCount = rig.body.children.length;

    const twoWeaponItems: Parameters<typeof applyItemAppearances>[1] = [
      { weapon: { kind: 'glowing-blade', color: '#ffd86a' } },
      { weapon: { kind: 'cleaver', color: '#c8d0e0' }, parts: ['pauldrons'] }
    ];
    applyItemAppearances(rig, twoWeaponItems);
    applyItemAppearances(rig, twoWeaponItems); // a second, back-to-back refresh

    expect(rig.body.children).toContain(model);
    expect(rig.body.children.length).toBe(bodyCount); // authored body not deleted
    expect(rig.weapon, 'a weapon stays hosted').toBeTruthy();
    expect(rig.weapon?.parent, 'weapon is attached to the rig, not orphaned').toBeTruthy();

    // Unequipping everything restores the hero's default weapon rather than emptying the hand.
    applyItemAppearances(rig, []);
    expect(rig.weapon).toBe(rig.defaultWeapon);
    expect(rig.weapon?.parent).toBe(hand);
  });

  it('attaches holdout signature GLBs additively without hiding the procedural rig (A6)', () => {
    const rig = buildUnitRig({ build: 'blob', scale: 1.25 }, ['#88aaff', '#446688', '#ffffff']);
    const proceduralCount = rig.body.children.length;
    const signatureA = new THREE.Group();
    signatureA.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial()));

    attachHoldoutSignatureModel(rig, signatureA);

    expect(rig.body.children.slice(0, proceduralCount).every((child) => child.visible)).toBe(true);
    expect(signatureA.parent).toBe(rig.body);
    expect(signatureA.userData.holdoutSignatureModel).toBe(true);
    expect(signatureA.scale.x).toBeCloseTo(1.25, 4);

    const signatureB = new THREE.Group();
    signatureB.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial()));
    attachHoldoutSignatureModel(rig, signatureB);

    expect(signatureA.parent).toBeNull();
    expect(signatureB.parent).toBe(rig.body);
    expect(rig.body.children.filter((c) => c.userData.holdoutSignatureModel)).toHaveLength(1);
  });
});

// The "model pops out of view at certain camera angles" class of bug: skinned
// meshes (and meshes far from the world origin) frustum-cull against a stale
// bind-pose bounding sphere, so authored geometry vanishes mid-frame. Every mount
// path clears frustumCulled to make it robust; nothing asserted it before, which is
// exactly how that regression slipped through. These lock the contract per path.
describe('authored mounts disable frustum culling (pop-out regression)', () => {
  function allMeshes(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
    return out;
  }

  it('mountHeroModel clears culling on every authored mesh, however nested', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1 }, ['#888899', '#666677', '#aaaabb']);
    const model = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshStandardMaterial());
    const inner = new THREE.Group();
    const pauldron = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    inner.add(pauldron);
    model.add(torso, inner);
    // Default Three.js meshes start frustum-culled; the mount must flip every one.
    expect(allMeshes(model).every((m) => m.frustumCulled)).toBe(true);

    mountHeroModel(rig, model);

    const meshes = allMeshes(model);
    expect(meshes.length).toBe(2);
    expect(meshes.every((m) => m.frustumCulled === false), 'all authored meshes opt out of culling').toBe(true);
  });

  it('every weapon/signature attach path clears culling too', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1, weapon: 'sword' }, ['#888899', '#666677', '#aaaabb']);
    const base = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshStandardMaterial());
    const hand = new THREE.Object3D(); hand.name = 'Hand_R';
    base.add(torso, hand);
    mountHeroModel(rig, base);

    const makeMeshGroup = (): THREE.Group => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), new THREE.MeshStandardMaterial()));
      return g;
    };

    const heroWeapon = makeMeshGroup();
    attachHeroWeaponModel(rig, heroWeapon);
    expect(allMeshes(heroWeapon).every((m) => m.frustumCulled === false), 'hero weapon').toBe(true);

    const sigWeapon = makeMeshGroup();
    attachSignatureItemWeapon(rig, sigWeapon);
    expect(allMeshes(sigWeapon).every((m) => m.frustumCulled === false), 'signature item weapon').toBe(true);

    const holdout = makeMeshGroup();
    attachHoldoutSignatureModel(rig, holdout);
    expect(allMeshes(holdout).every((m) => m.frustumCulled === false), 'holdout signature').toBe(true);
  });

  it('disableFrustumCulling flips a whole subtree, leaving non-meshes alone', () => {
    const root = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const branch = new THREE.Group();
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const bone = new THREE.Object3D();
    branch.add(m2, bone);
    root.add(m1, branch);

    disableFrustumCulling(root);

    expect(m1.frustumCulled).toBe(false);
    expect(m2.frustumCulled).toBe(false);
  });
});

// The "recruited model is broken → invisible hero" class: a malformed/empty GLB or
// one with a degenerate bounding box would otherwise hide the procedural fallback
// and/or collapse to a NaN/Infinity scale that never renders. mountHeroModel guards
// both; these pin the guards so a future loader change can't silently re-break them.
describe('mountHeroModel keeps a broken model from erasing the hero', () => {
  it('leaves the procedural body showing when the model carries no mesh', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1 }, ['#888899', '#666677', '#aaaabb']);
    applyHeroLikeness(rig, 'juggernaut');
    const proceduralCount = rig.body.children.length;

    const empty = new THREE.Group(); // a clone of a failed/empty GLB load
    empty.add(new THREE.Object3D()); // bones only, no renderable geometry
    mountHeroModel(rig, empty);

    // Nothing hidden, nothing mounted, no authored model committed → fallback stays.
    expect(rig.body.children.length).toBe(proceduralCount);
    expect(rig.body.children.every((c) => c.visible)).toBe(true);
    expect(rig.body.children).not.toContain(empty);
    expect(rig.authoredModel).toBeUndefined();
  });

  it('falls back to a finite scale when the model has a degenerate (zero-height) bound', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1 }, ['#888899', '#666677', '#aaaabb']);
    // A flat, zero-height mesh → size.y === 0 would make rig.height / size.y blow up.
    const flat = new THREE.Mesh(new THREE.BoxGeometry(2, 0, 2), new THREE.MeshStandardMaterial());
    mountHeroModel(rig, flat);

    expect(Number.isFinite(flat.scale.x)).toBe(true);
    expect(flat.scale.x).toBe(1); // explicit fallback, not NaN/Infinity collapse
    expect(rig.body.children).toContain(flat); // it has a mesh, so it still mounts
    expect(rig.authoredModel).toBe(flat);
  });
});

describe('shared hero bases (WS-A0)', () => {
  it('assigns every shipped hero a base or an explicit procedural holdout', () => {
    for (const hero of ALL_HEROES) {
      const base = heroBaseId(hero.id);
      expect(base, `${hero.id} base`).toBeTruthy();
      // Holdouts read worse on a base mesh; they intentionally map to procedural.
      if (base !== 'procedural') expect(HERO_BASE[hero.id], `${hero.id} cohort`).toBe(base);
    }
  });

  it('resolves shared base URLs only for shipped creature hero cohorts', () => {
    expect(ENABLED_HERO_BASES.size).toBe(22);
    expect(heroBaseUrl(heroBaseId('broodmother'))).toBe('/assets/creeps/spider.glb');
    expect(heroBaseUrl(heroBaseId('doom'))).toBe('/assets/creeps/demon.glb');
    expect(heroBaseUrl(heroBaseId('winter-wyvern'))).toBe('/assets/creeps/dragonevolved.glb');
    expect(heroBaseUrl(heroBaseId('spirit-breaker'))).toBe('/assets/creeps/bull.glb');
    // Phase 3 generated families: sand-king (scorpion) + centaur-warrunner (centaur).
    expect(heroBaseUrl(heroBaseId('sand-king'))).toBe('/assets/creeps/scorpion.glb');
    expect(heroBaseUrl(heroBaseId('centaur-warrunner'))).toBe('/assets/creeps/centaur.glb');
    expect(heroBaseUrl(heroBaseId('arc-warden'))).toBe('/assets/creeps/energy.glb');
    expect(heroBaseUrl(heroBaseId('outworld-destroyer'))).toBe('/assets/creeps/energy.glb');
    expect(heroBaseUrl(heroBaseId('razor'))).toBe('/assets/creeps/energy.glb');
    expect(heroBaseUrl(heroBaseId('pudge'))).toBe('/assets/creeps/abomination.glb');
    expect(heroBaseUrl(heroBaseId('undying'))).toBe('/assets/creeps/abomination.glb');
    expect(heroBaseUrl(heroBaseId('alchemist'))).toBe('/assets/creeps/abomination.glb');
    // Phase 6 fishman family for the two aquatic heroes.
    expect(heroBaseUrl(heroBaseId('slardar'))).toBe('/assets/creeps/fishman.glb');
    expect(heroBaseUrl(heroBaseId('slark'))).toBe('/assets/creeps/fishman.glb');
    // Generated P1.3 families: animal-shaped holdouts now ride animated creature bodies.
    expect(heroBaseUrl(heroBaseId('ursa'))).toBe('/assets/creeps/bear.glb');
    expect(heroBaseUrl(heroBaseId('lone-druid'))).toBe('/assets/creeps/bear.glb');
    expect(heroBaseUrl(heroBaseId('phoenix'))).toBe('/assets/creeps/flier.glb');
    expect(heroBaseUrl(heroBaseId('batrider'))).toBe('/assets/creeps/flier.glb');
    expect(heroBaseUrl(heroBaseId('naga-siren'))).toBe('/assets/creeps/serpent.glb');
    expect(heroBaseUrl(heroBaseId('medusa'))).toBe('/assets/creeps/serpent.glb');
    expect(heroBaseUrl(heroBaseId('treant-protector'))).toBe('/assets/creeps/treant.glb');
    expect(heroBaseUrl(heroBaseId('tidehunter'))).toBe('/assets/creeps/crabenemy.glb');
    // Static bespoke body downloads were replaced with generated animated body GLBs.
    expect(heroAssetEntry('tusk')?.modelUrl).toBe('/assets/heroes/tusk.glb');
    expect(heroBaseUrl(heroBaseId('tusk'))).toBe('/assets/creeps/yeti.glb');
    expect(heroAssetEntry('hoodwink')?.modelUrl).toBe('/assets/heroes/hoodwink.glb');
    expect(heroBaseUrl(heroBaseId('hoodwink'))).toBe('/assets/creeps/fox.glb');
    expect(heroAssetEntry('gyrocopter')?.modelUrl).toBe('/assets/heroes/gyrocopter.glb');
    expect(heroBaseUrl(heroBaseId('gyrocopter'))).toBe('/assets/creeps/goblin.glb');
    expect(heroBaseUrl(heroBaseId('juggernaut'))).toBeNull(); // humanoids use per-hero GLBs.
    expect(heroBaseUrl(heroBaseId('io'))).toBeNull(); // holdouts stay procedural.
  });

  it('resolves additive signature URLs for exactly the procedural holdouts (A6)', () => {
    expect(ENABLED_HOLDOUT_SIGNATURES.size).toBe(4);
    expect(holdoutSignatureUrl('io')).toBe('/assets/holdouts/io.glb');
    expect(holdoutSignatureUrl('ancient-apparition')).toBe('/assets/holdouts/ancient-apparition.glb');
    expect(holdoutSignatureUrl('phoenix')).toBeNull(); // flier base is more faithful and animated.
    expect(holdoutSignatureUrl('juggernaut')).toBeNull(); // humanoids have full GLBs
    expect(holdoutSignatureUrl('broodmother')).toBeNull(); // creature-base heroes use shared creatures
    expect(holdoutSignatureUrl(undefined)).toBeNull();
    for (const hero of ALL_HEROES) {
      if (heroBaseId(hero.id) === 'procedural') {
        expect(holdoutSignatureUrl(hero.id), `${hero.id} signature`).toBe(`/assets/holdouts/${hero.id}.glb`);
      }
    }
  });

  it('resolves animated replacement URLs for exactly the procedural holdouts (A7)', () => {
    expect(ENABLED_HOLDOUT_MODELS.size).toBe(4);
    expect(holdoutReplacementUrl('io')).toBe('/assets/holdouts/replacements/io.glb');
    expect(holdoutReplacementUrl('ancient-apparition')).toBe('/assets/holdouts/replacements/ancient-apparition.glb');
    expect(holdoutReplacementUrl('phoenix')).toBeNull();
    expect(holdoutReplacementUrl('juggernaut')).toBeNull();
    expect(holdoutReplacementUrl('broodmother')).toBeNull();
    expect(holdoutReplacementUrl(undefined)).toBeNull();
  });

  it('ships every generated holdout signature file and tracks them in the manifest', () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'assets', 'manifest.json'), 'utf8')) as {
      groups?: Record<string, { count: number; bytes: number }>;
      files?: { path: string; group: string; type: string }[];
    };
    expect(manifest.groups?.holdout?.count).toBeGreaterThanOrEqual(ENABLED_HOLDOUT_SIGNATURES.size + ENABLED_HOLDOUT_MODELS.size);
    for (const heroId of ENABLED_HOLDOUT_SIGNATURES) {
      const url = holdoutSignatureUrl(heroId)!;
      const rel = url.replace('/assets/', '');
      const file = path.join(process.cwd(), 'public', 'assets', rel);
      expect(existsSync(file), `${heroId} signature file`).toBe(true);
      expect(statSync(file).size, `${heroId} signature size`).toBeGreaterThan(0);
      expect(
        manifest.files?.some((entry) => entry.path === rel && entry.group === 'holdout' && entry.type === 'model'),
        `${heroId} manifest entry`
      ).toBe(true);
    }
  });

  it('ships every generated holdout replacement file and tracks them in the manifest', () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'assets', 'manifest.json'), 'utf8')) as {
      files?: { path: string; group: string; type: string }[];
    };
    for (const heroId of ENABLED_HOLDOUT_MODELS) {
      const url = holdoutReplacementUrl(heroId)!;
      const rel = url.replace('/assets/', '');
      const file = path.join(process.cwd(), 'public', 'assets', rel);
      expect(existsSync(file), `${heroId} replacement file`).toBe(true);
      expect(statSync(file).size, `${heroId} replacement size`).toBeGreaterThan(0);
      expect(
        manifest.files?.some((entry) => entry.path === rel && entry.group === 'holdout' && entry.type === 'model'),
        `${heroId} replacement manifest entry`
      ).toBe(true);
    }
  });

  it('ships the generated P1.3 creature families and wires them to creeps + hero bases', () => {
    // Each generated family file exists on disk with real bytes.
    for (const family of ['flier', 'bear', 'treant', 'owlbear', 'energy', 'abomination', 'fishman']) {
      const file = path.join(process.cwd(), 'public', 'assets', 'creeps', `${family}.glb`);
      expect(existsSync(file), `${family} family file`).toBe(true);
      expect(statSync(file).size, `${family} family size`).toBeGreaterThan(0);
    }
    // Harpies and bird build fallbacks fly; wildkin get a winged owlbear body.
    expect(creepCreatureUrl('harpy-stormcrafter', 'bird')).toBe('/assets/creeps/flier.glb');
    expect(creepCreatureUrl('harpy-scout', undefined)).toBe('/assets/creeps/flier.glb');
    expect(creepCreatureUrl('unknown-bird', 'bird')).toBe('/assets/creeps/flier.glb');
    expect(creepCreatureUrl('enraged-wildkin', undefined)).toBe('/assets/creeps/owlbear.glb');
    expect(creepCreatureUrl('wildwing', undefined)).toBe('/assets/creeps/owlbear.glb');
    expect(creepCreatureUrl('wildwing-ripper', undefined)).toBe('/assets/creeps/owlbear.glb');
    expect(creepCreatureUrl('hellbear', 'brute')).toBe('/assets/creeps/bear.glb');
    expect(creepCreatureUrl('polar-furbolg', undefined)).toBe('/assets/creeps/bear.glb');
    expect(creepCreatureUrl('frostbitten-golem', undefined)).toBe('/assets/creeps/golelingevolved.glb');
    expect(creepCreatureUrl('prowler-shaman', undefined)).toBe('/assets/creeps/demon.glb');
    expect(creepCreatureUrl('prowler-shaman-minion', 'biped')).toBe('/assets/creeps/demon.glb');
    expect(creepCreatureUrl('dark-troll-summoner-minion', 'biped')).toBe('/assets/creeps/tribal.glb');
    expect(creepCreatureUrl('elder-jungle-stalker', undefined)).toBe('/assets/creeps/wolf.glb');
    // Bear/treant/flier/serpent hero bases resolve to the generated/downloaded files.
    expect(heroBaseUrl(heroBaseId('ursa'))).toBe('/assets/creeps/bear.glb');
    expect(heroBaseUrl(heroBaseId('phoenix'))).toBe('/assets/creeps/flier.glb');
    expect(heroBaseUrl(heroBaseId('naga-siren'))).toBe('/assets/creeps/serpent.glb');
    expect(heroBaseUrl(heroBaseId('treant-protector'))).toBe('/assets/creeps/treant.glb');
    // Serpent/naga-style summons use the downloaded serpent family.
    const serpent = path.join(process.cwd(), 'public', 'assets', 'creeps', 'serpent.glb');
    expect(existsSync(serpent), 'serpent family file').toBe(true);
    expect(statSync(serpent).size, 'serpent family size').toBeGreaterThan(0);
    expect(creepCreatureUrl('shadow-shaman-serpent-ward', undefined)).toBe('/assets/creeps/serpent.glb');
    expect(creepCreatureUrl('phase3-naga-image', undefined)).toBe('/assets/creeps/serpent.glb');
  });

  it('uses only animated bespoke hero GLBs', () => {
    for (const id of ['gyrocopter', 'hoodwink', 'snapfire', 'tusk']) {
      const file = path.join(process.cwd(), 'public', 'assets', 'heroes', `${id}.glb`);
      expect(existsSync(file), `${id} bespoke hero file`).toBe(true);
      expect(statSync(file).size, `${id} bespoke hero size`).toBeGreaterThan(0);
      expect(heroAssetEntry(id)?.modelUrl).toBe(`/assets/heroes/${id}.glb`);
    }
  });

  it('ships the generated P3 signature item weapons and wires them to marquee artifacts', () => {
    // Each generated signature weapon exists on disk with real bytes.
    for (const id of ['daedalus', 'radiance', 'battlefury', 'divine-rapier', 'butterfly', 'scythe-of-vyse', 'eye-of-skadi', 'monkey-king-bar', 'abyssal-blade', 'mjollnir', 'satanic', 'bloodthorn', 'desolator']) {
      const file = path.join(process.cwd(), 'public', 'assets', 'weapons', 'items', `${id}.glb`);
      expect(existsSync(file), `${id} signature weapon file`).toBe(true);
      expect(statSync(file).size, `${id} signature weapon size`).toBeGreaterThan(0);
      expect(itemWeaponGlbUrl(id)).toBe(`/assets/weapons/items/${id}.glb`);
    }
    // Items without a signature GLB keep the procedural/default hand weapon.
    expect(itemWeaponGlbUrl('tango')).toBeNull();
    expect(itemWeaponGlbUrl(undefined)).toBeNull();
  });

  it('mounts a signature item weapon over the default and restores it on removal', () => {
    const rig = buildUnitRig({ build: 'biped', scale: 1 }, ['#cccccc', '#444444', '#ffffff']);
    const defaultWeapon = new THREE.Object3D();
    attachHeroWeaponModel(rig, defaultWeapon);
    expect(rig.weapon).toBe(defaultWeapon);

    const signature = new THREE.Object3D();
    attachSignatureItemWeapon(rig, signature);
    expect(rig.weapon).toBe(signature);
    expect(signature.userData.signatureItemWeapon).toBe(true);
    expect(rig.defaultWeapon).toBe(defaultWeapon); // default preserved for restore

    // Removing the signature falls back to the hero's default weapon.
    attachSignatureItemWeapon(rig, null);
    expect(rig.weapon).toBe(defaultWeapon);

    // A null call with no signature mounted must not disturb the current weapon.
    attachSignatureItemWeapon(rig, null);
    expect(rig.weapon).toBe(defaultWeapon);
  });

  it('recolors a cloned base to a palette without sharing tint across clones', () => {
    const make = (): THREE.Mesh => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: '#202020' }) // dark → secondary role
      );
      return mesh;
    };
    const a = make();
    const b = make();
    recolorToPalette(a, ['#ff0000', '#00ff00', '#0000ff']);
    recolorToPalette(b, ['#ffaa00', '#00aaff', '#aa00ff']);

    const colorA = (a.material as THREE.MeshStandardMaterial).color.getHexString();
    const colorB = (b.material as THREE.MeshStandardMaterial).color.getHexString();
    // Dark source bucketed to the secondary slot of each distinct palette.
    expect(colorA).toBe('00ff00');
    expect(colorB).toBe('00aaff');
    expect(colorA).not.toBe(colorB); // materials cloned, not shared
  });

  it('can make recolored creature materials solid and opaque for gameplay readability', () => {
    const source = new THREE.MeshStandardMaterial({ color: '#101010', transparent: true, opacity: 0.18 });
    source.map = new THREE.Texture();
    source.normalMap = new THREE.Texture();
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source);

    recolorToPalette(model, ['#ff0000', '#00ff00', '#0000ff'], undefined, { solid: true, opaque: true });

    const next = model.material as THREE.MeshStandardMaterial;
    expect(next).not.toBe(source);
    expect(next.color.getHexString()).toBe('00ff00');
    expect(next.map).toBeNull();
    expect(next.normalMap).toBeNull();
    expect(next.transparent).toBe(false);
    expect(next.opacity).toBe(1);
  });
});

describe('within-cohort silhouette variation (WS-A / marquee)', () => {
  it('gives same-base marquee heroes distinct proportions instead of one body', () => {
    // Juggernaut and Sven are both Knight-base; they must not share a silhouette.
    const jug = heroProportions('juggernaut');
    const sven = heroProportions('sven');
    expect(sven.broad).toBeGreaterThan(jug.broad);
    expect(sven.height).toBeGreaterThan(jug.height);

    // Body classes read by cohort: a barbarian brute is broader than a slim mage,
    // and a dwarf rogue is markedly shorter than a tall caster.
    expect(heroProportions('pudge').broad).toBeGreaterThan(heroProportions('crystal-maiden').broad);
    expect(heroProportions('sniper').height).toBeLessThan(heroProportions('invoker').height);

    // Heroes with no explicit override still fall back to a finite cohort baseline.
    for (const hero of ALL_HEROES) {
      const p = heroProportions(hero.id);
      expect(Number.isFinite(p.broad) && p.broad > 0, `${hero.id} broad`).toBe(true);
      expect(Number.isFinite(p.height) && p.height > 0, `${hero.id} height`).toBe(true);
    }
  });

  it('stretches the mounted model to the hero proportions and re-seats the feet', () => {
    const { rig, model } = mountStandIn('pudge'); // broad 1.4, height 0.98
    const k = model.scale.x; // uniform fit factor from mountHeroModel
    const pudge = ALL_HEROES.find((h) => h.id === 'pudge')!;
    applyAuthoredSilhouette(rig, 'pudge', pudge.palette);

    const props = heroProportions('pudge');
    expect(model.scale.x).toBeCloseTo(k * props.broad, 4);
    expect(model.scale.z).toBeCloseTo(k * props.broad, 4);
    expect(model.scale.y).toBeCloseTo(k * props.height, 4);
    // Feet stay planted on the ground after the non-uniform stretch.
    const boxed = new THREE.Box3().setFromObject(model);
    expect(boxed.min.y).toBeCloseTo(0, 2);
  });

  it('layers innate identity gear over the authored body for marquee heroes', () => {
    // Wraith King reads as a crowned, caped skeleton king — both should appear as a
    // visible overlay group sitting over (not hidden behind) the mounted model.
    const { rig } = mountStandIn('wraith-king');
    applyAuthoredSilhouette(rig, 'wraith-king', ['#2f7d4f', '#13321f', '#9be3a0']);
    const overlay = rig.body.children.find((c) => c.userData.authoredOverlay);
    expect(overlay, 'wraith-king overlay').toBeDefined();
    expect(overlay!.children.length).toBeGreaterThan(0);
    expect(overlay!.visible).toBe(true);
  });

  it('is idempotent — a re-applied silhouette never stacks duplicate overlays', () => {
    const { rig } = mountStandIn('doom');
    const pal: [string, string, string] = ['#7a2222', '#2a0c0c', '#ffb14a'];
    applyAuthoredSilhouette(rig, 'doom', pal);
    const overlays1 = rig.body.children.filter((c) => c.userData.authoredOverlay);
    const count1 = overlays1[0]?.children.length ?? 0;
    applyAuthoredSilhouette(rig, 'doom', pal);
    const overlays2 = rig.body.children.filter((c) => c.userData.authoredOverlay);
    expect(overlays2.length).toBe(1); // single overlay group, not two
    expect(overlays2[0].children.length).toBe(count1); // same parts, not doubled
  });

  it('does not throw and adds no model scale when there is no mounted model', () => {
    const hero = ALL_HEROES.find((h) => h.id === 'invoker')!;
    const rig = buildUnitRig(hero.silhouette, hero.palette);
    expect(() => applyAuthoredSilhouette(rig, 'invoker', hero.palette)).not.toThrow();
    // Overlay still derived from features even without an authored model.
    expect(rig.body.children.some((c) => c.userData.authoredOverlay)).toBe(true);
  });

  it('never throws across the full authored humanoid cohort (render smoke)', () => {
    for (const heroId of ENABLED_HERO_MODELS) {
      const { rig } = mountStandIn(heroId);
      const hero = ALL_HEROES.find((h) => h.id === heroId)!;
      expect(() => applyAuthoredSilhouette(rig, heroId, hero.palette), heroId).not.toThrow();
    }
  });

  it('gives every hero in a shared-body cohort a distinct silhouette (no cohort-mate reads alike)', () => {
    // The four KayKit cohorts share one base mesh each, so the kit + proportions are
    // the entire differentiation. Within each cohort that combination must be unique,
    // or two heroes render as the same coloured body.
    for (const cohort of ['knight', 'mage', 'barbarian', 'rogue']) {
      const heroes = ALL_HEROES.filter((h) => heroBaseId(h.id) === cohort);
      expect(heroes.length, `${cohort} has members`).toBeGreaterThan(0);
      const seen = new Map<string, string>();
      for (const h of heroes) {
        const kit = heroSilhouetteKit(h.id);
        const p = heroProportions(h.id);
        const sig = [kit.head, kit.back, kit.shoulder, kit.jaw, kit.aura, kit.accent, p.broad.toFixed(3), p.height.toFixed(3)].join('|');
        const prior = seen.get(sig);
        expect(prior, `${cohort}: ${h.id} shares a silhouette with ${prior ?? ''} (${sig})`).toBeUndefined();
        seen.set(sig, h.id);
      }
    }
  });

  it('resolves a non-empty silhouette kit for every shared-body cohort hero', () => {
    // A bare body (all slots null) would fall back to palette-only differentiation,
    // which is exactly the sameness this system exists to remove.
    for (const cohort of ['knight', 'mage', 'barbarian', 'rogue']) {
      for (const h of ALL_HEROES.filter((x) => heroBaseId(x.id) === cohort)) {
        const kit = heroSilhouetteKit(h.id);
        const slots = [kit.head, kit.back, kit.shoulder, kit.jaw, kit.aura, kit.accent].filter(Boolean);
        expect(slots.length, `${h.id} has no silhouette kit`).toBeGreaterThan(0);
      }
    }
  });
});
