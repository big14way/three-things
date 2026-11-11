/**
 * Small synthesized sounds (no audio files to download): pencil scratch while
 * writing, a paper flick when a card is made, a soft tap when a card snaps
 * into place, and a crumple plus glass clink when a card lands in the jar.
 *
 * Sounds are spatial: each one plays from where it happens (the jar, the
 * wall, the paper) through an HRTF panner, and the listener follows the head.
 */
type P = { x: number; y: number; z: number } | undefined;

let ctx: AudioContext | null = null;
/** everything plays through one master bus, so it can also be tapped for recording */
let master: GainNode | null = null;
let tap: MediaStreamAudioDestinationNode | null = null;
let noise: AudioBuffer | null = null;
let scratch: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
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

/** Output node for a sound at `pos` (or straight to the speakers). */
function out(pos: P): AudioNode {
  const a = ctx!;
  if (!pos) return master!;
  const pan = a.createPanner();
  pan.panningModel = 'HRTF';
  pan.distanceModel = 'inverse';
  pan.refDistance = 0.6;
  pan.rolloffFactor = 0.8;
  if (pan.positionX) {
    pan.positionX.value = pos.x;
    pan.positionY.value = pos.y;
    pan.positionZ.value = pos.z;
  } else {
    pan.setPosition(pos.x, pos.y, pos.z);
  }
  pan.connect(master!);
  return pan;
}

const _e = new Float32Array(16);

/** Move the listener to the head; call once per frame. */
export function setListener(head: { matrixWorld: { elements: ArrayLike<number> }; updateWorldMatrix?: (a: boolean, b: boolean) => void }) {
  if (!ctx || ctx.state !== 'running') return;
  head.updateWorldMatrix?.(true, false);
  const e = head.matrixWorld.elements;
  for (let i = 0; i < 16; i++) _e[i] = e[i];
  const l = ctx.listener;
  const fx = -_e[8], fy = -_e[9], fz = -_e[10];
  const ux = _e[4], uy = _e[5], uz = _e[6];
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setValueAtTime(_e[12], t);
    l.positionY.setValueAtTime(_e[13], t);
    l.positionZ.setValueAtTime(_e[14], t);
    l.forwardX.setValueAtTime(fx, t);
    l.forwardY.setValueAtTime(fy, t);
    l.forwardZ.setValueAtTime(fz, t);
    l.upX.setValueAtTime(ux, t);
    l.upY.setValueAtTime(uy, t);
    l.upZ.setValueAtTime(uz, t);
  } else {
    l.setPosition(_e[12], _e[13], _e[14]);
    l.setOrientation(fx, fy, fz, ux, uy, uz);
  }
}

function burst(t0: number, dur: number, freq: number, q: number, vol: number, pos?: P) {
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
  src.connect(f).connect(g).connect(out(pos));
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

function tone(t0: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', pos?: P) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out(pos));
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
    src.connect(filter).connect(gain).connect(master!);
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

export function cardMade(pos?: P) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.12, 1800, 1.2, 0.25, pos);
  tone(t + 0.05, 880, 0.25, 0.05, 'triangle', pos);
  tone(t + 0.11, 1320, 0.3, 0.04, 'triangle', pos);
}

export function snap(pos?: P) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.05, 900, 2, 0.3, pos);
  tone(t, 220, 0.08, 0.08, 'sine', pos);
}

export function pickUp(pos?: P) {
  const a = audio();
  if (!a) return;
  burst(a.currentTime, 0.06, 2600, 1.5, 0.12, pos);
}

export function crumple(pos?: P) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  for (let i = 0; i < 7; i++) {
    burst(t + i * 0.035 + Math.random() * 0.02, 0.05, 1500 + Math.random() * 2500, 1.5, 0.22, pos);
  }
}

export function clink(n = 1, pos?: P) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.32;
  const base = 2093 * (1 + (n % 5) * 0.06);
  tone(t, base, 0.6, 0.06, 'sine', pos);
  tone(t, base * 2.76, 0.35, 0.02, 'sine', pos);
}

export function wallStick(pos?: P) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.08, 400, 1, 0.35, pos);
  tone(t, 130, 0.15, 0.12, 'sine', pos);
}

export function cheer(pos?: P) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, 0.5, 0.05, 'triangle', pos));
}

/** A live stream of the app's own sound (used by the dev recorder for demo footage). */
export function audioStream(): MediaStream | null {
  const a = audio();
  if (!a || !master) return null;
  if (!tap) {
    tap = a.createMediaStreamDestination();
    master.connect(tap);
  }
  return tap.stream;
}
