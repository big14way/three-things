/**
 * Small synthesized sounds (no audio files to download): pencil scratch while
 * writing, a paper flick when a card is made, a soft tap when a card snaps
 * into place, and a crumple plus glass clink when a card lands in the jar.
 */

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let scratch: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Browsers start audio suspended until a user gesture; call on any press. */
export function unlockAudio() {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume();
}

function burst(t0: number, dur: number, freq: number, q: number, vol: number) {
  const a = audio();
  if (!a || !noise) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

function tone(t0: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Pencil-on-paper noise; `speed` in metres per second of the pen tip. */
export function scratchLevel(speed: number) {
  const a = audio();
  if (!a || !noise) return;
  if (!scratch) {
    const src = a.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.9;
    const gain = a.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(a.destination);
    src.start();
    scratch = { src, gain, filter };
  }
  const v = Math.min(1, speed / 0.6);
  scratch.gain.gain.setTargetAtTime(v * 0.09, a.currentTime, 0.03);
  scratch.filter.frequency.setTargetAtTime(2400 + v * 2200, a.currentTime, 0.05);
}

export function penUp() {
  const a = audio();
  if (a && scratch) scratch.gain.gain.setTargetAtTime(0, a.currentTime, 0.04);
}

export function cardMade() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.12, 1800, 1.2, 0.25);
  tone(t + 0.05, 880, 0.25, 0.05, 'triangle');
  tone(t + 0.11, 1320, 0.3, 0.04, 'triangle');
}

export function snap() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.05, 900, 2, 0.3);
  tone(t, 220, 0.08, 0.08);
}

export function pickUp() {
  const a = audio();
  if (!a) return;
  burst(a.currentTime, 0.06, 2600, 1.5, 0.12);
}

export function crumple() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  for (let i = 0; i < 7; i++) {
    burst(t + i * 0.035 + Math.random() * 0.02, 0.05, 1500 + Math.random() * 2500, 1.5, 0.22);
  }
}

export function clink(n = 1) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.32;
  const base = 2093 * (1 + (n % 5) * 0.06);
  tone(t, base, 0.6, 0.06);
  tone(t, base * 2.76, 0.35, 0.02);
}

export function wallStick() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.08, 400, 1, 0.35);
  tone(t, 130, 0.15, 0.12);
}

export function cheer() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, 0.5, 0.05, 'triangle'));
}
