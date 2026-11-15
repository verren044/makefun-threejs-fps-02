// audio.js — procedural sound effects.
// One job: synthesise every sound with the Web Audio API. No audio files,
// no network, no assets. A no-op stub when the context cannot start
// (headless browsers, no user gesture yet).

/** Create the audio engine. Call unlock() from a user gesture. */
export function createAudio() {
  const eng = {
    ctx: null, master: null, enabled: true, volume: 0.6,
    unlock() {
      if (eng.ctx) { if (eng.ctx.state === 'suspended') eng.ctx.resume(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        eng.ctx = new AC();
        eng.master = eng.ctx.createGain();
        eng.master.gain.value = eng.volume;
        eng.master.connect(eng.ctx.destination);
      } catch (e) { eng.ctx = null; }
    },
    setVolume(v) {
      eng.volume = v;
      if (eng.master) eng.master.gain.value = v;
    },
    // --- primitives ---
    noise(dur, filterFreq, gain, type = 'lowpass') {
      if (!eng.ctx) return;
      const t = eng.ctx.currentTime;
      const len = Math.max(1, Math.floor(eng.ctx.sampleRate * dur));
      const buf = eng.ctx.createBuffer(1, len, eng.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = eng.ctx.createBufferSource();
      src.buffer = buf;
      const flt = eng.ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = filterFreq;
      const g = eng.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(flt); flt.connect(g); g.connect(eng.master);
      src.start(t);
    },
    tone(freq0, freq1, dur, gain, type = 'sine') {
      if (!eng.ctx) return;
      const t = eng.ctx.currentTime;
      const o = eng.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(freq1, 1), t + dur);
      const g = eng.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(eng.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    // --- game sounds ---
    // `dist` (metres from the listener) attenuates a shot: nearby cracks,
    // distant fire is a dull pop. The player's own shots pass dist 0.
    shot(weapon, dist = 0) {
      if (!eng.ctx) return;
      const att = 1 / (1 + dist * 0.045);
      if (weapon === 'sniper') { eng.noise(0.22, 900, 0.5 * att); eng.tone(160, 50, 0.2, 0.4 * att, 'sawtooth'); }
      else if (weapon === 'rifle') { eng.noise(0.12, 1800, 0.42 * att); eng.tone(220, 70, 0.1, 0.3 * att, 'square'); }
      else if (weapon === 'smg') { eng.noise(0.08, 2400, 0.32 * att); }
      else { eng.noise(0.1, 1500, 0.38 * att); eng.tone(300, 90, 0.08, 0.25 * att, 'square'); }
    },
    click() { eng.tone(1200, 900, 0.05, 0.15, 'square'); },
    reload() { eng.tone(500, 700, 0.06, 0.15, 'square'); setTimeout(() => eng.tone(700, 500, 0.06, 0.15, 'square'), 140); },
    hit() { eng.tone(1800, 1800, 0.05, 0.2, 'sine'); },
    kill() { eng.tone(900, 1400, 0.12, 0.25, 'sine'); },
    throw_() { eng.noise(0.15, 800, 0.2); },
    boom() {
      eng.noise(0.9, 300, 0.8);
      eng.tone(120, 30, 0.8, 0.7, 'sine');
    },
    plant() { eng.tone(880, 880, 0.08, 0.2, 'square'); setTimeout(() => eng.tone(880, 880, 0.08, 0.2, 'square'), 150); },
    beep() { eng.tone(1100, 1100, 0.07, 0.18, 'square'); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => eng.tone(f, f, 0.18, 0.22, 'triangle'), i * 140)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => eng.tone(f, f, 0.2, 0.22, 'triangle'), i * 160)); },
  };
  return eng;
}
