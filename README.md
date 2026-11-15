# Foundry Yard — Tactical FPS (threejs-fps-02)

A complete round-based tactical FPS in the style Counter-Strike made famous,
built on three.js 0.187.0, running offline from static files. Single-player
against bots — no network, no build step.

## The game

You are Vanguard, attacking with two bot teammates against four Sentinel
defenders on **Foundry Yard**, an original dusk-industrial map: a warehouse
(site A) in the north-west, a fenced yard (site B) in the south-east, and a
central silo splitting mid into two lanes.

- **Rounds**: first to 5 rounds takes the match (max 9). Win by eliminating
  the enemy team, detonating the spike, or holding the sites when time runs out.
- **Objective**: carry the spike, plant it at A or B (hold E, 3 s), defend the
  35 s fuse. Defenders defuse in 5 s.
- **Money & buy menu**: $800 to start, $300 per kill, $3,250 for a round win,
  $1,900 for a loss. Buy phase (12 s) before each round — press B.
  Rifle VK-47 ($2,700), SMG Kestrel ($1,500), DMR Longbow ($3,100), frag
  grenade ($300). The P9 sidearm is free.
- **Gunplay**: hitscan with headshot bonus damage, recoil + spread bloom,
  spread that grows while moving and shrinks while crouched, acceleration-based
  movement, crouch, and AABB map collision.
- **Bots**: follow routes through the map, hold positions, patrol, react to
  sight (range / field of view / line of sight) and to the sound of gunfire,
  fire in bursts, strafe while fighting, and converge to defuse a planted spike.
- **HUD**: health, ammo, grenade count, credits, round timer, score, team
  counts, spike status, kill feed, dynamic crosshair, hitmarker, plant bar.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim (click the game to lock the pointer) |
| Click | Fire |
| R | Reload |
| G | Throw frag grenade |
| E (hold) | Plant / defuse the spike |
| Ctrl / C | Crouch |
| B | Buy menu (buy phase) |
| 1–4 | Switch weapon slot |

## Run it

Serve `game/` with any static HTTP server and open `index.html`:

```sh
python3 -m http.server 8080 --directory game
# open http://localhost:8080
```

Screenshot/demo URLs (no pointer lock needed, for testing):

- `?demo=spawn` — spawn view
- `?demo=combat` — staged mid-round firefight
- `?demo=buy` — buy menu open

## Layout

- `game/index.html` — page, HUD, import map
- `game/src/main.js` — bootstrap + fixed-step (60 Hz) loop
- `game/src/state.js` — the single state store + weapon table
- `game/src/sim.js` — the simulation (rounds, player, bomb, economy)
- `game/src/map.js` — Foundry Yard data, collision, scene build
- `game/src/bots.js` — bot AI (routes, hold, sight, sound, bursts)
- `game/src/combat.js` — hitscan, headshots, reloads, grenades
- `game/src/render.js` — three.js scene, actors, tracers, effects
- `game/src/hud.js` — DOM HUD + buy menu
- `game/src/audio.js` — procedural WebAudio sounds (no assets)
- `game/src/input.js` — keyboard / mouse / pointer lock
- `game/src/util.js` — math helpers, ray vs AABB, line of sight
- `game/vendor/three/` — three.js 0.187.0 (vendored, byte for byte)

## Build the entry

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/game, out/screenshots and out/dossier.json
```

MIT licensed — see LICENSE.
