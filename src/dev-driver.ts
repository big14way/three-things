/**
 * Development only: drive the IWER emulator from the console or from browser
 * automation, so interactions can be tested and demo footage recorded without
 * a headset. Not included in production builds.
 *
 *   await tt.enter();                       // start the XR session
 *   await tt.stroke('right', points, from); // trigger-held stroke along points
 *   await tt.drag('right', from, a, b);     // grab at a, carry to b, release
 */
import * as core from '@iwsdk/core';
import * as sfx from './sound.js';

type V3 = [number, number, number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function device(): any {
  return (window as any).IWER_DEVICE;
}

function take() {
  const d = device();
  if (d) d.controlMode = 'programmatic';
  return d;
}

function input(hand: 'left' | 'right') {
  const d = take();
  return d.primaryInputMode === 'hand' ? d.hands[hand] : d.controllers[hand];
}

function aim(hand: 'left' | 'right', from: V3, to: V3) {
  const c = input(hand);
  let vx = to[0] - from[0], vy = to[1] - from[1], vz = to[2] - from[2];
  const L = Math.hypot(vx, vy, vz);
  vx /= L; vy /= L; vz /= L;
  // rotation taking -Z onto v
  let qx = vy, qy = -vx, qz = 0, qw = 1 - vz;
  if (qw < 1e-6) { qx = 0; qy = 1; qz = 0; qw = 0; }
  const n = Math.hypot(qx, qy, qz, qw);
  c.position.set(from[0], from[1], from[2]);
  c.quaternion.set(qx / n, qy / n, qz / n, qw / n);
}

function trigger(hand: 'left' | 'right', v: number) {
  const d = take();
  if (d.primaryInputMode === 'hand') d.hands[hand].updatePinchValue(v);
  else d.controllers[hand].updateButtonValue('trigger', v);
}

/** 'controller' or 'hand' */
function mode(m: 'controller' | 'hand') {
  take().primaryInputMode = m;
}

async function stroke(hand: 'left' | 'right', pts: V3[], from: V3, ms = 22) {
  aim(hand, from, pts[0]);
  await sleep(80);
  trigger(hand, 1);
  await sleep(60);
  for (const p of pts) {
    aim(hand, from, p);
    await sleep(ms);
  }
  trigger(hand, 0);
  await sleep(80);
}

async function drag(hand: 'left' | 'right', from: V3, a: V3, b: V3, steps = 30, fromEnd?: V3) {
  aim(hand, from, a);
  await sleep(200);
  trigger(hand, 1);
  await sleep(250);
  const f1 = fromEnd ?? from;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const k = t * t * (3 - 2 * t);
    const f: V3 = [from[0] + (f1[0] - from[0]) * k, from[1] + (f1[1] - from[1]) * k, from[2] + (f1[2] - from[2]) * k];
    aim(hand, f, [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    await sleep(33);
  }
  await sleep(250);
  trigger(hand, 0);
  await sleep(400);
}

async function click(hand: 'left' | 'right', from: V3, at: V3) {
  aim(hand, from, at);
  await sleep(200);
  trigger(hand, 1);
  await sleep(120);
  trigger(hand, 0);
  await sleep(250);
}

function release() {
  const d = device();
  if (d) d.controlMode = 'manual';
}

function pos(o: any): V3 {
  o.updateWorldMatrix(true, false);
  const e = o.matrixWorld.elements;
  return [e[12], e[13], e[14]];
}

/** Record the XR canvas plus the app's own sound, then save it through the dev server. */
function recorder(world: any) {
  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let running = false;
  return {
    start(fps = 30) {
      // The emulator draws the room, the app and the input models on separate
      // stacked canvases; composite them in on-screen order once per frame.
      const comp = document.createElement('canvas');
      comp.width = 1920;
      comp.height = 1080;
      const g = comp.getContext('2d')!;
      running = true;
      const draw = () => {
        if (!running) return;
        const W = window.innerWidth, H = window.innerHeight;
        const list = [...document.querySelectorAll('canvas')]
          .map((c) => ({ c, cs: getComputedStyle(c), r: c.getBoundingClientRect() }))
          // room (z 1) and app (z 2); the emulator's own control overlay (z 3) stays out
          .filter(({ c, cs, r }) => c.width > 0 && r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && (Number(cs.zIndex) || 0) < 3)
          .map(({ c, cs, r }) => ({ c, z: Number(cs.zIndex) || 0, r }))
          .sort((a, b) => a.z - b.z);
        g.fillStyle = '#000';
        g.fillRect(0, 0, comp.width, comp.height);
        for (const { c, r } of list) {
          g.drawImage(c, (r.left / W) * comp.width, (r.top / H) * comp.height, (r.width / W) * comp.width, (r.height / H) * comp.height);
        }
        requestAnimationFrame(draw);
      };
      // start from a timer so this callback runs after the renderers' callbacks each frame
      setTimeout(() => requestAnimationFrame(draw), 0);
      const stream = comp.captureStream(fps);
      const audio = sfx.audioStream();
      audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
      chunks = [];
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(500);
      return { w: comp.width, h: comp.height, mime, audio: !!audio };
    },
    async stop(name: string) {
      if (!rec) return 'not recording';
      const done = new Promise((r) => (rec!.onstop = r));
      rec.stop();
      await done;
      running = false;
      rec = null;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const res = await fetch(`/__rec?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
      return `${await res.text()} ${name}.webm ${(blob.size / 1e6).toFixed(1)} MB`;
    },
  };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function installDevDriver(world: any, app: any) {
  const panel = () => world.getSceneObject('guide-panel');
  (window as any).tt = {
    world, app, core, device, sleep, aim, trigger, mode, stroke, drag, click, release, pos,
    rec: recorder(world),
    /** turn the head smoothly to look at a world point */
    lookSmooth: async (to: V3, ms = 700) => {
      const d = take();
      const q0 = d.quaternion.clone ? d.quaternion.clone() : { x: d.quaternion.x, y: d.quaternion.y, z: d.quaternion.z, w: d.quaternion.w };
      let vx = to[0] - d.position.x, vy = to[1] - d.position.y, vz = to[2] - d.position.z;
      const L = Math.hypot(vx, vy, vz);
      vx /= L; vy /= L; vz /= L;
      const yaw = Math.atan2(-vx, -vz), pitch = Math.asin(vy);
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      const q1 = new core.Quaternion(sp * cy, sy * cp, -sp * sy, cy * cp);
      const a = new core.Quaternion(q0.x, q0.y, q0.z, q0.w);
      const tmp = new core.Quaternion();
      const t0 = performance.now();
      for (;;) {
        const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
        tmp.slerpQuaternions(a, q1, ease(k));
        d.quaternion.set(tmp.x, tmp.y, tmp.z, tmp.w);
        if (k >= 1) break;
        await sleep(10);
      }
    },
    /** move a hand or controller smoothly to a pose, optionally aiming at a point */
    moveTo: async (hand: 'left' | 'right', from: V3, to: V3, aimFrom: V3 | null, aimTo: V3 | null, ms = 600) => {
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps);
        const p: V3 = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
        if (aimFrom && aimTo) {
          aim(hand, p, [aimFrom[0] + (aimTo[0] - aimFrom[0]) * k, aimFrom[1] + (aimTo[1] - aimFrom[1]) * k, aimFrom[2] + (aimTo[2] - aimFrom[2]) * k]);
        } else input(hand).position.set(p[0], p[1], p[2]);
        await sleep(16);
      }
    },
    /**
     * Fingertip handwriting on the slate. `strokes` are lists of [x, y] in
     * slate-local metres; the finger lifts 3 cm between strokes.
     */
    write: async (strokes: [number, number][][], speed = 0.16, side: 'left' | 'right' = 'right') => {
      const d = take();
      d.primaryInputMode = 'hand';
      const h = d.hands[side];
      const S = app.slate;
      S.updateWorldMatrix(true, false);
      const n = new core.Vector3(0, 0, 1).transformDirection(S.matrixWorld);
      h.poseId = 'point';
      const vx = -n.x, vy = -n.y, vz = -n.z;
      const qx = vy, qy = -vx, qw = 1 - vz, L = Math.hypot(qx, qy, qw);
      h.quaternion.set(qx / L, qy / L, 0, qw / L);
      const tip = world.playerSpaceEntities.indexTipSpaces[side].object3D;
      const tipPos = () => {
        tip.updateWorldMatrix(true, false);
        return new core.Vector3().setFromMatrixPosition(tip.matrixWorld);
      };
      const at = (x: number, y: number, depth: number) =>
        new core.Vector3(x, y, 0.002).applyMatrix4(S.matrixWorld).addScaledVector(n, depth);
      // find where the fingertip sits relative to the hand
      const start = strokes[0][0];
      let P = at(start[0], start[1], 0.12).add(new core.Vector3(0.03, -0.03, 0.07));
      for (let k = 0; k < 5; k++) {
        h.position.set(P.x, P.y, P.z);
        await sleep(250);
        P.add(at(start[0], start[1], 0.05).sub(tipPos()));
      }
      const off = tipPos().sub(new core.Vector3(h.position.x, h.position.y, h.position.z));
      const place = (x: number, y: number, depth: number) => {
        const Q = at(x, y, depth).sub(off);
        h.position.set(Q.x, Q.y, Q.z);
      };
      let cur: [number, number, number] = [start[0], start[1], 0.05];
      // time-based, so the finger moves at `v` m/s whatever the frame rate
      const glide = async (x: number, y: number, depth: number, v: number) => {
        const from = cur;
        const dur = (Math.hypot(x - from[0], y - from[1], depth - from[2]) / v) * 1000;
        const t0 = performance.now();
        for (;;) {
          const k = dur <= 0 ? 1 : Math.min(1, (performance.now() - t0) / dur);
          place(from[0] + (x - from[0]) * k, from[1] + (y - from[1]) * k, from[2] + (depth - from[2]) * k);
          if (k >= 1) break;
          await sleep(10);
        }
        cur = [x, y, depth];
      };
      for (const st of strokes) {
        await glide(st[0][0], st[0][1], 0.03, 0.5);
        await glide(st[0][0], st[0][1], -0.004, 0.3);
        for (const [x, y] of st.slice(1)) await glide(x, y, -0.004, speed);
        await glide(cur[0], cur[1], 0.035, 0.4);
      }
      await glide(cur[0] + 0.05, cur[1] - 0.04, 0.12, 0.4);
    },
    /** point the headset (and so head-gaze) at a world point */
    look: (to: V3) => {
      const d = take();
      let vx = to[0] - d.position.x, vy = to[1] - d.position.y, vz = to[2] - d.position.z;
      const L = Math.hypot(vx, vy, vz);
      vx /= L; vy /= L; vz /= L;
      const yaw = Math.atan2(-vx, -vz), pitch = Math.asin(vy);
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(sp * cy, sy * cp, -sp * sy, cy * cp);
    },
    /** world position of a guide panel element by id */
    el: (id: string) => pos(panel().getElementById(id)),
    /** world position of the card for the n-th thing in the store with a given status */
    card: (status: string, n = 0) => {
      const ids = app.views ? [...app.views.values()].filter((v: any) => v.thing.status === status) : [];
      return ids[n] ? pos(ids[n].obj) : null;
    },
    slot: (i: number) => {
      const p = new (app.board.position.constructor)();
      const q = app.board.quaternion.clone();
      app.slotPose(i, p, q);
      return [p.x, p.y, p.z] as V3;
    },
    board: () => pos(app.board),
    jarTop: () => {
      const [x, y, z] = pos(app.jar);
      return [x, y + 0.22, z] as V3;
    },
    /** a point on the slate in slate-local metres (x right, y up) */
    slatePt: (x: number, y: number) => {
      const v = new (app.slate.position.constructor)(x, y, 0.003);
      app.slate.updateWorldMatrix(true, false);
      v.applyMatrix4(app.slate.matrixWorld);
      return [v.x, v.y, v.z] as V3;
    },
    enter: async () => {
      world.launchXR();
      for (let i = 0; i < 100 && !world.session; i++) await sleep(50);
      await sleep(800);
    },
  };
}
