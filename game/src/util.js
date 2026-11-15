// util.js — small math helpers shared by the simulation.
// One job: pure functions, no state, no allocations in the hot paths
// (callers pass scratch objects where a result vector is needed).

/** Clamp v into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest signed angular difference from a to b (radians). */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Wrap an angle into [-PI, PI]. */
export function wrapAngle(a) {
  return a - Math.floor((a + Math.PI) / (Math.PI * 2)) * Math.PI * 2;
}

/** Deterministic mulberry32 PRNG. Seed once per match; the sim never uses Math.random. */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ray vs axis-aligned box (slab test). Box is {minX,maxX,minY,maxY,minZ,maxZ}.
 * Returns the smallest non-negative t along the ray, or -1 on a miss.
 * ox,oy,oz origin; dx,dy,dz direction (need not be normalised).
 * Writes nothing; uses only locals.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  // X slab
  if (dx === 0) {
    if (ox < b.minX || ox > b.maxX) return -1;
  } else {
    const inv = 1 / dx;
    let t0 = (b.minX - ox) * inv;
    let t1 = (b.maxX - ox) * inv;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return -1;
  }
  // Y slab
  if (dy === 0) {
    if (oy < b.minY || oy > b.maxY) return -1;
  } else {
    const inv = 1 / dy;
    let t0 = (b.minY - oy) * inv;
    let t1 = (b.maxY - oy) * inv;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return -1;
  }
  // Z slab
  if (dz === 0) {
    if (oz < b.minZ || oz > b.maxZ) return -1;
  } else {
    const inv = 1 / dz;
    let t0 = (b.minZ - oz) * inv;
    let t1 = (b.maxZ - oz) * inv;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/**
 * 2D line-of-sight on the XZ plane against wall AABBs.
 * Returns true when the segment (x0,z0)->(x1,z1) is unobstructed at eye height.
 * `walls` are map AABBs; only those tall enough to block sight count.
 */
export function losClear(x0, z0, x1, z1, walls, eyeY) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return true;
  const nx = dx / len;
  const nz = dz / len;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (w.maxY < eyeY - 0.2 || w.minY > eyeY + 0.2) continue;
    const t = rayBox(x0, eyeY, z0, nx, 0, nz, w);
    if (t >= 0 && t <= len) return false;
  }
  return true;
}

/** Distance on the XZ plane. */
export function dist2D(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Does a circle (centre cx,cz, radius r) at height band [y0,y1] overlap
 * the AABB `b`? Used by map collision so the test lives in one place.
 */
export function circleHitsBox(cx, cz, y0, y1, r, b) {
  if (b.maxY <= y0 || b.minY >= y1) return false;
  return cx + r > b.minX && cx - r < b.maxX && cz + r > b.minZ && cz - r < b.maxZ;
}
