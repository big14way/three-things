/**
 * Development only: drive the IWER emulator from the console or from browser
 * automation, so interactions can be tested and demo footage recorded without
 * a headset. Not included in production builds.
 *
 *   await tt.enter();                       // start the XR session
 *   await tt.stroke('right', points, from); // trigger-held stroke along points
 *   await tt.drag('right', from, a, b);     // grab at a, carry to b, release
 */
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

export function installDevDriver(world: any, app: any) {
  const panel = () => world.getSceneObject('guide-panel');
  (window as any).tt = {
    world, app, device, sleep, aim, trigger, mode, stroke, drag, click, release, pos,
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
