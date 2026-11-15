// map.js — the original map "FOUNDRY YARD".
// One job: the map's data (walls, crates, bomb sites, spawns, nav graph),
// its collision helpers, and building the three.js scene for it.
// Nothing here knows about rounds, weapons or AI decisions.
//
// Layout (metres, XZ plane, y up). Attack spawns south-west, defends
// north-east. Site A sits inside a warehouse in the north-west; site B
// is a fenced yard in the south-east; a central silo splits mid into
// two lanes. All names, geometry and palette are original.

import { circleHitsBox } from './util.js';

export const MAP_NAME = 'Foundry Yard';
export const MAP_BOUNDS = { minX: -32, maxX: 32, minZ: -24, maxZ: 24 };

// A wall/crate is an AABB: {x0,z0,x1,z1,h} with the base on the ground.
export const WALLS = [
  // perimeter (h 4)
  { x0: -32, z0: -24, x1: 32, z1: -23, h: 4 },
  { x0: -32, z0: 23, x1: 32, z1: 24, h: 4 },
  { x0: -32, z0: -24, x1: -31, z1: 24, h: 4 },
  { x0: 31, z0: -24, x1: 32, z1: 24, h: 4 },
  // warehouse A, north-west (door gaps on the east and south walls)
  { x0: -28, z0: -22, x1: -27, z1: -10, h: 4.5 },
  { x0: -28, z0: -22, x1: -12, z1: -21, h: 4.5 },
  { x0: -13, z0: -22, x1: -12, z1: -16, h: 4.5 },
  { x0: -13, z0: -13, x1: -12, z1: -10, h: 4.5 },
  { x0: -28, z0: -11, x1: -20, z1: -10, h: 4.5 },
  { x0: -17, z0: -11, x1: -12, z1: -10, h: 4.5 },
  // central silo (splits mid into a west and an east lane)
  { x0: -2, z0: -6, x1: 2, z1: 4, h: 5 },
  // low mid cover walls (h 2.2 — block movement, not sight over the top)
  { x0: -14, z0: -2, x1: -12, z1: 4, h: 2.2 },
  { x0: 10, z0: -4, x1: 12, z1: 2, h: 2.2 },
  { x0: -6, z0: 10, x1: -4, z1: 12, h: 2.2 },
  { x0: 4, z0: -12, x1: 6, z1: -10, h: 2.2 },
  // fenced yard B, south-east (open to the north)
  { x0: 14, z0: 8, x1: 15, z1: 18, h: 3 },
  { x0: 15, z0: 17, x1: 26, z1: 18, h: 3 },
  { x0: 25, z0: 8, x1: 26, z1: 17, h: 3 },
];

// Crates: low boxes (h ~1.2) that block movement but not sight.
export const CRATES = [
  { x: -8, z: 12, w: 2.2, d: 2.2, h: 1.2 },
  { x: 4, z: 14, w: 2.2, d: 2.2, h: 1.2 },
  { x: -18, z: 2, w: 2.2, d: 2.2, h: 1.4 },
  { x: 16, z: -2, w: 2.2, d: 2.2, h: 1.2 },
  { x: 8, z: -14, w: 2.2, d: 2.2, h: 1.2 },
  { x: -24, z: 6, w: 2.2, d: 2.2, h: 1.4 },
  { x: 22, z: -10, w: 2.2, d: 2.2, h: 1.2 },
  { x: 0, z: -14, w: 2.2, d: 2.2, h: 1.2 },
  { x: -10, z: -14, w: 2.2, d: 2.2, h: 1.4 },
  { x: 20, z: -2, w: 2.2, d: 2.2, h: 1.2 },
  { x: -20, z: -16, w: 1.6, d: 1.6, h: 1.1 }, // site A cover
  { x: 20, z: 14, w: 1.6, d: 1.6, h: 1.1 }, // site B cover
];

export const SITES = {
  A: { x: -20, z: -16, r: 4.5, label: 'A' },
  B: { x: 20, z: 14, r: 4.5, label: 'B' },
};

export const SPAWNS = {
  attack: [
    { x: -27, z: 19, yaw: -0.5 },
    { x: -25, z: 20, yaw: -0.7 },
    { x: -28, z: 16, yaw: -0.3 },
  ],
  defend: [
    { x: 27, z: -19, yaw: 2.6 },
    { x: 25, z: -20, yaw: 2.4 },
    { x: 28, z: -16, yaw: 2.8 },
  ],
};

// Nav graph nodes (open ground, never inside a wall or crate).
export const NODES = [
  { x: -27, z: 19 }, // 0 attack spawn
  { x: -16, z: 15 }, // 1
  { x: -8, z: 8 }, // 2
  { x: 2, z: 12 }, // 3
  { x: 12, z: 12 }, // 4
  { x: 19, z: 12 }, // 5 B approach
  { x: 20, z: 14 }, // 6 site B
  { x: 24, z: 2 }, // 7
  { x: 24, z: -12 }, // 8
  { x: 27, z: -19 }, // 9 defend spawn
  { x: 16, z: -12 }, // 10
  { x: 8, z: -8 }, // 11
  { x: -8, z: -8 }, // 12
  { x: -16, z: -12 }, // 13 A approach
  { x: -20, z: -16 }, // 14 site A
  { x: -6, z: 0 }, // 15 mid west
  { x: 6, z: 0 }, // 16 mid east
  { x: 14, z: 2 }, // 17 (unused spare)
  { x: -2, z: 16 }, // 18 attack mid
  { x: 2, z: -16 }, // 19 defend mid
];

// Named routes through the graph (node indices).
export const ROUTES = {
  attackA: [0, 1, 2, 15, 12, 13, 14],
  attackB: [0, 18, 3, 16, 7, 5, 6],
  attackMid: [0, 18, 3, 16, 11, 10, 9],
  defendA: [9, 10, 11, 12, 13, 14],
  defendB: [9, 8, 7, 5, 6],
  defendMid: [9, 10, 11, 16, 7, 8],
  holdA: [14, 13, 12],
  holdB: [6, 5, 7],
};

/** All colliders (walls + crates) as ray/AABB-friendly boxes. */
export function buildColliders() {
  const out = [];
  for (const w of WALLS) {
    out.push({ minX: w.x0, maxX: w.x1, minY: 0, maxY: w.h, minZ: w.z0, maxZ: w.z1 });
  }
  for (const c of CRATES) {
    out.push({
      minX: c.x - c.w / 2, maxX: c.x + c.w / 2, minY: 0, maxY: c.h,
      minZ: c.z - c.d / 2, maxZ: c.z + c.d / 2,
    });
  }
  return out;
}

/**
 * Move a circle (radius r, at height band [y0,y1]) by (dx,dz), axis separated
 * against the colliders. Returns [x, z]. No allocation. The clamp leaves a
 * 1 mm gap so the other axis never sees the wall as still overlapping
 * (without it a bot sliding along a wall corner jitters in place).
 */
export function collideMove(x, z, y0, y1, r, dx, dz, colliders, out) {
  const EPS = 0.001;
  let nx = x + dx;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!circleHitsBox(nx, z, y0, y1, r, c)) continue;
    nx = dx > 0 ? c.minX - r - EPS : c.maxX + r + EPS;
  }
  let nz = z + dz;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!circleHitsBox(nx, nz, y0, y1, r, c)) continue;
    nz = dz > 0 ? c.minZ - r - EPS : c.maxZ + r + EPS;
  }
  out[0] = nx;
  out[1] = nz;
  return out;
}

/** Which bomb site (if any) contains (x,z). */
export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return key;
  }
  return null;
}

/** Palette: dusk industrial — warm sand ground, teal-grey steel, amber lamps. */
export const PALETTE = {
  ground: 0x8a7a5c,
  groundDark: 0x6e6046,
  wall: 0x5d6b73,
  wallDark: 0x46525a,
  warehouse: 0x7a6a4f,
  silo: 0x4e6b6e,
  crate: 0x9a7b46,
  crateDark: 0x7d6335,
  accent: 0xe8a33d, // amber lamps / site markers
  siteA: 0x3fa7d6,
  siteB: 0xe05d44,
  sky: 0x2b3440,
  fog: 0x2b3440,
};

/** A double-sided letter board drawn on a canvas (no image assets). */
function makeLetterBoard(letter, color, THREE) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,14,18,0.82)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.lineWidth = 6;
  g.strokeRect(4, 4, 120, 120);
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
}

/**
 * Build the static map meshes into `scene`. Returns { colliders, siteMeshes }.
 * Uses only boxes and planes with flat colours — no textures, no assets.
 */
export function buildMap(scene, THREE) {
  const colliders = buildColliders();
  const group = new THREE.Group();
  group.name = 'map';

  const matGround = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 });
  const matGroundDark = new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 0.95 });
  const matWall = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.85 });
  const matWallDark = new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.85 });
  const matWarehouse = new THREE.MeshStandardMaterial({ color: PALETTE.warehouse, roughness: 0.9 });
  const matSilo = new THREE.MeshStandardMaterial({ color: PALETTE.silo, roughness: 0.7, metalness: 0.35 });
  const matCrate = new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.9 });
  const matCrateDark = new THREE.MeshStandardMaterial({ color: PALETTE.crateDark, roughness: 0.9 });

  // Ground: one big plane plus a darker yard strip for readability.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(64, 6), matGroundDark);
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.01, 0);
  strip.receiveShadow = true;
  group.add(strip);

  const box = (x0, z0, x1, z1, h, mat, y0 = 0) => {
    const w = x1 - x0;
    const d = z1 - z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  for (let i = 0; i < WALLS.length; i++) {
    const w = WALLS[i];
    const isWarehouse = i >= 4 && i <= 9;
    const isSilo = i === 10;
    box(w.x0, w.z0, w.x1, w.z1, w.h, isSilo ? matSilo : isWarehouse ? matWarehouse : (i % 2 ? matWallDark : matWall));
  }
  for (let i = 0; i < CRATES.length; i++) {
    const c = CRATES[i];
    box(c.x - c.w / 2, c.z - c.d / 2, c.x + c.w / 2, c.z + c.d / 2, c.h, i % 2 ? matCrateDark : matCrate);
  }

  // Site markers: flat glowing discs + a floating letter board.
  const siteMeshes = {};
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(s.r, 40),
      new THREE.MeshBasicMaterial({
        color: key === 'A' ? PALETTE.siteA : PALETTE.siteB,
        transparent: true, opacity: 0.22,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(s.x, 0.02, s.z);
    group.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.15, s.r, 40),
      new THREE.MeshBasicMaterial({
        color: key === 'A' ? PALETTE.siteA : PALETTE.siteB,
        transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    group.add(ring);
    // Floating letter board so each site reads at a glance from any lane.
    const board = makeLetterBoard(key, key === 'A' ? PALETTE.siteA : PALETTE.siteB, THREE);
    board.position.set(s.x, 4.6, s.z);
    group.add(board);
    siteMeshes[key] = disc;
  }

  // Amber lamp posts at lane junctions (visual anchors + point lights are added in render.js).
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.6, metalness: 0.5 });
  const lampHead = new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 0.9 });
  const lampSpots = [[-8, 0], [8, 0], [-16, 8], [16, -8], [0, 16], [0, -16]];
  for (const [lx, lz] of lampSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8), lampMat);
    pole.position.set(lx, 1.7, lz);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampHead);
    head.position.set(lx, 3.5, lz);
    group.add(head);
  }

  scene.add(group);
  return { colliders, siteMeshes };
}
