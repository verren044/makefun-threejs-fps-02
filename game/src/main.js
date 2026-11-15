// main.js — bootstrap and the game loop.
// One job: wire the modules together, run the fixed-step simulation at
// 60 Hz apart from rendering, and hand input/audio/HUD events to the sim.
// The loop is the only place that knows about requestAnimationFrame.

import { createState, STEP, player } from './state.js';
import { setupMatch, spawnRound, startBuyPhase, step, buyItem } from './sim.js';
import { equipWeapon } from './combat.js';
import { createRenderer, syncActors, syncCamera, syncEffects, makeViewmodel } from './render.js';
import { attachInput, demoDrive } from './input.js';
import { initHud, updateHud, flashHit, buyMessage, setHelp } from './hud.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(window.location.search);
const DEMO = params.get('demo'); // 'spawn' | 'combat' | 'buy' — auto-starts for screenshots
const AUTO = params.get('auto') === '1';

const state = createState();
const audio = createAudio();
const canvas = document.getElementById('game');
const view = createRenderer(canvas);
const viewmodel = makeViewmodel(view.camera);

// Debug handle: lets a test harness (or the finalist review) inspect the
// live match — actor positions, phase, timer — from the browser console.
window.__foundry = state;

initHud();
setupMatch(state);
spawnRound(state); // actors placed so the menu shows the yard behind the overlay

let lastHp = 100;
let lastKills = 0;
let accumulator = 0;
let lastT = performance.now();
let running = false;

// Sim context: colliders + the hooks the sim may call (audio, hit feedback).
const ctx = {
  colliders: view.colliders,
  audio,
};

attachInput(state, canvas, {
  onStart() {
    audio.unlock();
    startMatch();
  },
  onBuy() {
    // Buy menu toggles are handled by the sim; the HUD reads buyOpen.
  },
  onPause() {
    // Pointer lock lost: keep the sim running (single-player, no pause menu).
  },
});

// Buy-menu clicks (delegated — the rows are rebuilt by hud.js).
document.getElementById('buyList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-w]');
  if (!row) return;
  const msg = buyItem(state, row.getAttribute('data-w'));
  buyMessage(msg);
  audio.click();
});

function startMatch() {
  if (state.phase === 'menu') {
    startBuyPhase(state);
    running = true;
  } else if (state.phase === 'matchEnd') {
    // Fresh match: reset score, money and round, then buy again.
    state.score.attack = 0;
    state.score.defend = 0;
    state.round = 1;
    state.money = 800;
    state.matchWinner = null;
    state.playerWeapon = 'pistol';
    state.owned = { pistol: true };
    setupMatch(state);
    startBuyPhase(state);
    running = true;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;

  if (running) {
    if (DEMO) demoDrive(state, DEMO);
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      step(state, ctx);
      accumulator -= STEP;
      steps++;
    }
    if (steps === 5) accumulator = 0; // drop backlog after a hitch
  }

  // Hit / kill feedback from hp + kill-count deltas (the sim owns the numbers).
  const p = player(state);
  if (p.hp < lastHp) {
    flashHit(false);
    audio.hit();
  }
  lastHp = p.hp;
  if (p.kills > lastKills) {
    flashHit(true);
    audio.kill();
  }
  lastKills = p.kills;
  if (state.phase === 'roundEnd' && state.roundWinner && frame._lastBanner !== state.banner) {
    if (state.roundWinner === 'attack') audio.roundWin(); else audio.roundLose();
    frame._lastBanner = state.banner;
  }

  // Demo mode: skip the menu and jump straight into a live round.
  if (DEMO && !frame._demoStarted) {
    frame._demoStarted = true;
    running = true;
    startBuyPhase(state);
    if (DEMO === 'buy') {
      state.phase = 'buy';
      state.timer = 12;
      state.buyOpen = true;
    } else {
      state.phase = 'round';
      state.timer = 85;
      state.buyOpen = false;
      state.banner = 'ROUND 1 — PLANT THE SPIKE';
      state.bannerT = 3;
    }
    if (DEMO === 'combat') {
      // Stage a mid-round firefight: move the player to mid and arm the rifle.
      const pl = player(state);
      pl.x = -6; pl.z = 6; pl.yaw = 0.35; pl.pitch = 0;
      state.playerWeapon = 'rifle';
      state.owned = { pistol: true, rifle: true };
      equipWeapon(pl, 'rifle');
      // Hold two defenders in the lane ahead so the shot reads as combat.
      const foes = state.actors.filter((a) => a.isBot && a.team === 'defend');
      const spots = [[-7.5, -4], [-2.5, -7]];
      foes.slice(0, 2).forEach((f, i) => {
        f.x = spots[i][0]; f.z = spots[i][1];
        f.yaw = Math.atan2(-(pl.x - f.x), -(pl.z - f.z));
        f.ai.mode = 'hold';
        f.ai.holdT = 30;
      });
    }
    if (DEMO === 'spawn') {
      const pl = player(state);
      pl.x = -26; pl.z = 17; pl.yaw = -0.6;
    }
  }

  syncActors(state, view.scene);
  syncCamera(state, view.camera, viewmodel, frameDt);
  syncEffects(state, view);
  updateHud(state);
  setHelp(state.phase === 'buy' ? 'BUY PHASE — press B for the shop, click DEPLOY to start' :
    state.phase === 'round' ? 'WASD move · Click shoot · R reload · G grenade · E plant/defuse · Ctrl crouch · B shop' : '');
  view.renderer.render(view.scene, view.camera);
}

// Auto-start when asked (?auto=1) so a plain page load plays.
if (AUTO) {
  startBuyPhase(state);
  running = true;
}
requestAnimationFrame(frame);

// Resize handling (cheap, outside the hot loop).
window.addEventListener('resize', () => {
  view.camera.aspect = window.innerWidth / window.innerHeight;
  view.camera.updateProjectionMatrix();
  view.renderer.setSize(window.innerWidth, window.innerHeight);
});
