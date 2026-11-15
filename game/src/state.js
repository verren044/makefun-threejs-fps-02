// state.js — the single state store.
// One job: every mutable fact of the match lives in the object createState()
// returns. Modules read and write it; nothing else keeps game state.
// The fixed-step sim advances it; rendering only reads it.

export const STEP = 1 / 60; // fixed simulation step (seconds)
export const ROUND_TIME = 100; // seconds per round
export const BUY_TIME = 12; // seconds of buy phase before a round starts
export const BOMB_FUSE = 35; // seconds from plant to detonation
export const DEFUSE_TIME = 5; // seconds a defender must channel to defuse
export const PLANT_TIME = 3; // seconds the carrier must channel to plant
export const WIN_ROUNDS = 5; // rounds to take the match
export const MAX_ROUNDS = 9;

export const TEAM_ATTACK = 'attack'; // Vanguard — plants the spike
export const TEAM_DEFEND = 'defend'; // Sentinels — holds the sites

export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_BONUS = 3250;
export const LOSS_BONUS = 1900;
export const PLANT_BONUS = 300;

/** Weapon table. damage = body damage at close range; falloff shrinks it past range. */
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, auto: false,
    damage: 34, headMult: 2.5, rpm: 320, mag: 12, reserve: 48,
    reload: 1.4, spread: 0.011, moveSpread: 0.030, recoil: 0.011,
    range: 40, falloff: 0.55, speed: 0, kick: 0.35,
  },
  smg: {
    id: 'smg', name: 'Kestrel SMG', price: 1500, auto: true,
    damage: 26, headMult: 2.2, rpm: 720, mag: 28, reserve: 112,
    reload: 1.9, spread: 0.016, moveSpread: 0.042, recoil: 0.009,
    range: 28, falloff: 0.45, speed: 0, kick: 0.30,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', price: 2700, auto: true,
    damage: 40, headMult: 2.5, rpm: 600, mag: 25, reserve: 75,
    reload: 2.4, spread: 0.008, moveSpread: 0.038, recoil: 0.016,
    range: 60, falloff: 0.7, speed: 0, kick: 0.55,
  },
  sniper: {
    id: 'sniper', name: 'Longbow DMR', price: 3100, auto: false,
    damage: 88, headMult: 3.0, rpm: 55, mag: 5, reserve: 15,
    reload: 3.0, spread: 0.001, moveSpread: 0.09, recoil: 0.055,
    range: 90, falloff: 0.9, speed: 0, kick: 1.4,
  },
  grenade: {
    id: 'grenade', name: 'Frag Grenade', price: 300, auto: false,
    damage: 95, headMult: 1, rpm: 60, mag: 1, reserve: 1,
    reload: 0, spread: 0, moveSpread: 0, recoil: 0,
    range: 0, falloff: 1, speed: 0, kick: 0,
  },
};

/** Buy-menu catalogue, in display order. */
export const SHOP = ['rifle', 'smg', 'sniper', 'grenade'];

/** Fresh actor (player or bot). Position/yaw are set by spawn(). */
export function makeActor(id, name, team, isBot) {
  return {
    id, name, team, isBot,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vz: 0, // planar velocity (m/s)
    hp: 100, alive: true,
    crouched: false, moving: false, speed2d: 0,
    weapon: 'pistol', mag: 12, reserve: 48,
    reloading: 0, // seconds left, 0 = not reloading
    cooldown: 0, // seconds until the next shot is allowed
    spreadBloom: 0, // grows while firing, decays while idle
    recoilPitch: 0, // accumulated recoil offset, recovers over time
    grenades: 0, // frag grenades carried
    plantT: 0, // plant/defuse channel progress (seconds)
    lastHitBy: null,
    kills: 0, deaths: 0,
    // bot-only AI fields (unused for the player)
    ai: isBot ? {
      mode: 'route', node: 0, route: [], holdT: 0, waitT: 0,
      target: null, lastSeenX: 0, lastSeenZ: 0, seenT: -99,
      burst: 0, burstT: 0, aimErr: 0, hearingX: 0, hearingZ: 0, hearingT: -99,
      defusing: 0, reactionT: 0,
    } : null,
    // render-side handles, filled by render.js (never read by the sim)
    mesh: null, headMesh: null, gunMesh: null,
  };
}

/** The whole match in one object. */
export function createState() {
  return {
    phase: 'menu', // menu | buy | round | roundEnd | matchEnd
    round: 1,
    score: { attack: 0, defend: 0 },
    money: START_MONEY,
    playerWeapon: 'pistol', // weapon the player keeps between rounds
    owned: { pistol: true }, // weapons the player owns (buy menu adds keys)
    timer: BUY_TIME,
    buyOpen: false,
    bomb: {
      state: 'carried', // carried | planted | exploded | defused
      site: null, x: 0, z: 0, fuse: 0, planter: null, defuser: null, defuseT: 0,
    },
    actors: [], // index 0 is always the player
    playerId: 0,
    grenades: [], // live thrown grenades
    tracers: [], // render-only shot lines, pooled
    events: [], // feed entries {text, t}
    banner: '', bannerT: 0,
    roundWinner: null, roundReason: '',
    matchWinner: null,
    time: 0, // sim clock (seconds)
    seed: 1337,
    killsThisRound: 0,
    plantedByPlayer: false,
    // transient per-frame input, filled by input.js, consumed by the sim
    input: {
      fwd: 0, strafe: 0, crouch: false, jump: false,
      fire: false, firePressed: false, reload: false,
      lookDX: 0, lookDY: 0, slot: 0, throwGrenade: false,
      plant: false, buy: false, interact: false,
    },
    settings: { sensitivity: 1.0, volume: 0.6 },
  };
}

/** The player actor (actors[0]). */
export function player(state) {
  return state.actors[0];
}

/** Living actors of a team. */
export function aliveOf(state, team) {
  const out = [];
  for (const a of state.actors) if (a.alive && a.team === team) out.push(a);
  return out;
}

/** Push a kill-feed / event line (capped). */
export function logEvent(state, text) {
  state.events.push({ text, t: state.time });
  if (state.events.length > 8) state.events.shift();
}
