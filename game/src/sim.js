// sim.js — the fixed-step simulation.
// One job: advance the single state store by STEP seconds. No rendering,
// no DOM, no audio here — the sim only writes state and queues events.
// The render loop calls step(state, ctx) at a fixed 60 Hz from main.js.

import {
  STEP, ROUND_TIME, BUY_TIME, BOMB_FUSE, DEFUSE_TIME, PLANT_TIME,
  WIN_ROUNDS, MAX_ROUNDS, WIN_BONUS, LOSS_BONUS, PLANT_BONUS,
  WEAPONS, SHOP, TEAM_ATTACK, TEAM_DEFEND, player, aliveOf, logEvent,
} from './state.js';
import { clamp, wrapAngle, mulberry32 } from './util.js';
import { SPAWNS, siteAt, collideMove } from './map.js';
import { makeActor } from './state.js';
import { fireShot, tryReload, stepReload, equipWeapon, throwGrenade, stepGrenades, eyeY } from './combat.js';
import { stepBot, assignRoute, openingRoute, hearShot } from './bots.js';

const PLAYER_SPEED = 4.3;
const PLAYER_ACCEL = 30;
const PLAYER_RADIUS = 0.38;
const _out = [0, 0]; // reused collide output

/** Build the teams for a fresh match. Player + 2 allies vs 4 defenders. */
export function setupMatch(state) {
  state.actors = [];
  const p = makeActor(0, 'You', TEAM_ATTACK, false);
  state.actors.push(p);
  const allyNames = ['Vex', 'Mira'];
  for (let i = 0; i < 2; i++) {
    state.actors.push(makeActor(1 + i, allyNames[i], TEAM_ATTACK, true));
  }
  const foeNames = ['Rook', 'Havoc', 'Sable', 'Dusk'];
  for (let i = 0; i < 4; i++) {
    state.actors.push(makeActor(3 + i, foeNames[i], TEAM_DEFEND, true));
  }
  state.rng = mulberry32(state.seed);
}

/** Place every actor at its team's spawn with a fresh loadout. */
export function spawnRound(state) {
  const rng = state.rng;
  for (const a of state.actors) {
    const list = SPAWNS[a.team === TEAM_ATTACK ? 'attack' : 'defend'];
    const s = list[a.id % list.length];
    a.x = s.x + (rng() - 0.5) * 0.8;
    a.z = s.z + (rng() - 0.5) * 0.8;
    a.yaw = s.yaw;
    a.pitch = 0;
    a.vx = 0; a.vz = 0;
    a.hp = 100; a.alive = true;
    a.crouched = false;
    a.reloading = 0; a.cooldown = 0; a.spreadBloom = 0; a.recoilPitch = 0;
    a.kills = 0; a.deaths = 0;
    equipWeapon(a, a === state.actors[0] ? state.playerWeapon || 'pistol' : pickBotWeapon(a, rng));
    if (a.isBot) {
      const site = rng() < 0.5 ? 'A' : 'B';
      assignRoute(a, openingRoute(a, site, rng));
      a.ai.target = null; a.ai.seenT = -99; a.ai.hearingT = -99; a.ai.defusing = 0;
    }
  }
  state.bomb = { state: 'carried', site: null, x: 0, z: 0, fuse: 0, planter: null, defuser: null, defuseT: 0 };
  state.grenades.length = 0;
  state.tracers.length = 0;
  state.killsThisRound = 0;
  state.plantedByPlayer = false;
}

function pickBotWeapon(a, rng) {
  const roll = rng();
  if (a.team === TEAM_DEFEND) return roll < 0.45 ? 'rifle' : roll < 0.8 ? 'smg' : 'pistol';
  return roll < 0.4 ? 'rifle' : roll < 0.75 ? 'smg' : 'pistol';
}

/** Start the buy phase before round N. */
export function startBuyPhase(state) {
  state.phase = 'buy';
  state.timer = BUY_TIME;
  state.buyOpen = true;
  state.banner = `ROUND ${state.round} — BUY PHASE`;
  state.bannerT = 3;
  spawnRound(state);
  logEvent(state, `Round ${state.round} — buy your gear (B)`);
}

/** Begin the round proper after the buy phase. */
function startRound(state) {
  state.phase = 'round';
  state.timer = ROUND_TIME;
  state.buyOpen = false;
  state.banner = `ROUND ${state.round} — PLANT THE SPIKE`;
  state.bannerT = 3;
  logEvent(state, 'Round started — eliminate the Sentinels or plant the spike');
}

/** End the round: pay out, update the score, move on or end the match. */
function endRound(state, winner, reason) {
  state.phase = 'roundEnd';
  state.roundWinner = winner;
  state.roundReason = reason;
  state.timer = 5;
  state.score[winner]++;
  const p = player(state);
  if (winner === TEAM_ATTACK) {
    state.money += WIN_BONUS;
    if (state.plantedByPlayer) state.money += PLANT_BONUS;
  } else {
    state.money += LOSS_BONUS;
  }
  state.banner = winner === TEAM_ATTACK ? 'ROUND WON — SPIKE SECURED' : 'ROUND LOST';
  state.bannerT = 4;
  logEvent(state, `Round ${state.round}: ${winner === TEAM_ATTACK ? 'Vanguard' : 'Sentinels'} win — ${reason}`);
  if (state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
    state.phase = 'matchEnd';
    state.matchWinner = state.score.attack > state.score.defend ? TEAM_ATTACK : TEAM_DEFEND;
    state.banner = state.matchWinner === TEAM_ATTACK ? 'MATCH WON — VANGUARD TAKES THE YARD' : 'MATCH LOST — SENTINELS HOLD THE YARD';
    state.bannerT = 8;
  }
}

/** The buy menu: spend money on a weapon. Returns a message for the HUD. */
export function buyItem(state, weaponId) {
  const w = WEAPONS[weaponId];
  if (!w || state.phase !== 'buy') return 'Buy phase is over.';
  const p = player(state);
  if (weaponId === 'grenade') {
    if (state.money < w.price) return 'Not enough credits.';
    if (p.grenades >= 1) return 'Already carrying a grenade.';
    state.money -= w.price;
    p.grenades = 1;
    return 'Frag grenade bought.';
  }
  if (state.money < w.price) return 'Not enough credits.';
  if (p.weapon === weaponId) return 'Already equipped.';
  state.money -= w.price;
  state.playerWeapon = weaponId;
  state.owned[weaponId] = true;
  equipWeapon(p, weaponId);
  return `${w.name} bought.`;
}

/** One fixed step. `ctx` carries colliders + audio hooks the sim may call. */
export function step(state, ctx) {
  state.time += STEP;
  const dt = STEP;
  const p = player(state);

  // Timers that run in every phase.
  if (state.bannerT > 0) state.bannerT -= dt;
  for (let i = state.tracers.length - 1; i >= 0; i--) {
    state.tracers[i].t -= dt;
    if (state.tracers[i].t <= 0) state.tracers.splice(i, 1);
  }

  if (state.phase === 'buy') {
    state.timer -= dt;
    if (state.input.buy) state.buyOpen = !state.buyOpen;
    if (state.timer <= 0) startRound(state);
    return;
  }
  if (state.phase === 'roundEnd') {
    state.timer -= dt;
    if (state.timer <= 0 && state.phase === 'roundEnd') {
      state.round++;
      startBuyPhase(state);
    }
    return;
  }
  if (state.phase !== 'round') return;

  // --- round timer / bomb fuse ---
  state.timer -= dt;
  if (state.bomb.state === 'planted') {
    state.bomb.fuse -= dt;
    if (state.bomb.fuse <= 0) {
      state.bomb.state = 'exploded';
      endRound(state, TEAM_ATTACK, 'spike detonated');
      return;
    }
  }
  if (state.bomb.state === 'defused') {
    endRound(state, TEAM_DEFEND, 'spike defused');
    return;
  }
  if (state.timer <= 0) {
    endRound(state, state.bomb.state === 'planted' ? TEAM_ATTACK : TEAM_DEFEND,
      state.bomb.state === 'planted' ? 'time — spike stands' : 'time expired');
    return;
  }

  // --- player ---
  if (p.alive) stepPlayer(state, p, dt, ctx);
  // --- bots ---
  for (let i = 1; i < state.actors.length; i++) {
    const b = state.actors[i];
    if (!b.alive) continue;
    stepBot(state, b, dt, ctx.colliders, state.rng, (bot, yaw, pitch) => botFire(state, bot, yaw, pitch, ctx));
    stepReload(b, dt);
    if (b.cooldown > 0) b.cooldown -= dt;
  }
  stepGrenades(state, dt, ctx.colliders);

  // --- round end by elimination ---
  const atkAlive = aliveOf(state, TEAM_ATTACK).length;
  const defAlive = aliveOf(state, TEAM_DEFEND).length;
  if (defAlive === 0) {
    endRound(state, TEAM_ATTACK, 'all Sentinels eliminated');
    return;
  }
  if (atkAlive === 0) {
    if (state.bomb.state === 'planted') {
      // Attackers are dead but the spike still ticks: defenders must defuse.
      // The round ends when the fuse runs out or a defuse lands (handled above).
    } else {
      endRound(state, TEAM_DEFEND, 'all Vanguard eliminated');
      return;
    }
  }

  // --- buy menu toggle during a round (allowed, but no buying mid-round) ---
  if (state.input.buy) state.buyOpen = false;
}

/** Player movement, look, weapons, plant and grenade, one fixed step. */
function stepPlayer(state, p, dt, ctx) {
  const inp = state.input;
  const w = WEAPONS[p.weapon];

  // Look (mouse deltas accumulated by input.js; recoil recovers).
  p.yaw = wrapAngle(p.yaw - inp.lookDX * 0.0022 * state.settings.sensitivity);
  p.pitch = clamp(p.pitch - inp.lookDY * 0.0022 * state.settings.sensitivity, -1.45, 1.45);
  inp.lookDX = 0;
  inp.lookDY = 0;
  p.recoilPitch = Math.max(0, p.recoilPitch - dt * 0.09);

  // Crouch.
  p.crouched = !!inp.crouch;

  // Movement with acceleration: stopping to aim pays, sprinting never does.
  const speed = PLAYER_SPEED * (p.crouched ? 0.5 : 1);
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const wx = (-sin * inp.fwd + cos * inp.strafe) * speed;
  const wz = (-cos * inp.fwd - sin * inp.strafe) * speed;
  p.vx += clamp(wx - p.vx, -PLAYER_ACCEL * dt, PLAYER_ACCEL * dt);
  p.vz += clamp(wz - p.vz, -PLAYER_ACCEL * dt, PLAYER_ACCEL * dt);
  collideMove(p.x, p.z, 0, p.crouched ? 1.25 : 1.7, PLAYER_RADIUS, p.vx * dt, p.vz * dt, ctx.colliders, _out);
  p.x = _out[0];
  p.z = _out[1];
  p.speed2d = Math.hypot(p.vx, p.vz);
  p.moving = p.speed2d > 0.5;

  // Weapon slot switching (1-4).
  if (inp.slot > 0) {
    const order = ['pistol', 'smg', 'rifle', 'sniper'];
    const id = order[inp.slot - 1];
    if (id && p.weapon !== id && state.owned && state.owned[id]) {
      equipWeapon(p, id);
      ctx.audio && ctx.audio.click();
    }
    inp.slot = 0;
  }

  // Reload.
  if (inp.reload) tryReload(p);
  stepReload(p, dt);
  if (p.cooldown > 0) p.cooldown -= dt;

  // Spread bloom: grows per shot, decays while idle; crouching steadies it.
  p.spreadBloom = Math.max(0, p.spreadBloom - dt * 0.05);

  // Fire.
  const wantFire = w.auto ? inp.fire : inp.firePressed;
  if (wantFire && p.cooldown <= 0 && p.reloading <= 0 && p.mag > 0) {
    p.cooldown = 60 / w.rpm;
    p.mag--;
    playerFire(state, p, ctx);
  }
  inp.firePressed = false;

  // Grenade (G): throw the carried frag.
  if (inp.throwGrenade) {
    inp.throwGrenade = false;
    if (p.grenades > 0) {
      p.grenades--;
      throwGrenade(state, p, ctx.colliders);
      ctx.audio && ctx.audio.throw_();
    }
  }

  // Plant / defuse channel (hold E).
  if (inp.plant) {
    if (p.team === TEAM_ATTACK && state.bomb.state === 'carried') {
      const site = siteAt(p.x, p.z);
      if (site) {
        p.plantT = (p.plantT || 0) + dt;
        if (p.plantT >= PLANT_TIME) {
          state.bomb.state = 'planted';
          state.bomb.site = site;
          state.bomb.x = p.x;
          state.bomb.z = p.z;
          state.bomb.fuse = BOMB_FUSE;
          state.bomb.planter = p;
          state.plantedByPlayer = true;
          p.plantT = 0;
          state.banner = `SPIKE PLANTED AT ${site} — DEFEND IT`;
          state.bannerT = 4;
          logEvent(state, `Spike planted at site ${site}`);
          ctx.audio && ctx.audio.plant();
        }
      } else {
        p.plantT = 0;
      }
    } else if (p.team === TEAM_DEFEND && state.bomb.state === 'planted') {
      const d = Math.hypot(p.x - state.bomb.x, p.z - state.bomb.z);
      if (d < 1.8) {
        state.bomb.defuseT += dt;
        if (state.bomb.defuseT >= DEFUSE_TIME) {
          state.bomb.state = 'defused';
          state.bomb.defuser = p;
        }
      } else {
        state.bomb.defuseT = 0;
      }
    }
  } else {
    p.plantT = 0;
  }
}

/** The player's shot: spread from movement + bloom + recoil, then hitscan. */
function playerFire(state, p, ctx) {
  const w = WEAPONS[p.weapon];
  const moveFactor = clamp(p.speed2d / PLAYER_SPEED, 0, 1);
  const spread = w.spread + w.moveSpread * moveFactor + p.spreadBloom + (p.crouched ? -0.004 : 0);
  const yaw = p.yaw + p.recoilPitch * 0.4 + (state.rng() - 0.5) * 2 * Math.max(spread, 0.001);
  const pitch = p.pitch + p.recoilPitch + (state.rng() - 0.5) * 2 * Math.max(spread, 0.001) * 0.7;
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  p.spreadBloom = Math.min(0.05, p.spreadBloom + w.recoil * 0.35);
  p.recoilPitch = Math.min(0.12, p.recoilPitch + w.recoil);
  fireShot(state, p, dx, dy, dz, ctx.colliders, state.rng);
  hearShot(state, p.x, p.z, p);
  ctx.audio && ctx.audio.shot(p.weapon);
  ctx.onShot && ctx.onShot(p);
}

/** A bot's shot: same hitscan path, no bloom bookkeeping beyond its own. */
function botFire(state, bot, yaw, pitch, ctx) {
  const w = WEAPONS[bot.weapon];
  if (bot.mag <= 0) {
    if (bot.reserve > 0) tryReload(bot);
    return;
  }
  bot.cooldown = 60 / w.rpm;
  bot.mag--;
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  fireShot(state, bot, dx, dy, dz, ctx.colliders, state.rng);
  hearShot(state, bot.x, bot.z, bot);
  ctx.audio && ctx.audio.shot(bot.weapon, distToPlayer(state, bot));
}

/** Distance from a bot to the player, for audio falloff. */
function distToPlayer(state, bot) {
  const p = player(state);
  return Math.hypot(bot.x - p.x, bot.z - p.z);
}
