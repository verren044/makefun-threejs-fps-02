// bots.js — bot AI.
// One job: decide what each bot does each fixed step — which route node to
// walk to, when to hold, when to shoot, when to react to sight and sound.
// Bots never touch the DOM or the renderer; they write movement + fire
// intent into their actor, and sim.js executes it like player input.

import { clamp, angleDiff, wrapAngle, dist2D, losClear } from './util.js';
import { NODES, ROUTES, siteAt } from './map.js';
import { TEAM_ATTACK, TEAM_DEFEND, DEFUSE_TIME } from './state.js';
import { eyeY } from './combat.js';
import { collideMove } from './map.js';

const BOT_SPEED = 3.6; // m/s walking (slightly slower than the player)
const BOT_ACCEL = 22;
const SIGHT_RANGE = 42;
const SIGHT_FOV = 1.9; // radians of half-FOV (~109 deg)
const HEAR_RANGE = 26; // gunshots heard within this radius pull bots in
const REACTION_MIN = 0.25; // seconds before a bot may fire after spotting
const REACTION_MAX = 0.7;

/** Give a bot a fresh route (array of node ids) toward its objective. */
export function assignRoute(bot, route) {
  bot.ai.route = route.slice();
  bot.ai.node = 0;
  bot.ai.mode = 'route';
  bot.ai.waitT = 0;
}

/** Pick an opening route for a bot based on its team and a site preference. */
export function openingRoute(bot, site, rng) {
  if (bot.team === TEAM_ATTACK) {
    if (site === 'A') return ROUTES.attackA;
    if (site === 'B') return ROUTES.attackB;
    return rng() < 0.5 ? ROUTES.attackA : ROUTES.attackB;
  }
  if (site === 'A') return ROUTES.defendA;
  if (site === 'B') return ROUTES.defendB;
  return ROUTES.defendMid;
}

/** Can `a` see `b` right now? Range, field of view and line of sight. */
export function canSee(a, b, colliders) {
  const d = dist2D(a.x, a.z, b.x, b.z);
  if (d > SIGHT_RANGE) return false;
  const want = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  if (Math.abs(angleDiff(a.yaw, want)) > SIGHT_FOV && d > 3) return false;
  return losClear(a.x, a.z, b.x, b.z, colliders, eyeY(a));
}

/** A gunshot at (x,z) is heard by bots nearby: they investigate the sound. */
export function hearShot(state, x, z, shooter) {
  for (const a of state.actors) {
    if (!a.alive || !a.isBot || a === shooter) continue;
    if (dist2D(a.x, a.z, x, z) < HEAR_RANGE) {
      a.ai.hearingX = x;
      a.ai.hearingZ = z;
      a.ai.hearingT = state.time;
      if (a.ai.mode === 'hold') a.ai.mode = 'route';
    }
  }
}

/** Step one bot for dt seconds. `fire` is a callback(bot, yaw, pitch). */
export function stepBot(state, bot, dt, colliders, rng, fire) {
  const ai = bot.ai;
  if (!ai || !bot.alive) return;

  // --- perception: nearest visible enemy ---
  let enemy = null;
  let enemyD = Infinity;
  for (const a of state.actors) {
    if (!a.alive || a.team === bot.team) continue;
    const d = dist2D(bot.x, bot.z, a.x, a.z);
    if (d < enemyD && canSee(bot, a, colliders)) { enemy = a; enemyD = d; }
  }
  if (enemy) {
    ai.target = enemy;
    ai.lastSeenX = enemy.x;
    ai.lastSeenZ = enemy.z;
    ai.seenT = state.time;
    if (ai.reactionT <= 0) ai.reactionT = REACTION_MIN + rng() * (REACTION_MAX - REACTION_MIN);
  }

  const target = ai.target;
  const targetAlive = target && target.alive && state.time - ai.seenT < 2.5;
  if (!targetAlive) ai.target = null;

  // --- bomb duties ---
  if (state.bomb.state === 'planted' && bot.team === TEAM_DEFEND && !targetAlive) {
    // Defenders converge on the planted spike and defuse it.
    const bd = dist2D(bot.x, bot.z, state.bomb.x, state.bomb.z);
    if (bd < 1.6) {
      ai.defusing += dt;
      bot.yaw = Math.atan2(-(state.bomb.x - bot.x), -(state.bomb.z - bot.z));
      if (ai.defusing >= DEFUSE_TIME) {
        state.bomb.state = 'defused';
        state.bomb.defuser = bot;
      }
      return; // stand still and channel
    }
    ai.defusing = 0;
    walkToward(state, bot, state.bomb.x, state.bomb.z, dt, colliders);
    return;
  }
  ai.defusing = 0;

  // --- combat: face the target, fire in bursts, strafe a little ---
  if (targetAlive && ai.reactionT > 0) {
    ai.reactionT -= dt;
  }
  if (targetAlive && ai.reactionT <= 0) {
    const want = Math.atan2(-(target.x - bot.x), -(target.z - bot.z));
    bot.yaw += clamp(angleDiff(bot.yaw, want), -6 * dt, 6 * dt);
    const dy = (target.crouched ? 0.9 : 1.3) - eyeY(bot);
    const dist = Math.max(enemyD, 1);
    bot.pitch = clamp(Math.atan2(dy, dist), -0.6, 0.6);
    // Fire in bursts: 3-5 shots, then a pause. Accuracy falls with range
    // and with the target's speed, so a moving player is harder to hit.
    ai.burstT -= dt;
    if (ai.burstT <= 0) {
      ai.burst = 3 + Math.floor(rng() * 3);
      ai.burstT = 0.55 + rng() * 0.5;
    }
    if (ai.burst > 0 && bot.cooldown <= 0 && bot.reloading <= 0) {
      ai.burst--;
      // Aim error: base + range + target motion, in radians.
      const err = 0.012 + dist * 0.0009 + target.speed2d * 0.006;
      const yawErr = (rng() - 0.5) * 2 * err;
      const pitchErr = (rng() - 0.5) * 2 * err * 0.7;
      fire(bot, bot.yaw + yawErr, bot.pitch + pitchErr);
    }
    // Strafe sideways while fighting so bots are not static targets.
    const strafe = Math.sin(state.time * 1.7 + bot.id * 2.1) > 0 ? 1 : -1;
    moveBot(state, bot, 0, strafe * 0.6, dt, colliders);
    return;
  }

  // --- heard a shot recently: walk to the sound ---
  if (state.time - ai.hearingT < 4 && ai.mode !== 'route') {
    walkToward(state, bot, ai.hearingX, ai.hearingZ, dt, colliders);
    if (dist2D(bot.x, bot.z, ai.hearingX, ai.hearingZ) < 1.2) ai.hearingT = -99;
    return;
  }

  // --- route / hold ---
  if (ai.mode === 'hold') {
    ai.holdT -= dt;
    // Scan: slowly sweep the view while holding a position.
    bot.yaw += Math.sin(state.time * 0.5 + bot.id) * 0.35 * dt;
    if (ai.holdT <= 0) {
      ai.mode = 'route';
      ai.node = Math.min(ai.node + 1, ai.route.length - 1);
    }
    return;
  }
  if (ai.route.length === 0) return;
  const node = NODES[ai.route[Math.min(ai.node, ai.route.length - 1)]];
  const d = dist2D(bot.x, bot.z, node.x, node.z);
  if (d < 1.0) {
    ai.node++;
    if (ai.node >= ai.route.length) {
      // Arrived: hold this spot (defenders) or pick the other site (attackers).
      if (bot.team === TEAM_DEFEND) {
        ai.mode = 'hold';
        ai.holdT = 3 + rng() * 4;
      } else {
        const atSite = siteAt(bot.x, bot.z);
        if (atSite) {
          ai.mode = 'hold';
          ai.holdT = 2 + rng() * 3;
        } else {
          assignRoute(bot, rng() < 0.5 ? ROUTES.attackA : ROUTES.attackB);
        }
      }
      return;
    }
  } else {
    walkToward(state, bot, node.x, node.z, dt, colliders);
  }
}

/** Walk toward (tx,tz) at bot speed with collision. */
function walkToward(state, bot, tx, tz, dt, colliders) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  const want = Math.atan2(-dx, -dz);
  bot.yaw += clamp(angleDiff(bot.yaw, want), -5 * dt, 5 * dt);
  moveBot(state, bot, 1, 0, dt, colliders);
}

/** Apply a bot's movement intent (fwd/strafe in [-1,1]) with acceleration. */
function moveBot(state, bot, fwd, strafe, dt, colliders) {
  const speed = BOT_SPEED * (bot.crouched ? 0.55 : 1);
  const sin = Math.sin(bot.yaw);
  const cos = Math.cos(bot.yaw);
  const wx = (-sin * fwd + cos * strafe) * speed;
  const wz = (-cos * fwd - sin * strafe) * speed;
  bot.vx += clamp(wx - bot.vx, -BOT_ACCEL * dt, BOT_ACCEL * dt);
  bot.vz += clamp(wz - bot.vz, -BOT_ACCEL * dt, BOT_ACCEL * dt);
  const out = stepPosition(bot, dt, colliders);
  bot.x = out[0];
  bot.z = out[1];
  bot.moving = Math.hypot(bot.vx, bot.vz) > 0.5;
  bot.speed2d = Math.hypot(bot.vx, bot.vz);
}

/** Integrate position with map collision (shared with the player path). */
function stepPosition(bot, dt, colliders) {
  const out = [0, 0];
  collideMove(bot.x, bot.z, 0, bot.crouched ? 1.25 : 1.7, 0.38, bot.vx * dt, bot.vz * dt, colliders, out);
  return out;
}
