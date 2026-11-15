// combat.js — shooting, hit detection, grenades.
// One job: turn a trigger pull (or a bot's fire order) into damage.
// Pure sim code: it reads state + colliders, writes hp / ammo / grenades,
// and records tracers for the renderer. No three.js here except plain math.

import { rayBox } from './util.js';
import { WEAPONS, KILL_REWARD, logEvent } from './state.js';

// Reused scratch (module-level, never allocated per shot).
const _dir = { x: 0, y: 0, z: 0 };
const _eye = { x: 0, y: 0, z: 0 };

/** Eye position of an actor (standing 1.62 m, crouched 1.12 m). */
export function eyeY(a) {
  return a.crouched ? 1.12 : 1.62;
}

/** Body hitbox of an actor as an AABB. */
function bodyBox(a) {
  return {
    minX: a.x - 0.38, maxX: a.x + 0.38,
    minY: 0, maxY: a.crouched ? 1.25 : 1.7,
    minZ: a.z - 0.38, maxZ: a.z + 0.38,
  };
}

/** Head hitbox of an actor as an AABB. */
function headBox(a) {
  const top = a.crouched ? 1.25 : 1.7;
  return {
    minX: a.x - 0.2, maxX: a.x + 0.2,
    minY: top - 0.3, maxY: top,
    minZ: a.z - 0.2, maxZ: a.z + 0.2,
  };
}

/**
 * Fire one hitscan shot from `shooter` along (dx,dy,dz) (already spread-applied).
 * Returns the victim actor or null. Applies damage, kill rewards, feed and
 * a tracer entry. `rng` is the sim PRNG (kept for future spread jitter).
 */
export function fireShot(state, shooter, dx, dy, dz, colliders, rng) {
  const w = WEAPONS[shooter.weapon];
  _eye.x = shooter.x;
  _eye.y = eyeY(shooter);
  _eye.z = shooter.z;
  _dir.x = dx; _dir.y = dy; _dir.z = dz;

  // Nearest wall hit caps the shot.
  let wallT = Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(_eye.x, _eye.y, _eye.z, dx, dy, dz, colliders[i]);
    if (t >= 0 && t < wallT) wallT = t;
  }
  // Ground plane caps it too.
  if (dy < 0) {
    const tg = -_eye.y / dy;
    if (tg >= 0 && tg < wallT) wallT = tg;
  }

  // Nearest enemy hitbox (head first — a head hit wins over a body hit).
  let victim = null;
  let victimT = Infinity;
  let headshot = false;
  for (const a of state.actors) {
    if (!a.alive || a === shooter || a.team === shooter.team) continue;
    const th = rayBox(_eye.x, _eye.y, _eye.z, dx, dy, dz, headBox(a));
    if (th >= 0 && th < victimT && th < wallT) {
      victim = a; victimT = th; headshot = true;
    }
    const tb = rayBox(_eye.x, _eye.y, _eye.z, dx, dy, dz, bodyBox(a));
    if (tb >= 0 && tb < victimT && tb < wallT) {
      victim = a; victimT = tb; headshot = false;
    }
  }

  const endT = victim ? victimT : wallT;
  const endX = _eye.x + dx * (Number.isFinite(endT) ? endT : 120);
  const endY = _eye.y + dy * (Number.isFinite(endT) ? endT : 120);
  const endZ = _eye.z + dz * (Number.isFinite(endT) ? endT : 120);
  state.tracers.push({
    x0: _eye.x, y0: _eye.y, z0: _eye.z,
    x1: endX, y1: Math.max(endY, 0.02), z1: endZ, t: 0.09, hit: !!victim,
  });

  if (victim) {
    let dmg = w.damage;
    if (victimT > w.range) dmg *= w.falloff;
    if (headshot) dmg *= w.headMult;
    applyDamage(state, victim, dmg, shooter, headshot);
    return victim;
  }
  return null;
}

/** Apply damage, handle death, kill reward and feed. */
export function applyDamage(state, victim, dmg, attacker, headshot) {
  if (!victim.alive) return;
  victim.hp -= dmg;
  victim.lastHitBy = attacker;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    if (attacker) {
      attacker.kills++;
      if (attacker === state.actors[0]) {
        state.money += KILL_REWARD;
        state.killsThisRound++;
      }
    }
    logEvent(state, `${attacker ? attacker.name : '—'} ${headshot ? '☠ headshot ' : '✕ '} ${victim.name}`);
  }
}

/**
 * Start (or continue) a reload for an actor. Called from the sim each step.
 * Returns true while reloading.
 */
export function stepReload(a, dt) {
  if (a.reloading <= 0) return false;
  a.reloading -= dt;
  if (a.reloading <= 0) {
    const w = WEAPONS[a.weapon];
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
    a.reloading = 0;
    return false;
  }
  return true;
}

/** Try to begin a reload (needs reserve ammo and a non-full mag). */
export function tryReload(a) {
  const w = WEAPONS[a.weapon];
  if (a.reloading > 0 || a.mag >= w.mag || a.reserve <= 0 || w.reload <= 0) return false;
  a.reloading = w.reload;
  return true;
}

/** Equip a weapon on an actor, refilling its mag/reserve from the table. */
export function equipWeapon(a, weaponId) {
  const w = WEAPONS[weaponId];
  a.weapon = weaponId;
  a.mag = w.mag;
  a.reserve = w.reserve;
  a.reloading = 0;
  a.cooldown = 0;
  a.spreadBloom = 0;
}

/**
 * Throw a frag grenade from an actor. The grenade is a sim object with
 * position, velocity and a fuse; it bounces on walls/floor and explodes.
 */
export function throwGrenade(state, a, colliders) {
  const yaw = a.yaw;
  const pitch = a.pitch;
  const fx = -Math.sin(yaw) * Math.cos(pitch);
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * Math.cos(pitch);
  state.grenades.push({
    x: a.x + fx * 0.5, y: eyeY(a) - 0.1, z: a.z + fz * 0.5,
    vx: fx * 16 + a.vx * 0.5, vy: fy * 16 + 3.5, vz: fz * 16 + a.vz * 0.5,
    fuse: 2.2, owner: a, exploded: false,
  });
  a.mag = 0;
  a.reserve = 0;
}

/** Step all live grenades: gravity, wall/floor bounce, fuse, explosion. */
export function stepGrenades(state, dt, colliders) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    if (g.exploded) { state.grenades.splice(i, 1); continue; }
    g.vy -= 22 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.12) { g.y = 0.12; g.vy = Math.abs(g.vy) * 0.45; g.vx *= 0.7; g.vz *= 0.7; }
    for (let j = 0; j < colliders.length; j++) {
      const c = colliders[j];
      if (g.y < c.maxY && g.y > c.minY - 0.2 &&
        g.x > c.minX - 0.12 && g.x < c.maxX + 0.12 &&
        g.z > c.minZ - 0.12 && g.z < c.maxZ + 0.12) {
        // Simple bounce: push out along the smallest penetration axis.
        const px = Math.min(g.x - (c.minX - 0.12), (c.maxX + 0.12) - g.x);
        const pz = Math.min(g.z - (c.minZ - 0.12), (c.maxZ + 0.12) - g.z);
        if (px < pz) { g.vx = -g.vx * 0.5; g.x += g.vx > 0 ? 0.05 : -0.05; }
        else { g.vz = -g.vz * 0.5; g.z += g.vz > 0 ? 0.05 : -0.05; }
      }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      g.exploded = true;
      explodeGrenade(state, g);
      state.grenades.splice(i, 1);
    }
  }
}

/** Radial damage + feed for an exploding grenade. */
function explodeGrenade(state, g) {
  state.tracers.push({ x0: g.x, y0: g.y, z0: g.z, x1: g.x, y1: g.y, z1: g.z, t: 0.35, hit: false, boom: true });
  for (const a of state.actors) {
    if (!a.alive || a === g.owner) continue;
    const dx = a.x - g.x;
    const dy = (a.crouched ? 0.9 : 1.2) - g.y;
    const dz = a.z - g.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 7) {
      const dmg = WEAPONS.grenade.damage * (1 - d / 7) + 10;
      applyDamage(state, a, dmg, g.owner, false);
    }
  }
}
