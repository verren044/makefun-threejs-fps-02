// input.js — keyboard + mouse input.
// One job: translate browser events into the state's transient input object.
// Pointer lock for mouse look; the game also runs without it (demo mode).

/** Attach listeners. `state` is the store; `hooks` has onPause/onBuy callbacks. */
export function attachInput(state, canvas, hooks) {
  const inp = state.input;
  const keys = new Set();

  const updateMove = () => {
    inp.fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    inp.strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    inp.crouch = keys.has('ControlLeft') || keys.has('KeyC');
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    updateMove();
    if (e.code === 'KeyR') inp.reload = true;
    if (e.code === 'KeyG') inp.throwGrenade = true;
    if (e.code === 'KeyE') inp.plant = true;
    if (e.code === 'KeyB') { inp.buy = true; if (hooks.onBuy) hooks.onBuy(); }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 4) inp.slot = n;
    }
    if (e.code === 'Space') { e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    updateMove();
    if (e.code === 'KeyR') inp.reload = false;
    if (e.code === 'KeyE') inp.plant = false;
  });
  window.addEventListener('blur', () => { keys.clear(); updateMove(); inp.fire = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      inp.fire = true;
      inp.firePressed = true;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) inp.fire = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      inp.lookDX += e.movementX;
      inp.lookDY += e.movementY;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && hooks.onPause) hooks.onPause();
  });

  // Click-to-start overlay button (index.html's #startBtn).
  const btn = document.getElementById('startBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      if (hooks.onStart) hooks.onStart();
      canvas.requestPointerLock();
    });
  }
  return { keys };
}

/** Demo/auto mode: drive the player without pointer lock (screenshots). */
export function demoDrive(state, mode) {
  const inp = state.input;
  if (mode === 'combat') {
    inp.fwd = 0; // hold position: the staged firefight must stay in frame
    inp.lookDX = 0.15; // slow pan so the view sweeps the lane
  } else if (mode === 'spawn') {
    inp.lookDX = 0.25;
  }
}
