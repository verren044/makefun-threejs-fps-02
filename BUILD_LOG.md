# BUILD_LOG.md — Foundry Yard (threejs-fps-02)

## v1 — first full build (2026-11-15)

- Wrote all game source fresh from the kit spec: index.html + 11 modules
  under game/src (main, state, sim, map, bots, combat, render, hud, audio,
  input, util), plus main.ts, README.md and this log.
- Copied unchanged from the kit starter only: the two three.js 0.187.0
  files under game/vendor/three/, vendor/makefun-threejs.ts, LICENSE.
- Map: Foundry Yard — warehouse site A (NW), fenced yard site B (SE),
  central silo splitting mid, 10 crates, 6 lamp posts, nav graph of 20 nodes.
- Gameplay: 3v4 (player + 2 ally bots vs 4 defender bots), rounds to 5,
  spike plant/defuse, economy + buy menu, 4 weapons + frag grenade,
  headshot multipliers, recoil/spread bloom, crouch, AABB collision,
  fixed 60 Hz sim separate from rendering.
- Demo URL params (?demo=spawn|combat|buy) added for headless screenshots.

## v2 — revision pass (2026-11-15)

- Fixed the boot flow: the menu overlay now shows first (DEPLOY starts the
  buy phase); spawnRound is exported so the menu renders over the live yard.
- Fixed state tracking: `state.owned` / `state.playerWeapon` initialised,
  buyItem records ownership, actors carry `grenades` / `plantT`.
- Imports moved to the top of combat.js and bots.js; dead code removed
  (no-op pitch clamp in sim.js, unused WEAPONS import, stray void lines).
- Gunfire now attenuates with distance (audio.shot takes a range).
- Map: floating A/B letter boards above the sites; collision uses the
  shared circleHitsBox helper from util.js.
- HUD shows the equipped weapon name; arrow keys also move.
- main.ts now prints dossier bytes + sha256 for run comparison.

## v3 — validation fixes (2026-11-15)

- bots.js: defuse branch used `targetAlive === false`, which never fired
  when no target had ever been seen (`null !== false`) — defenders now
  converge and defuse a planted spike (verified: defused in 5 s).
- map.js: collideMove clamps now leave a 1 mm gap; without it a bot sliding
  along a wall corner jittered in place (found in a 35 s diagnostic run).
- render.js: brighter bot suits with emissive lift (Sentinels were unreadable
  against shadowed walls); PCFSoftShadowMap → PCFShadowMap (removed in
  three 0.187, was a console warning).
- hud.js: banner suppressed while the buy menu is open (it bled through).
- Validation: 21 headless sim assertions pass (buy/economy, round flow,
  plant → detonation, defuse, grenade 100→48 hp); two main.ts runs are
  byte-identical (dossier sha256 fbbe6888…); console clean in headless runs.
