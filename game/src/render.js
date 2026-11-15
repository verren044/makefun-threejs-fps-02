// render.js — everything the player sees.
// One job: build the three.js scene from the map, keep one mesh per actor,
// and draw tracers / muzzle flashes / the bomb from the state each frame.
// The sim never touches three.js; this module never writes sim state
// (except reading actor positions to place meshes).

import * as THREE from 'three';
import { PALETTE, buildMap, SITES } from './map.js';
import { TEAM_ATTACK, player } from './state.js';
import { eyeY } from './combat.js';

// Pooled tracer lines: created once, reused (no per-frame allocation).
const TRACER_POOL = 48;
const tracers = [];
const _v1 = new THREE.Vector3();

/** Create the renderer, scene, camera and lights; build the map. */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 110);

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 200);
  scene.add(camera);

  // Dusk sun + sky fill.
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.6);
  sun.position.set(30, 42, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3b8, 0x4a3f2e, 1.25));
  scene.add(new THREE.AmbientLight(0x404852, 0.55)); // lifts the shadow side of walls

  // Amber point lights at the lamp posts.
  const lampSpots = [[-8, 0], [8, 0], [-16, 8], [16, -8], [0, 16], [0, -16]];
  for (const [lx, lz] of lampSpots) {
    const pt = new THREE.PointLight(PALETTE.accent, 14, 16, 1.8);
    pt.position.set(lx, 3.4, lz);
    scene.add(pt);
  }

  const { colliders } = buildMap(scene, THREE);

  // Tracer pool.
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27d, transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push(line);
  }

  // Muzzle flash: a small sprite + point light at the gun tip.
  const flash = new THREE.PointLight(0xffc266, 0, 9, 2);
  scene.add(flash);

  // Bomb mesh (hidden until planted).
  const bomb = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.26, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 }),
  );
  bombBody.castShadow = true;
  bomb.add(bombBody);
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }),
  );
  bombLight.position.set(0, 0.18, 0);
  bomb.add(bombLight);
  bomb.visible = false;
  scene.add(bomb);

  // Grenade mesh (one live grenade at a time is enough visually).
  const grenadeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.5, metalness: 0.5 }),
  );
  grenadeMesh.visible = false;
  scene.add(grenadeMesh);

  // Explosion flash sphere (scaled up on detonation).
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0 }),
  );
  scene.add(boom);

  return { renderer, scene, camera, colliders, flash, bomb, bombLight, grenadeMesh, boom };
}

/** One bot/player body mesh: capsule torso, head, gun, team-coloured. */
function makeBodyMesh(team) {
  const g = new THREE.Group();
  // Bright, high-contrast suits so bots read against shadowed walls:
  // Vanguard green / Sentinel orange-red, with a faint emissive lift.
  const suit = team === TEAM_ATTACK ? 0x53b06e : 0xd0603a;
  const suitMat = new THREE.MeshStandardMaterial({
    color: suit, roughness: 0.8, emissive: suit, emissiveIntensity: 0.28,
  });
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.75, 4, 10),
    suitMat,
  );
  torso.position.y = 0.95;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 }),
  );
  head.position.y = 1.58;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.09, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.6 }),
  );
  visor.position.set(0, 1.6, -0.16);
  g.add(visor);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.14, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.7 }),
  );
  gun.position.set(0.25, 1.15, -0.4);
  gun.castShadow = true;
  g.add(gun);
  // Team ring on the ground so the player reads friend from foe at a glance.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 24),
    new THREE.MeshBasicMaterial({ color: suit, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  return { group: g, head, gun };
}

/** Build (or reuse) a mesh for every actor. Call once per frame; cheap. */
export function syncActors(state, scene) {
  for (const a of state.actors) {
    if (!a.mesh) {
      const m = makeBodyMesh(a.team);
      a.mesh = m.group;
      a.headMesh = m.head;
      a.gunMesh = m.gun;
      scene.add(a.mesh);
    }
    a.mesh.visible = a.alive && a !== state.actors[0];
    if (!a.alive) continue;
    a.mesh.position.set(a.x, 0, a.z);
    a.mesh.rotation.y = a.yaw + Math.PI; // model faces -Z like the camera
    const crouchScale = a.crouched ? 0.72 : 1;
    a.mesh.scale.set(1, crouchScale, 1);
    // Walk bob: subtle, from the sim clock — no allocation.
    a.mesh.position.y = a.moving ? Math.abs(Math.sin(state.time * 9 + a.id)) * 0.04 : 0;
  }
}

/** First-person camera + viewmodel gun, from the player actor. */
export function syncCamera(state, camera, viewmodel, dt) {
  const p = player(state);
  camera.position.set(p.x, eyeY(p), p.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch + p.recoilPitch * 0.5;
  camera.rotation.z = 0;
  // Head bob while moving (small, tied to speed so it reads as motion).
  const bob = p.moving ? Math.sin(state.time * 10) * 0.025 * (p.speed2d / 4.3) : 0;
  camera.position.y += bob;
  // Viewmodel: gun box parented to the camera, sways with look + recoil.
  viewmodel.position.set(0.34, -0.3 + bob * 0.5, -0.55);
  viewmodel.rotation.x = p.recoilPitch * 1.6;
  viewmodel.rotation.y = 0;
  viewmodel.visible = p.alive;
}

/** Build the viewmodel gun (a simple rifle shape, parented to the camera). */
export function makeViewmodel(camera) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.35, metalness: 0.75 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.42);
  g.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.12), dark);
  mag.position.set(0, -0.13, -0.05);
  mag.rotation.x = 0.2;
  g.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x881111, emissiveIntensity: 0.6 }));
  sight.position.set(0, 0.09, -0.1);
  g.add(sight);
  camera.add(g);
  return g;
}

/** Draw tracers / muzzle flash / bomb / grenades from the state. */
export function syncEffects(state, view) {
  const { scene, camera, flash, bomb, bombLight, grenadeMesh, boom } = view;
  // Tracers.
  let ti = 0;
  for (const t of state.tracers) {
    if (ti >= TRACER_POOL) break;
    const line = tracers[ti++];
    if (t.boom) continue; // explosion handled by the boom sphere
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, t.x0, t.y0, t.z0);
    pos.setXYZ(1, t.x1, t.y1, t.z1);
    pos.needsUpdate = true;
    line.material.opacity = Math.min(1, t.t / 0.09) * 0.9;
    line.visible = true;
  }
  for (; ti < TRACER_POOL; ti++) tracers[ti].visible = false;

  // Muzzle flash light follows the viewmodel tip, fading fast.
  const p = player(state);
  if (p.alive && p.cooldown > 0.05 && p.mag >= 0) {
    _v1.set(0.34, -0.22, -1.1).applyMatrix4(camera.matrixWorld);
    flash.position.copy(_v1);
    flash.intensity = 26;
  } else {
    flash.intensity = Math.max(0, flash.intensity - 400 * 0.016);
  }

  // Bomb.
  if (state.bomb.state === 'planted') {
    bomb.visible = true;
    bomb.position.set(state.bomb.x, 0.14, state.bomb.z);
    bombLight.material.color.setHex(Math.sin(state.time * 8) > 0 ? 0xff2222 : 0x551111);
  } else {
    bomb.visible = false;
  }

  // Grenade.
  if (state.grenades.length > 0) {
    const g = state.grenades[0];
    grenadeMesh.visible = true;
    grenadeMesh.position.set(g.x, g.y, g.z);
  } else {
    grenadeMesh.visible = false;
  }

  // Explosion flash: the last tracer with boom:true marks the spot.
  const boomT = state.tracers.find((t) => t.boom);
  if (boomT) {
    boom.visible = true;
    boom.position.set(boomT.x0, boomT.y0, boomT.z0);
    const k = 1 - boomT.t / 0.35;
    boom.scale.setScalar(0.5 + k * 6);
    boom.material.opacity = 0.7 * (1 - k);
  } else {
    boom.visible = false;
  }
}
