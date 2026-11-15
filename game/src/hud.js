// hud.js — the DOM HUD and menus.
// One job: reflect the state store onto the page's HUD elements and the
// buy menu. The sim never touches the DOM; this module never touches the sim.

import { WEAPONS, SHOP, TEAM_ATTACK, TEAM_DEFEND, player, aliveOf } from './state.js';
import { SITES } from './map.js';

let els = null;
let lastBuyMsg = '';

/** Cache element handles once (called from main.js after DOM ready). */
export function initHud() {
  const $ = (id) => document.getElementById(id);
  els = {
    health: $('hudHealth'), healthBar: $('healthBar'), ammo: $('hudAmmo'),
    timer: $('hudTimer'), score: $('hudScore'), money: $('hudMoney'),
    team: $('hudTeam'), cross: $('crosshair'), hit: $('hitmarker'),
    banner: $('banner'), feed: $('feed'), bomb: $('bombStatus'),
    buy: $('buyMenu'), buyList: $('buyList'), buyMsg: $('buyMsg'),
    overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'),
    startBtn: $('startBtn'), plant: $('plantBar'), plantFill: $('plantFill'),
    damage: $('damageVignette'), grenades: $('hudGrenades'), round: $('hudRound'),
    help: $('helpLine'), weapon: $('hudWeapon'),
  };
}

/** Refresh every HUD field from the state (called once per rendered frame). */
export function updateHud(state) {
  if (!els) return;
  const p = player(state);
  const w = WEAPONS[p.weapon];

  els.health.textContent = Math.max(0, Math.ceil(p.hp));
  els.healthBar.style.width = `${Math.max(0, p.hp)}%`;
  els.healthBar.style.background = p.hp > 50 ? '#7ec850' : p.hp > 25 ? '#e8a33d' : '#d64545';
  els.ammo.textContent = p.reloading > 0 ? 'RELOADING' : `${p.mag} / ${p.reserve}`;
  els.weapon.textContent = w.name.toUpperCase();
  els.grenades.textContent = p.grenades > 0 ? `◉ ${p.grenades}` : '○ 0';
  els.timer.textContent = fmtTime(state.timer);
  els.timer.style.color = state.timer <= 10 && state.phase === 'round' ? '#ff5d5d' : '#fff';
  els.score.textContent = `${state.score.attack} : ${state.score.defend}`;
  els.money.textContent = `$${state.money}`;
  els.round.textContent = `ROUND ${Math.min(state.round, 9)}`;
  els.team.textContent = `VANGUARD ${aliveOf(state, TEAM_ATTACK).length}  ·  SENTINELS ${aliveOf(state, TEAM_DEFEND).length}`;

  // Crosshair spread grows with movement + bloom (readable gunplay feedback).
  const spread = 6 + p.speed2d * 2.2 + p.spreadBloom * 160;
  els.cross.style.setProperty('--sp', `${spread.toFixed(1)}px`);

  // Bomb status line.
  if (state.bomb.state === 'planted') {
    els.bomb.textContent = `SPIKE PLANTED ${state.bomb.site} — ${state.bomb.fuse.toFixed(0)}s`;
    els.bomb.style.color = '#ff5d5d';
  } else if (state.bomb.state === 'carried') {
    els.bomb.textContent = 'SPIKE: CARRYING — PLANT AT A OR B (HOLD E)';
    els.bomb.style.color = '#e8a33d';
  } else {
    els.bomb.textContent = '';
  }

  // Plant/defuse progress bar.
  const prog = p.plantT ? p.plantT / 3 : state.bomb.defuseT / 5;
  if (prog > 0 && prog < 1) {
    els.plant.style.display = 'block';
    els.plantFill.style.width = `${(prog * 100).toFixed(0)}%`;
  } else {
    els.plant.style.display = 'none';
  }

  // Banner (suppressed while the buy menu covers the middle of the screen).
  if (state.bannerT > 0 && state.banner && !(state.buyOpen && state.phase === 'buy')) {
    els.banner.textContent = state.banner;
    els.banner.style.opacity = '1';
  } else {
    els.banner.style.opacity = '0';
  }

  // Kill feed (last 4 events).
  const feed = state.events.slice(-4).map((e) => `<div>${e.text}</div>`).join('');
  if (els.feed._last !== feed) { els.feed.innerHTML = feed; els.feed._last = feed; }

  // Damage vignette fades with health.
  els.damage.style.opacity = p.hp < 100 ? String((100 - p.hp) / 160) : '0';

  // Buy menu visibility + contents.
  if (state.buyOpen && state.phase === 'buy') {
    els.buy.style.display = 'block';
    renderBuy(state);
  } else {
    els.buy.style.display = 'none';
  }

  // Overlays: menu / round end / match end.
  if (state.phase === 'menu') {
    showOverlay('FOUNDRY YARD', 'Round-based tactical FPS. Plant the spike at A or B, or eliminate the Sentinels. WASD move · Mouse aim · Click shoot · R reload · G grenade · E plant · B buy · Ctrl crouch.', true);
  } else if (state.phase === 'matchEnd') {
    const won = state.matchWinner === TEAM_ATTACK;
    showOverlay(won ? 'MATCH WON' : 'MATCH LOST',
      `Final score Vanguard ${state.score.attack} — ${state.score.defend} Sentinels. Click below to play again.`, true);
  } else {
    hideOverlay();
  }
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showOverlay(title, text, showBtn) {
  els.overlay.style.display = 'flex';
  els.overlayTitle.textContent = title;
  els.overlayText.textContent = text;
  els.startBtn.style.display = showBtn ? 'block' : 'none';
  els.startBtn.textContent = title === 'FOUNDRY YARD' ? 'DEPLOY' : 'PLAY AGAIN';
}

function hideOverlay() {
  els.overlay.style.display = 'none';
}

/** Build the buy-menu rows once per open (cheap: only while visible). */
function renderBuy(state) {
  const p = player(state);
  const rows = [];
  for (const id of SHOP) {
    const w = WEAPONS[id];
    const owned = id === 'grenade' ? p.grenades > 0 : (state.owned && state.owned[id]);
    rows.push(`<div class="buyRow" data-w="${id}">
      <span class="buyName">${w.name}</span>
      <span class="buyStat">${w.damage} dmg · ${w.mag} mag</span>
      <span class="buyPrice">${owned ? 'OWNED' : '$' + w.price}</span>
    </div>`);
  }
  const html = rows.join('') + `<div class="buyHint">Click a row or press 1–4 in the buy phase. Your credits: $${state.money}</div>
    <div class="buyMsg">${lastBuyMsg}</div>`;
  if (els.buyList._last !== html) { els.buyList.innerHTML = html; els.buyList._last = html; }
}

/** Called by main.js when a buy row is clicked. Returns the message to show. */
export function buyMessage(msg) {
  lastBuyMsg = msg || '';
}

/** Flash the hitmarker (called from main.js on a confirmed hit). */
export function flashHit(kill) {
  if (!els) return;
  els.hit.style.opacity = '1';
  els.hit.style.color = kill ? '#ff5d5d' : '#fff';
  setTimeout(() => { els.hit.style.opacity = '0'; }, 120);
}

/** Show the "press B to buy" hint line during the buy phase. */
export function setHelp(text) {
  if (els) els.help.textContent = text;
}
