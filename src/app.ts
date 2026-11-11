/**
 * Three Things: write today's things with your finger, pick three, pin them
 * on your wall, drop them in the jar when they're done.
 *
 * One system owns the ritual. Paper objects are plain meshes with canvas
 * textures; interaction goes through IWSDK's pointer events (ray, poke, mouse)
 * and DistanceGrabbable, so the same code serves hands, controllers and the
 * desktop emulator.
 */
import {
  CircleGeometry,
  createSystem,
  CylinderGeometry,
  DistanceGrabbable,
  DoubleSide,
  Entity,
  Grabbed,
  GrabSystem,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MovementMode,
  Object3D,
  PlaneGeometry,
  PokeInteractable,
  Quaternion,
  RayInteractable,
  TorusGeometry,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import {
  BOARD_M,
  CARD_M,
  drawBoard,
  drawCard,
  drawJarLabel,
  drawSlateBackground,
  loadFont,
  PAPER_COLORS,
  INK,
  SLATE_PX,
  SLOT_CENTERS,
  cropInk,
  inkBounds,
  texture,
} from './paper.js';
import { arcPath, Coach, Ghost, squigglePath, type GhostPath } from './coach.js';
import * as sfx from './sound.js';
import { store, type Thing } from './state.js';
import { Board, Card, Jar, Slate } from './tags.js';

const SLATE_M = { w: 0.48, h: 0.3 };
const RAIL_SCALE = 0.8;
const QUICK_PICKS = ['Move my body', 'One hour of deep work', 'Call someone I love', 'Tidy one corner', 'Read 10 pages', 'Drink more water'];

// reusable temporaries (never allocate per frame)
const _p = new Vector3();
const _p2 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _n = new Vector3();
const _up = new Vector3(0, 1, 0);
const _pen = new Vector3();
const _tip = new Vector3();
const _px = { x: 0, y: 0, z: 0 };
/** pen ids for fingertips (pointer ids are small positive numbers) */
const FINGER_IDS = [-101, -102];
const _ro = new Vector3();
const _rd = new Vector3();
const _hit = new Vector3();
const ONE = new Vector3(1, 1, 1);
const X_AXIS = new Vector3(1, 0, 0);

interface Tween {
  p0: Vector3;
  p1: Vector3;
  q0: Quaternion;
  q1: Quaternion;
  s0: number;
  s1: number;
  t: number;
  dur: number;
  lift: number;
  done?: () => void;
}

type Lesson = 'warmup' | 'write' | 'pick' | 'wall' | 'done';

const STEP: Record<Lesson, string> = { warmup: '★', write: '1', pick: '2', wall: '3', done: '4' };

interface CardView {
  thing: Thing;
  entity: Entity;
  obj: Object3D;
  tween?: Tween;
  grabbed: boolean;
  /** where the held card would go if released now */
  target: number; // -1 none, 0..2 slot, 3 jar
}

function setWorldPose(o: Object3D, p: Vector3, q: Quaternion, s = 1) {
  const parent = o.parent;
  _m2.compose(p, q, _s.set(s, s, s));
  if (parent) {
    parent.updateWorldMatrix(true, false);
    _m.copy(parent.matrixWorld).invert();
    _m2.premultiply(_m);
  }
  _m2.decompose(o.position, o.quaternion, o.scale);
}

function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class ThreeThingsSystem extends createSystem({
  cards: { required: [Card] },
  grabbedCards: { required: [Card, Grabbed] },
  grabbedBoard: { required: [Board, Grabbed] },
  planes: { required: [XRPlane] },
}) {
  // layout frame: eye position and facing at session start
  private home = new Matrix4();
  private homeQ = new Quaternion();
  private laidOut = false;
  private settleFrames = 0;

  private slate!: Group;
  private inkCanvas!: HTMLCanvasElement;
  private inkTex!: ReturnType<typeof texture>;
  private slateBgCanvas!: HTMLCanvasElement;
  private slateBgTex!: ReturnType<typeof texture>;
  private board!: Group;
  private boardEntity!: Entity;
  private boardCanvas!: HTMLCanvasElement;
  private boardTex!: ReturnType<typeof texture>;
  private jar!: Group;
  private jarLabelCanvas!: HTMLCanvasElement;
  private jarLabelTex!: ReturnType<typeof texture>;
  private balls: Mesh[] = [];
  private ballGeo!: IcosahedronGeometry;
  private views = new Map<string, CardView>();
  private cardGeo!: PlaneGeometry;
  private cardBackMat = new Map<number, MeshStandardMaterial>();
  private colorCursor = 0;

  private pens = new Map<number, { x: number; y: number; mx: number; my: number; t: number; wx: number; wy: number; wz: number }>();
  private boardAnchor: XRAnchor | null = null;
  private anchorRequest = false;
  private boardOnWall = false;
  private ui: UIKitMLAsset | undefined;
  private boardHighlight = -1;
  /** The slate folds down to lap height while sorting so rays reach the board. */
  private slateDown = false;
  private slateEntity!: Entity;
  private inkMesh!: Mesh;
  /** latest eye-gaze ray in world space, when the device reports one */
  private eyeO = new Vector3();
  private eyeD = new Vector3();
  private eyeValid = false;
  private slateTween: { p0: Vector3; p1: Vector3; q0: Quaternion; q1: Quaternion; t: number } | null = null;
  private boardScale = store.state.boardScale ?? 1;
  private jarRim!: MeshStandardMaterial;
  private wallGhost!: Mesh;
  private wallTarget: { p: Vector3; q: Quaternion } | null = null;
  private picksOpen = false;
  private coach!: Coach;
  private ghost!: Ghost;
  /** the next thing to learn or do; drives the coach ribbon and the ghost hand */
  private lesson: Lesson = 'write';
  private lastAction = performance.now();
  private flashUntil = 0;
  private ghostPath: GhostPath | null = null;
  private ghostKind: 'pinch' | 'point' = 'pinch';
  private tableTries = 0;
  private jarOnTable = false;

  init(): void {
    void loadFont().then(() => {
      this.redrawSlateBg();
      this.redrawBoard();
      this.redrawJarLabel();
      for (const v of this.views.values()) this.redrawCard(v);
    });
    this.buildSlate();
    this.buildBoard();
    this.buildJar();
    this.cardGeo = new PlaneGeometry(CARD_M.w, CARD_M.h);
    store.ensureWarmup(2);
    for (const t of store.things) {
      if (t.status !== 'done') this.spawnCard(t, false);
    }
    const add = (o: Object3D) => {
      this.world.createTransformEntity(o);
    };
    this.coach = new Coach(add);
    this.ghost = new Ghost(add);
    this.lesson = this.computeLesson();
    // the slate starts folded away when there is nothing to write yet
    this.slateDown = this.lesson === 'warmup' || [0, 1, 2].some((i) => store.slotOf(i));
    this.redrawSlateBg();
    this.setSlateTouch(!this.slateDown);
    this.layoutDefault();
    this.bindUI();

    this.queries.grabbedCards.subscribe('qualify', (e) => {
      const v = this.viewOf(e);
      if (!v) return;
      v.grabbed = true;
      v.tween = undefined;
      this.touch();
      this.setSlateDown(true);
      sfx.pickUp(this.jarMouth());
    });
    this.queries.grabbedCards.subscribe('disqualify', (e) => {
      const v = this.viewOf(e);
      if (!v) return;
      v.grabbed = false;
      this.onCardDropped(v);
    });
    this.queries.grabbedBoard.subscribe('qualify', () => {
      this.touch();
      this.setSlateDown(true);
      this.releaseAnchor();
      this.boardScale = 1;
      this.board.scale.setScalar(1);
      sfx.pickUp();
      this.flash('Point at a wall and let go', 'It sticks flush to the wall and stays there.');
    });
    this.queries.grabbedBoard.subscribe('disqualify', () => this.onBoardDropped());

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        if (s === VisibilityState.NonImmersive) {
          this.laidOut = false;
          this.boardAnchor = null;
          this.jarOnTable = false;
          this.tableTries = 0;
          this.layoutDefault();
        } else {
          this.settleFrames = 0;
        }
        // system menu or headset off: end any stroke in progress and silence the pencil
        if (s !== VisibilityState.Visible) {
          this.pens.clear();
          sfx.penUp();
        }
      }),
      this.world.onXRFrame((frame) => this.onFrame(frame)),
    );
    this.refreshCoach();
  }

  // ------------------------------------------------------------- building

  private buildSlate() {
    this.slate = new Group();
    this.slateBgCanvas = document.createElement('canvas');
    this.slateBgTex = texture(this.slateBgCanvas);
    const bg = new Mesh(
      new PlaneGeometry(SLATE_M.w, SLATE_M.h),
      new MeshStandardMaterial({ map: this.slateBgTex, alphaTest: 0.5, roughness: 0.95 }),
    );
    this.inkCanvas = document.createElement('canvas');
    this.inkCanvas.width = SLATE_PX.w;
    this.inkCanvas.height = SLATE_PX.h;
    this.inkTex = texture(this.inkCanvas);
    const ink = new Mesh(
      new PlaneGeometry(SLATE_M.w, SLATE_M.h),
      new MeshBasicMaterial({ map: this.inkTex, transparent: true, depthWrite: false }),
    );
    ink.position.z = 0.002;
    this.slate.add(bg, ink);
    this.redrawSlateBg();
    const e = this.world.createTransformEntity(this.slate);
    e.addComponent(Slate);
    // Rays (pinch or trigger) and the mouse write through pointer events.
    // Fingertips are tracked directly in updateFingers(), because a finger with
    // no haptics pushes through the paper and a touch pointer would let go.
    e.addComponent(RayInteractable);
    this.slateEntity = e;
    this.inkMesh = ink;

    const onDown = (ev: any) => {
      if (ev.pointerType === 'touch') return;
      sfx.unlockAudio();
      this.touch();
      if (this.slateDown) {
        this.setSlateDown(false);
        this.flash('Write another thing', 'Then tap Make card.');
        return;
      }
      if (ev.point && this.penDown(ev.pointerId, ev.point)) {
        // keep the stroke while the ray sweeps past the edge
        try {
          ev.target?.setPointerCapture?.(ev.pointerId);
        } catch {
          // capture is optional
        }
      }
    };
    const onMove = (ev: any) => {
      if (ev.point) this.penMove(ev.pointerId, ev.point);
    };
    const onUp = (ev: any) => this.penUp(ev.pointerId);
    ink.addEventListener('pointerdown' as any, onDown);
    ink.addEventListener('pointermove' as any, onMove);
    ink.addEventListener('pointerup' as any, onUp);
    ink.addEventListener('pointerleave' as any, onUp);
    ink.addEventListener('pointercancel' as any, onUp);
  }

  /** World point on (or near) the paper to canvas pixels; null when off the sheet. */
  private toPx(p: Vector3, out: { x: number; y: number; z: number }): boolean {
    const l = this.inkMesh.worldToLocal(_pen.copy(p));
    const u = l.x / SLATE_M.w + 0.5, v = l.y / SLATE_M.h + 0.5;
    out.x = u * SLATE_PX.w;
    out.y = (1 - v) * SLATE_PX.h;
    out.z = l.z;
    return u >= -0.03 && u <= 1.03 && v >= -0.03 && v <= 1.03;
  }

  private penDown(id: number, p: Vector3): boolean {
    if (!this.toPx(p, _px)) return false;
    this.pens.set(id, { x: _px.x, y: _px.y, mx: _px.x, my: _px.y, t: performance.now(), wx: p.x, wy: p.y, wz: p.z });
    this.dot(_px.x, _px.y);
    return true;
  }

  private penMove(id: number, p: Vector3) {
    const pen = this.pens.get(id);
    if (!pen || !this.toPx(p, _px)) return;
    const x = _px.x, y = _px.y;
    if (Math.hypot(x - pen.x, y - pen.y) < 2) return;
    const g = this.inkCanvas.getContext('2d')!;
    const mx = (pen.x + x) / 2, my = (pen.y + y) / 2;
    g.strokeStyle = INK;
    g.lineWidth = 15;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pen.mx, pen.my);
    g.quadraticCurveTo(pen.x, pen.y, mx, my);
    g.stroke();
    this.inkTex.needsUpdate = true;
    const now = performance.now();
    const dist = Math.hypot(p.x - pen.wx, p.y - pen.wy, p.z - pen.wz);
    sfx.scratchLevel(dist / Math.max(0.008, (now - pen.t) / 1000));
    pen.x = x; pen.y = y; pen.mx = mx; pen.my = my; pen.t = now;
    pen.wx = p.x; pen.wy = p.y; pen.wz = p.z;
  }

  private penUp(id: number) {
    if (this.pens.delete(id) && this.pens.size === 0) {
      sfx.penUp();
      this.lastAction = performance.now();
    }
  }

  /**
   * Fingertip writing. Touching the paper starts a stroke; the stroke keeps
   * going while the fingertip stays on the sheet, even pushed a few
   * centimetres through it, and ends when the finger lifts or leaves the edge.
   */
  private updateFingers() {
    const session = this.world.session;
    if (!session || this.slateDown || this.slateTween) {
      for (const id of FINGER_IDS) this.penUp(id);
      return;
    }
    for (const src of session.inputSources) {
      const side = src.handedness;
      if (!src.hand || (side !== 'left' && side !== 'right')) continue;
      const id = side === 'left' ? FINGER_IDS[0] : FINGER_IDS[1];
      const tip = this.world.playerSpaceEntities.indexTipSpaces[side].object3D;
      if (!tip) continue;
      tip.getWorldPosition(_tip);
      const on = this.toPx(_tip, _px);
      const depth = _px.z; // + in front of the paper, - pushed through
      // write at the fingertip's spot on the sheet
      _hit.copy(_tip);
      if (this.pens.has(id)) {
        if (!on || depth > 0.02 || depth < -0.07) this.penUp(id);
        else this.penMove(id, _hit);
      } else if (on && depth < 0.008 && depth > -0.04) {
        sfx.unlockAudio();
        this.touch();
        this.penDown(id, _hit);
      }
    }
  }

  private dot(x: number, y: number) {
    const g = this.inkCanvas.getContext('2d')!;
    g.fillStyle = INK;
    g.beginPath();
    g.arc(x, y, 7.5, 0, Math.PI * 2);
    g.fill();
    this.inkTex.needsUpdate = true;
  }

  private redrawSlateBg() {
    const written = store.userThings().some((t) => t.created === store.state.lastOpen);
    const y = store.yesterday;
    let title = 'What do you want to get done today?';
    let sub = 'Write it with a fingertip, or point and pinch. Then tap Make card.';
    if (written) {
      title = 'Anything else? Write it, or tap Ideas.';
      sub = 'Or pick up a card and put it on the board.';
    } else if (y && y.pinned > 0) {
      title = "What's first today?";
      sub = `Yesterday: ${y.done} done${y.carried ? `, ${y.carried} came back as cards` : ''}.`;
    }
    drawSlateBackground(this.slateBgCanvas, title, sub);
    this.slateBgTex.needsUpdate = true;
  }

  private clearInk() {
    this.inkCanvas.getContext('2d')!.clearRect(0, 0, SLATE_PX.w, SLATE_PX.h);
    this.inkTex.needsUpdate = true;
  }

  private buildBoard() {
    this.board = new Group();
    this.boardCanvas = document.createElement('canvas');
    this.boardTex = texture(this.boardCanvas);
    const face = new Mesh(
      new PlaneGeometry(BOARD_M.w, BOARD_M.h),
      new MeshStandardMaterial({ map: this.boardTex, alphaTest: 0.5, roughness: 0.95 }),
    );
    const back = new Mesh(
      new PlaneGeometry(BOARD_M.w * 0.98, BOARD_M.h * 0.96),
      new MeshStandardMaterial({ color: '#d9cfb8', roughness: 1 }),
    );
    back.rotation.y = Math.PI;
    back.position.z = -0.002;
    this.board.add(face, back);
    this.redrawBoard();
    this.boardEntity = this.world.createTransformEntity(this.board);
    // preview of where the board will stick when pointing at a wall
    this.wallGhost = new Mesh(
      new PlaneGeometry(BOARD_M.w, BOARD_M.h),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.wallGhost.visible = false;
    this.world.createTransformEntity(this.wallGhost);
    this.boardEntity.addComponent(Board);
    this.boardEntity.addComponent(RayInteractable);
    this.boardEntity.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveFromTarget,
      rotate: true,
      scale: false,
    });
  }

  private redrawBoard() {
    const filled = [0, 1, 2].map((i) => !!store.slotOf(i));
    drawBoard(this.boardCanvas, { date: new Date(), filled, doneToday: store.doneToday(), highlight: this.boardHighlight });
    this.boardTex.needsUpdate = true;
  }

  private buildJar() {
    this.jar = new Group();
    const glass = new MeshStandardMaterial({
      color: '#d8ecff',
      transparent: true,
      opacity: 0.18,
      roughness: 0.05,
      metalness: 0,
      side: DoubleSide,
      depthWrite: false,
    });
    const wall = new Mesh(new CylinderGeometry(0.078, 0.07, 0.17, 40, 1, true), glass);
    wall.position.y = 0.085;
    const bottom = new Mesh(new CircleGeometry(0.07, 40), glass);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.002;
    this.jarRim = new MeshStandardMaterial({ color: '#eef6ff', emissive: '#000000', transparent: true, opacity: 0.55, roughness: 0.1 });
    const rim = new Mesh(new TorusGeometry(0.078, 0.004, 8, 48), this.jarRim);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.17;
    this.jarLabelCanvas = document.createElement('canvas');
    this.jarLabelTex = texture(this.jarLabelCanvas);
    const label = new Mesh(
      new PlaneGeometry(0.13, 0.0762),
      new MeshStandardMaterial({ map: this.jarLabelTex, alphaTest: 0.5, roughness: 0.9 }),
    );
    label.position.set(0, 0.07, 0.081);
    this.jar.add(wall, bottom, rim, label);
    this.redrawJarLabel();
    const e = this.world.createTransformEntity(this.jar);
    e.addComponent(Jar);

    // crumpled paper balls for things already done
    const geo = new IcosahedronGeometry(0.021, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.78 + Math.random() * 0.4;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    this.ballGeo = geo;
    const done = store.things.filter((t) => t.status === 'done');
    for (const t of done.slice(-30)) this.addBall(t.color, false);
  }

  private redrawJarLabel() {
    drawJarLabel(this.jarLabelCanvas, store.doneCount(), store.streak(), store.week());
    this.jarLabelTex.needsUpdate = true;
  }

  private ballRest(i: number, out: Vector3) {
    const perLayer = 6;
    const layer = Math.floor(i / perLayer);
    const a = (i % perLayer) * ((Math.PI * 2) / perLayer) + layer * 0.5;
    const r = i % perLayer === 0 && layer % 2 === 0 ? 0.0 : 0.038;
    return out.set(Math.cos(a) * r, 0.022 + layer * 0.026, Math.sin(a) * r);
  }

  private addBall(color: number, animate: boolean): Mesh {
    let mat = this.cardBackMat.get(color);
    if (!mat) {
      mat = new MeshStandardMaterial({ color: PAPER_COLORS[color % PAPER_COLORS.length], roughness: 1, flatShading: true });
      this.cardBackMat.set(color, mat);
    }
    const ball = new Mesh(this.ballGeo, mat);
    const i = this.balls.length % 36;
    this.ballRest(i, ball.position);
    ball.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.jar.add(ball);
    this.balls.push(ball);
    if (this.balls.length > 36) {
      const old = this.balls.shift()!;
      this.jar.remove(old);
    }
    if (animate) {
      const rest = ball.position.clone();
      ball.position.y = 0.32;
      const t0 = performance.now();
      const fall = () => {
        const t = Math.min(1, (performance.now() - t0) / 380);
        ball.position.y = 0.32 + (rest.y - 0.32) * t * t;
        if (t < 1) requestAnimationFrame(fall);
      };
      fall();
    }
    return ball;
  }

  // ------------------------------------------------------------- cards

  private nextColor() {
    this.colorCursor = (this.colorCursor + 1) % PAPER_COLORS.length;
    return (store.things.length + this.colorCursor) % PAPER_COLORS.length;
  }

  private viewOf(e: Entity): CardView | undefined {
    const id = e.getValue(Card, 'thingId') as string;
    return this.views.get(id);
  }

  private spawnCard(thing: Thing, fromSlate: boolean) {
    const obj = new Group();
    const canvas = document.createElement('canvas');
    const tex = texture(canvas);
    const front = new Mesh(this.cardGeo, new MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.9 }));
    let back = this.cardBackMat.get(thing.color);
    if (!back) {
      back = new MeshStandardMaterial({ color: PAPER_COLORS[thing.color % PAPER_COLORS.length], roughness: 1, flatShading: true });
      this.cardBackMat.set(thing.color, back);
    }
    const rear = new Mesh(this.cardGeo, back);
    rear.rotation.y = Math.PI;
    rear.scale.setScalar(0.96);
    rear.position.z = -0.0006;
    obj.add(front, rear);
    obj.userData.canvas = canvas;
    obj.userData.tex = tex;
    const entity = this.world.createTransformEntity(obj);
    entity.addComponent(Card, { thingId: thing.id });
    entity.addComponent(RayInteractable);
    entity.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveFromTarget,
      rotate: false,
      scale: false,
    });
    const v: CardView = { thing, entity, obj, grabbed: false, target: -1 };
    this.views.set(thing.id, v);
    this.redrawCard(v);
    if (fromSlate) {
      this.slate.updateWorldMatrix(true, false);
      this.slate.matrixWorld.decompose(_p, _q, _s);
      setWorldPose(obj, _p, _q, 1.6);
    }
    return v;
  }

  private redrawCard(v: CardView) {
    const canvas = v.obj.userData.canvas as HTMLCanvasElement;
    const tex = v.obj.userData.tex;
    void drawCard(canvas, v.thing).then(() => {
      tex.needsUpdate = true;
    });
  }

  makeInkCard() {
    sfx.unlockAudio();
    if (this.slateDown) {
      this.setSlateDown(false);
      this.flash('Write another thing', 'Then tap Make card again.');
      return;
    }
    const b = inkBounds(this.inkCanvas);
    if (!b || b.w * b.h < 400) {
      this.flash('Write something on the paper first', 'Touch it with a fingertip, or point and pinch.');
      return;
    }
    const ink = cropInk(this.inkCanvas);
    if (!ink) return;
    const thing = store.add({ kind: 'ink', ink, color: this.nextColor() });
    this.clearInk();
    this.spawnCard(thing, true);
    sfx.cardMade();
    this.afterCardMade();
  }

  makeTextCard(text: string) {
    sfx.unlockAudio();
    const thing = store.add({ kind: 'text', text, color: this.nextColor() });
    this.spawnCard(thing, true);
    sfx.cardMade();
    this.afterCardMade();
  }

  private afterCardMade() {
    store.setTaught('write');
    this.redrawSlateBg();
    this.relayout();
    this.refreshCoach();
  }

  private onCardDropped(v: CardView) {
    const target = v.target;
    v.target = -1;
    this.setBoardHighlight(-1);
    this.jarRim.emissive.set('#000000');
    if (target === 3) {
      this.toJar(v);
      return;
    }
    if (target >= 0) {
      this.pinTo(v, target);
      return;
    }
    const p = v.obj.getWorldPosition(_p);
    // into the jar?
    this.jar.updateWorldMatrix(true, false);
    _p2.set(0, 0.17, 0).applyMatrix4(this.jar.matrixWorld);
    if (p.distanceTo(_p2) < 0.17) {
      this.toJar(v);
      return;
    }
    // onto the board?
    this.board.updateWorldMatrix(true, false);
    _p2.copy(p);
    this.board.worldToLocal(_p2);
    if (Math.abs(_p2.z) < 0.25 && Math.abs(_p2.x) < BOARD_M.w / 2 + 0.08 && Math.abs(_p2.y) < BOARD_M.h / 2 + 0.1) {
      let best = 0;
      for (let i = 1; i < 3; i++) {
        if (Math.abs(_p2.x - SLOT_CENTERS[i][0]) < Math.abs(_p2.x - SLOT_CENTERS[best][0])) best = i;
      }
      this.pinTo(v, best);
      return;
    }
    if (v.thing.status === 'today') {
      store.unpin(v.thing.id);
      this.redrawBoard();
    }
    this.relayout();
    this.refreshCoach();
  }

  private pinTo(v: CardView, slot: number) {
    store.pin(v.thing.id, slot);
    sfx.snap();
    this.haptic(0.5, 40);
    if (!v.thing.warmup) store.setTaught('pick');
    this.redrawBoard();
    this.relayout();
    this.refreshCoach();
  }

  /** Ray of the controller or hand holding `e`, in world space. */
  private holdRay(e: Entity): boolean {
    // Eyes and hands: when gaze is available, far rays are off and you aim by looking.
    const xr = (this.input as any).xr;
    const gp = xr?.gazeEnabled ? xr.gazePointer : null;
    if (gp?.isSelecting?.()) {
      if (this.eyeValid) {
        _ro.copy(this.eyeO);
        _rd.copy(this.eyeD);
      } else {
        _ro.copy(gp.getOrigin());
        _rd.copy(gp.getDirection()).normalize();
      }
      return true;
    }
    const hand = this.world.getSystem(GrabSystem)?.getHolderHand(e);
    if (!hand) return false;
    const space = this.player.raySpaces[hand];
    space.updateWorldMatrix(true, false);
    _ro.setFromMatrixPosition(space.matrixWorld);
    _rd.set(0, 0, -1).transformDirection(space.matrixWorld);
    return true;
  }

  /** What a held card's ray points at: 0..2 a board slot, 3 the jar, -1 nothing. */
  private aimTarget(): number {
    // jar: ray passes close to the jar's mouth
    this.jar.updateWorldMatrix(true, false);
    _p2.set(0, 0.12, 0).applyMatrix4(this.jar.matrixWorld);
    const tj = _p.copy(_p2).sub(_ro).dot(_rd);
    if (tj > 0) {
      _hit.copy(_ro).addScaledVector(_rd, tj);
      if (_hit.distanceTo(_p2) < 0.13) return 3;
    }
    // board: intersect its plane
    this.board.updateWorldMatrix(true, false);
    this.board.getWorldQuaternion(_q);
    _n.set(0, 0, 1).applyQuaternion(_q);
    const denom = _rd.dot(_n);
    if (Math.abs(denom) > 1e-4) {
      this.board.getWorldPosition(_p2);
      const t = _p.copy(_p2).sub(_ro).dot(_n) / denom;
      if (t > 0) {
        _hit.copy(_ro).addScaledVector(_rd, t);
        this.board.worldToLocal(_hit);
        if (Math.abs(_hit.x) < BOARD_M.w / 2 + 0.06 && Math.abs(_hit.y) < BOARD_M.h / 2 + 0.08) {
          let best = 0;
          for (let i = 1; i < 3; i++) {
            if (Math.abs(_hit.x - SLOT_CENTERS[i][0]) < Math.abs(_hit.x - SLOT_CENTERS[best][0])) best = i;
          }
          return best;
        }
      }
    }
    return -1;
  }

  private setBoardHighlight(i: number) {
    if (i === this.boardHighlight) return;
    this.boardHighlight = i;
    this.redrawBoard();
  }

  /** Where the held board's ray meets a wall, as a flush pose, or null. */
  private aimWall(): { p: Vector3; q: Quaternion } | null {
    let bestT = Infinity;
    let result: { p: Vector3; q: Quaternion } | null = null;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as { orientation?: string; polygon: DOMPointReadOnly[] } | undefined;
      const o = e.object3D;
      if (!plane || !o || plane.orientation !== 'vertical') continue;
      o.updateWorldMatrix(true, false);
      const n = new Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new Quaternion()));
      const origin = o.getWorldPosition(new Vector3());
      // plane normals may point into or out of the room; face the viewer
      if (n.dot(_p.copy(_ro).sub(origin)) < 0) n.negate();
      const denom = _rd.dot(n);
      if (denom > -1e-3) continue; // must face the ray
      const t = origin.clone().sub(_ro).dot(n) / denom;
      if (t < 0.2 || t > 6 || t > bestT) continue;
      const hit = _ro.clone().addScaledVector(_rd, t);
      const local = o.worldToLocal(hit.clone());
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const pt of plane.polygon) {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z);
      }
      if (local.x < minX - 0.05 || local.x > maxX + 0.05 || local.z < minZ - 0.05 || local.z > maxZ + 0.05) continue;
      const up = _up.clone().addScaledVector(n, -_up.dot(n)).normalize();
      const right = new Vector3().crossVectors(up, n).normalize();
      const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, n));
      bestT = t;
      result = { p: hit.addScaledVector(n, 0.012), q };
    }
    return result;
  }

  private toJar(v: CardView) {
    store.done(v.thing.id);
    this.views.delete(v.thing.id);
    this.dying.set(v.thing.id, v);
    sfx.crumple(this.jarMouth());
    this.jar.updateWorldMatrix(true, false);
    _p2.set(0, 0.26, 0).applyMatrix4(this.jar.matrixWorld);
    v.obj.getWorldQuaternion(_q);
    this.tweenTo(v, _p2, _q, 0.15, 0.3, 0.02, () => {
      v.entity.dispose();
      this.addBall(v.thing.color, true);
      sfx.clink(this.balls.length, this.jarMouth());
      this.haptic(0.7, 60);
      this.redrawJarLabel();
      this.redrawBoard();
      const pinnedLeft = [0, 1, 2].filter((i) => store.slotOf(i)).length;
      if (v.thing.warmup) {
        // the first payoff: something already done lands in the jar
        sfx.cheer(this.jarMouth());
        store.setTaught('jar');
        this.flash("That's the whole idea", 'Now write what you want to get done today.', 4500);
        this.setSlateDown(false);
      } else if (pinnedLeft === 0 && store.doneToday() >= 1) {
        sfx.cheer(this.jarMouth());
        this.flash(
          store.doneToday() >= 3 ? 'All three done. A good day.' : `Board clear: ${store.doneToday()} done today`,
          'Come back tomorrow for a fresh board. Your jar keeps them all.',
          6000,
        );
        store.setTaught('done');
      } else {
        this.flash(`${store.doneToday()} done today`, 'Keep going.');
        store.setTaught('done');
      }
      if (!store.state.onboarded && !v.thing.warmup) store.setOnboarded();
      this.redrawSlateBg();
      this.relayout();
    });
  }

  // ------------------------------------------------------------- layout

  /**
   * Inbox cards sit on a rail just below eye level, centred, so they stay
   * inside a narrow field of view (Meta's glasses are about 70 degrees wide).
   * More cards overlap instead of spreading wider. Returns the yaw to face the viewer.
   */
  private railSlot(i: number, n: number, out: Vector3): number {
    const r = 0.56;
    const spacing = n > 1 ? Math.min(0.155, 0.6 / (n - 1)) : 0;
    const x = (i - (n - 1) / 2) * spacing;
    const az = x / r;
    out.set(Math.sin(az) * (r - i * 0.002), -0.1, -Math.cos(az) * (r - i * 0.002));
    return -az;
  }

  private homePose(local: Vector3, yaw: number, pitch: number, outP: Vector3, outQ: Quaternion) {
    outP.copy(local).applyMatrix4(this.home);
    _q2.setFromAxisAngle(_up, yaw);
    outQ.copy(this.homeQ).multiply(_q2);
    _q2.setFromAxisAngle(X_AXIS, pitch);
    outQ.multiply(_q2);
  }

  /** Where everything goes before the first XR frame (desktop / emulator 2D view). */
  private layoutDefault() {
    this.home.makeTranslation(0, 1.5, 0);
    this.homeQ.identity();
    this.placeFixtures();
  }

  private layoutFromHead() {
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    head.matrixWorld.decompose(_p, _q, _s);
    _n.set(0, 0, -1).applyQuaternion(_q);
    const yaw = Math.atan2(-_n.x, -_n.z);
    this.homeQ.setFromAxisAngle(_up, yaw);
    this.home.compose(_p, this.homeQ, ONE);
    this.placeFixtures();
    this.laidOut = true;
  }

  private slatePose(down: boolean, outP: Vector3, outQ: Quaternion) {
    if (down) this.homePose(_p2.set(0, -0.62, -0.36), 0, -1.2, outP, outQ);
    else this.homePose(_p2.set(0, -0.31, -0.44), 0, -0.55, outP, outQ);
  }

  /**
   * The folded slate rests near the hands; it must not count as a touch
   * target there, or resting hands would block gaze and tap it by accident.
   */
  private setSlateTouch(on: boolean) {
    const ents = [this.world.getSceneEntity('guide-panel')];
    for (const e of ents) {
      if (!e) continue;
      if (on && !e.hasComponent(PokeInteractable)) e.addComponent(PokeInteractable);
      if (!on && e.hasComponent(PokeInteractable)) e.removeComponent(PokeInteractable);
    }
  }

  private setSlateDown(down: boolean) {
    if (down === this.slateDown) return;
    this.slateDown = down;
    this.setSlateTouch(!down);
    this.ui?.getElementById('make-label')?.setProperties({ text: down ? 'Write' : 'Make card' });
    this.slate.updateWorldMatrix(true, false);
    const p0 = new Vector3(), q0 = new Quaternion(), p1 = new Vector3(), q1 = new Quaternion();
    this.slate.matrixWorld.decompose(p0, q0, _s);
    this.slatePose(down, p1, q1);
    this.slateTween = { p0, p1, q0, q1, t: 0 };
    sfx.pickUp();
  }

  private placeFixtures() {
    this.slatePose(this.slateDown, _p, _q);
    this.slateTween = null;
    setWorldPose(this.slate, _p, _q);
    if (!this.boardAnchor) {
      this.homePose(_p2.set(0, 0.18, -1.0), 0, 0, _p, _q);
      setWorldPose(this.board, _p, _q, this.boardScale);
    }
    if (!this.jarOnTable) {
      this.homePose(_p2.set(0.23, -0.46, -0.44), -Math.atan2(0.23, 0.44), 0, _p, _q);
      setWorldPose(this.jar, _p, _q);
    }
    this.placePanel();
    this.relayout(true);
    this.ghostPath = null;
    if (this.coach) this.refreshCoach();
  }

  /** Buttons hang just under the slate's bottom edge and move with it. */
  private placePanel() {
    const panelObj = this.world.getSceneObject('guide-panel');
    if (!panelObj) return;
    this.slate.updateWorldMatrix(true, false);
    _p2.set(0, -SLATE_M.h / 2 - 0.042, 0.004).applyMatrix4(this.slate.matrixWorld);
    this.slate.getWorldQuaternion(_q2);
    setWorldPose(panelObj, _p2, _q2, panelObj.scale.x);
  }

  private relayout(instant = false) {
    const inbox = store.things.filter((t) => t.status === 'inbox' && this.views.has(t.id));
    inbox.forEach((t, i) => {
      const v = this.views.get(t.id)!;
      if (v.grabbed) return;
      const yaw = this.railSlot(i, inbox.length, _p2);
      this.homePose(_p2, yaw, -0.12, _p, _q);
      if (instant) {
        v.tween = undefined;
        setWorldPose(v.obj, _p, _q, RAIL_SCALE);
      } else this.tweenTo(v, _p, _q, RAIL_SCALE, 0.45, 0.04);
    });
    for (let i = 0; i < 3; i++) {
      const t = store.slotOf(i);
      const v = t && this.views.get(t.id);
      if (!v || v.grabbed) continue;
      this.slotPose(i, _p, _q);
      if (instant) {
        v.tween = undefined;
        setWorldPose(v.obj, _p, _q, this.boardScale);
      } else this.tweenTo(v, _p, _q, this.boardScale, 0.35, 0.02);
    }
  }

  private slotPose(i: number, outP: Vector3, outQ: Quaternion) {
    this.board.updateWorldMatrix(true, false);
    outP.set(SLOT_CENTERS[i][0], SLOT_CENTERS[i][1], 0.006).applyMatrix4(this.board.matrixWorld);
    this.board.getWorldQuaternion(outQ);
  }

  private tweenTo(v: CardView, p: Vector3, q: Quaternion, s: number, dur: number, lift: number, done?: () => void) {
    v.obj.updateWorldMatrix(true, false);
    const p0 = new Vector3(), q0 = new Quaternion(), s0 = new Vector3();
    v.obj.matrixWorld.decompose(p0, q0, s0);
    v.tween = { p0, p1: p.clone(), q0, q1: q.clone(), s0: s0.x, s1: s, t: 0, dur, lift, done };
  }

  // ------------------------------------------------------------- board on the wall

  private onBoardDropped() {
    this.wallGhost.visible = false;
    if (this.wallTarget) {
      // grow on far walls so the handwriting stays readable
      const dist = this.player.head.getWorldPosition(_p2).distanceTo(this.wallTarget.p);
      this.boardScale = Math.min(2.2, Math.max(1, dist / 1.1));
      setWorldPose(this.board, this.wallTarget.p, this.wallTarget.q, this.boardScale);
      sfx.wallStick(this.wallTarget.p);
      this.wallTarget = null;
      this.boardOnWall = true;
      this.haptic(0.8, 70);
      store.setTaught('wall');
      this.flash('Stuck to your wall', 'It will be there next time you put the headset on.');
      this.anchorRequest = true;
      this.relayout(true);
      return;
    }
    const p = this.board.getWorldPosition(_p);
    let best: { d: number; n: Vector3; o: Vector3 } | null = null;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as { orientation?: string; polygon: DOMPointReadOnly[] } | undefined;
      const o = e.object3D;
      if (!plane || !o || plane.orientation !== 'vertical') continue;
      o.updateWorldMatrix(true, false);
      const n = new Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(_q));
      const origin = o.getWorldPosition(new Vector3());
      this.player.head.getWorldPosition(_p2);
      if (n.dot(_p2.sub(origin)) < 0) n.negate();
      const d = _p2.copy(p).sub(origin).dot(n);
      if (d < -0.1 || d > 0.4) continue;
      // inside the plane's outline (with some slack)?
      const local = o.worldToLocal(_p2.copy(p));
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const pt of plane.polygon) {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z);
      }
      if (local.x < minX - 0.15 || local.x > maxX + 0.15 || local.z < minZ - 0.15 || local.z > maxZ + 0.15) continue;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { d, n, o: origin };
    }
    if (best) {
      const n = best.n;
      const up = _p2.copy(_up).addScaledVector(n, -_up.dot(n)).normalize();
      const right = new Vector3().crossVectors(up, n).normalize();
      _m.makeBasis(right, up, n);
      _q.setFromRotationMatrix(_m);
      const pos = new Vector3().copy(p).addScaledVector(n, -best.d + 0.012);
      setWorldPose(this.board, pos, _q);
      this.boardOnWall = true;
      sfx.wallStick(pos);
      this.haptic(0.8, 70);
      store.setTaught('wall');
      this.flash('Stuck to your wall', 'It will be there next time you put the headset on.');
    } else {
      // free-floating: turn it to face the viewer, upright
      this.player.head.getWorldPosition(_p2);
      const yaw = Math.atan2(_p2.x - p.x, _p2.z - p.z);
      _q.setFromAxisAngle(_up, yaw);
      setWorldPose(this.board, p, _q);
      this.boardOnWall = false;
      sfx.snap();
      this.refreshCoach();
    }
    this.anchorRequest = true;
    this.relayout(true);
  }

  private releaseAnchor() {
    if (this.boardAnchor) {
      try {
        this.boardAnchor.delete();
      } catch {
        // already gone
      }
      this.boardAnchor = null;
    }
    const uuid = store.state.boardAnchor;
    const session = this.world.session as any;
    if (uuid && session?.deletePersistentAnchor) {
      session.deletePersistentAnchor(uuid).catch(() => undefined);
    }
    store.setBoardAnchor(undefined);
  }

  private onFrame(frame: XRFrame) {
    const ref = this.world.xrReferenceSpace;
    if (!ref) return;
    this.eyeValid = false;
    for (const src of frame.session.inputSources) {
      if (src.targetRayMode !== 'gaze') continue;
      const pose = frame.getPose(src.targetRaySpace, ref);
      if (!pose) break;
      _m.fromArray(pose.transform.matrix);
      this.world.player.updateWorldMatrix(true, false);
      _m.premultiply(this.world.player.matrixWorld);
      this.eyeO.setFromMatrixPosition(_m);
      this.eyeD.set(0, 0, -1).transformDirection(_m);
      this.eyeValid = true;
      break;
    }
    if (this.anchorRequest && frame.createAnchor) {
      this.anchorRequest = false;
      this.board.updateWorldMatrix(true, false);
      this.world.player.updateWorldMatrix(true, false);
      _m.copy(this.world.player.matrixWorld).invert().multiply(this.board.matrixWorld);
      _m.decompose(_p, _q, _s);
      const pose = new XRRigidTransform({ x: _p.x, y: _p.y, z: _p.z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      frame
        .createAnchor(pose, ref)
        ?.then(async (anchor) => {
          if (this.queries.grabbedBoard.entities.size > 0) {
            anchor.delete();
            return;
          }
          this.boardAnchor = anchor;
          const a = anchor as any;
          if (a.requestPersistentHandle) {
            try {
              store.setBoardAnchor(await a.requestPersistentHandle(), this.boardScale);
            } catch {
              // persistence not available; anchor still holds for this session
            }
          }
        })
        .catch(() => undefined);
    }
    if (this.boardAnchor && this.queries.grabbedBoard.entities.size === 0) {
      let pose: XRPose | undefined;
      try {
        pose = frame.getPose(this.boardAnchor.anchorSpace, ref);
      } catch {
        // the anchor was deleted (by the system or a newer placement)
        this.boardAnchor = null;
      }
      if (pose) {
        _m.fromArray(pose.transform.matrix);
        this.world.player.updateWorldMatrix(true, false);
        _m.premultiply(this.world.player.matrixWorld);
        _m.decompose(_p, _q, _s);
        setWorldPose(this.board, _p, _q, this.boardScale);
      }
    }
  }

  private restoreAnchor() {
    const uuid = store.state.boardAnchor;
    const session = this.world.session as any;
    if (!uuid || !session?.restorePersistentAnchor) return;
    session
      .restorePersistentAnchor(uuid)
      .then((anchor: XRAnchor) => {
        // the board may have been moved while the anchor was being restored
        if (store.state.boardAnchor !== uuid || this.queries.grabbedBoard.entities.size > 0) {
          try {
            anchor.delete();
          } catch {
            // already gone
          }
          return;
        }
        this.boardAnchor = anchor;
        this.boardOnWall = true;
        this.relayout(true);
      })
      .catch((err: unknown) => {
        console.warn('[three-things] could not restore the board anchor', err);
        store.setBoardAnchor(undefined);
      });
  }

  // ------------------------------------------------------------- per frame

  update(delta: number): void {
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive && !this.laidOut) {
      // wait a few frames for the head pose to settle
      if (++this.settleFrames > 10) {
        this.layoutFromHead();
        this.restoreAnchor();
      }
    }
    if (this.slateTween) {
      const st = this.slateTween;
      st.t = Math.min(1, st.t + delta / 0.45);
      const k = ease(st.t);
      _p.lerpVectors(st.p0, st.p1, k);
      _q.slerpQuaternions(st.q0, st.q1, k);
      setWorldPose(this.slate, _p, _q);
      this.placePanel();
      if (st.t >= 1) {
        this.slateTween = null;
        this.ghostPath = null;
        if (this.lesson === 'write') this.placeCoach('write');
      }
    }
    this.updateFingers();
    this.tickCoach(delta);
    // while a card is held, show where it would land
    for (const v of this.views.values()) {
      if (!v.grabbed) continue;
      const t = this.holdRay(v.entity) ? this.aimTarget() : -1;
      if (t !== v.target) {
        v.target = t;
        this.setBoardHighlight(t >= 0 && t < 3 ? t : -1);
        this.jarRim.emissive.set(t === 3 ? '#3a7bd5' : '#000000');
        if (t >= 0) this.haptic(0.2, 15);
      }
    }
    // while the board is held, preview where it would stick
    if (this.queries.grabbedBoard.entities.size > 0) {
      const be = this.boardEntity;
      this.wallTarget = this.holdRay(be) ? this.aimWall() : null;
      if (this.wallTarget) {
        setWorldPose(this.wallGhost, this.wallTarget.p, this.wallTarget.q);
        this.wallGhost.visible = true;
      } else this.wallGhost.visible = false;
    }
    for (const v of this.views.values()) {
      if (v.grabbed) continue;
      const tw = v.tween;
      if (tw) {
        tw.t = Math.min(1, tw.t + delta / tw.dur);
        const k = ease(tw.t);
        _p.lerpVectors(tw.p0, tw.p1, k);
        _p.y += Math.sin(Math.PI * k) * tw.lift;
        _q.slerpQuaternions(tw.q0, tw.q1, k);
        setWorldPose(v.obj, _p, _q, tw.s0 + (tw.s1 - tw.s0) * k);
        if (tw.t >= 1) {
          v.tween = undefined;
          tw.done?.();
        }
      } else if (v.thing.status === 'today') {
        // follow the board wherever it is
        this.slotPose(v.thing.slot, _p, _q);
        setWorldPose(v.obj, _p, _q, this.boardScale);
      }
    }
    // cards on their way to the jar are no longer in `views`; keep animating them
    for (const e of this.queries.cards.entities) {
      const id = e.getValue(Card, 'thingId') as string;
      if (this.views.has(id)) continue;
      const v = this.dying.get(id);
      if (!v?.tween) continue;
      const tw = v.tween;
      tw.t = Math.min(1, tw.t + delta / tw.dur);
      const k = ease(tw.t);
      _p.lerpVectors(tw.p0, tw.p1, k);
      _q.slerpQuaternions(tw.q0, tw.q1, k);
      setWorldPose(v.obj, _p, _q, tw.s0 + (tw.s1 - tw.s0) * k);
      if (tw.t >= 1) {
        v.tween = undefined;
        this.dying.delete(id);
        tw.done?.();
      }
    }
  }

  private dying = new Map<string, CardView>();

  private tickCoach(delta: number) {
    const now = performance.now();
    if (this.flashUntil && now >= this.flashUntil) {
      this.flashUntil = 0;
      this.refreshCoach();
    }
    // the ghost acts out the next gesture: right away the first time, after a
    // pause when the person has done it before
    const busy = this.pens.size > 0 || [...this.views.values()].some((v) => v.grabbed) || this.queries.grabbedBoard.entities.size > 0;
    const idle = (now - this.lastAction) / 1000;
    const lessonKey = this.lesson === 'warmup' ? 'jar' : this.lesson;
    const wanted = this.laidOut && !busy && !this.slateTween && (store.taught(lessonKey) ? idle > 14 : idle > 1.2);
    if (wanted) {
      if (!this.ghostPath) this.ghostPath = this.buildGhostPath();
      if (this.ghostPath) this.ghost.play(this.ghostPath, this.ghostKind);
      else this.ghost.stop();
    } else if (this.ghost.active) {
      this.ghost.stop();
    }
    this.coach.update(delta);
    this.ghost.update(delta);
    sfx.setListener(this.player.head);
    if (this.laidOut && !this.jarOnTable && this.tableTries < 40 && Math.floor(now / 500) !== Math.floor((now - delta * 1000) / 500)) {
      this.tableTries++;
      this.placeJarOnTable();
    }
  }

  /**
   * Purposeful passthrough: if the room has a table or desk within reach,
   * the jar sits on it instead of floating.
   */
  private placeJarOnTable() {
    const head = this.player.head.getWorldPosition(new Vector3());
    let best: { p: Vector3; d: number } | null = null;
    // where the jar would float by default, used as the preferred spot
    const want = new Vector3(0.23, -0.46, -0.44).applyMatrix4(this.home);
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as { orientation?: string; polygon: DOMPointReadOnly[] } | undefined;
      const o = e.object3D;
      if (!plane || !o || plane.orientation !== 'horizontal') continue;
      o.updateWorldMatrix(true, false);
      const top = o.getWorldPosition(new Vector3());
      const drop = head.y - top.y;
      if (drop < 0.3 || drop > 1.1) continue; // a desk or table, not the floor
      // clamp the preferred spot into the plane's outline
      const local = o.worldToLocal(new Vector3(want.x, top.y, want.z));
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const pt of plane.polygon) {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z);
      }
      if (maxX - minX < 0.25 || maxZ - minZ < 0.25) continue;
      local.x = Math.min(maxX - 0.1, Math.max(minX + 0.1, local.x));
      local.z = Math.min(maxZ - 0.1, Math.max(minZ + 0.1, local.z));
      local.y = 0;
      const p = o.localToWorld(local);
      p.y = top.y;
      const d = Math.hypot(p.x - head.x, p.z - head.z);
      if (d > 1.2) continue;
      // keep it in front, inside a narrow field of view
      _n.set(0, 0, -1).applyQuaternion(this.homeQ);
      const ang = Math.acos(Math.max(-1, Math.min(1, (_n.x * (p.x - head.x) + _n.z * (p.z - head.z)) / Math.max(1e-6, d))));
      if (ang > (40 * Math.PI) / 180) continue;
      if (!best || d < best.d) best = { p, d };
    }
    if (!best) return;
    _q.setFromAxisAngle(_up, Math.atan2(head.x - best.p.x, head.z - best.p.z));
    setWorldPose(this.jar, best.p, _q);
    this.jarOnTable = true;
    this.ghostPath = null;
    if (this.lesson === 'done' || this.lesson === 'warmup') this.placeCoach(this.lesson);
  }

  // ------------------------------------------------------------- UI

  private bindUI() {
    const ui = this.world.getSceneObject<UIKitMLAsset>('guide-panel');
    this.ui = ui;
    if (!ui) return;
    const on = (id: string, fn: () => void) => {
      const el = ui.getElementById(id);
      if (!el) return;
      el.addEventListener('click', fn);
      this.cleanupFuncs.push(() => el.removeEventListener('click', fn));
    };
    on('make', () => this.makeInkCard());
    on('erase', () => {
      this.clearInk();
      sfx.pickUp();
    });
    on('ideas', () => this.togglePicks());
    QUICK_PICKS.forEach((text, i) => on(`pick${i}`, () => {
      this.makeTextCard(text);
      this.togglePicks(false);
    }));
    on('exit', () => this.world.exitXR());
    // Voice as an alternative to writing, where the browser offers speech recognition.
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (SR) {
      ui.getElementById('voice')?.setProperties({ display: 'flex' });
      on('voice', () => this.listen(SR));
    }
    if (this.slateDown) ui.getElementById('make-label')?.setProperties({ text: 'Write' });
    this.togglePicks(false);
  }

  private listening = false;

  private listen(SR: any) {
    if (this.listening) return;
    this.touch();
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    this.listening = true;
    this.flash('Listening', 'Say one thing you want to get done today.', 8000);
    rec.onresult = (ev: any) => {
      const text = String(ev.results?.[0]?.[0]?.transcript ?? '').trim();
      if (text) this.makeTextCard(text.charAt(0).toUpperCase() + text.slice(1));
    };
    rec.onerror = () => this.flash("Couldn't hear that", 'Try again, or write it on the paper.');
    rec.onend = () => {
      this.listening = false;
      if (this.flashUntil > performance.now() + 4000) this.flashUntil = performance.now();
    };
    rec.start();
  }

  private togglePicks(open = !this.picksOpen) {
    this.picksOpen = open;
    this.ui?.getElementById('picks')?.setProperties({ display: open ? 'flex' : 'none' });
  }

  /** Show a short message in the coach ribbon for a few seconds. */
  private flash(title: string, sub = '', ms = 3500) {
    this.flashUntil = performance.now() + ms;
    this.coach.show(title, sub);
    this.placeCoach('focus');
  }

  /** Any direct interaction: hide the ghost until the person goes idle again. */
  private touch() {
    this.lastAction = performance.now();
    this.ghost.stop();
  }

  private jarMouth(): Vector3 {
    this.jar.updateWorldMatrix(true, false);
    return new Vector3(0, 0.17, 0).applyMatrix4(this.jar.matrixWorld);
  }

  private computeLesson(): Lesson {
    const warm = store.things.find((t) => t.warmup && t.status === 'today');
    if (warm) return 'warmup';
    const user = store.userThings();
    const inbox = user.filter((t) => t.status === 'inbox').length;
    const pinned = user.filter((t) => t.status === 'today').length;
    if (inbox === 0 && pinned === 0) return 'write';
    if (pinned === 0) return 'pick';
    if (!this.boardOnWall && this.hasWalls() && !store.taught('wall')) return 'wall';
    return 'done';
  }

  private hasWalls() {
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as { orientation?: string } | undefined;
      if (plane?.orientation === 'vertical') return true;
    }
    return false;
  }

  /** Update the coach ribbon, slate prompt and ghost for the current lesson. */
  private refreshCoach() {
    this.lesson = this.computeLesson();
    const user = store.userThings();
    const pinned = user.filter((t) => t.status === 'today').length;
    const inbox = user.filter((t) => t.status === 'inbox').length;
    if (performance.now() < this.flashUntil) return;
    switch (this.lesson) {
      case 'warmup':
        this.coach.show('Pinch the card, point at the jar, let go', "It's already done: you put the headset on.", STEP.warmup);
        break;
      case 'write':
        // the slate itself carries the prompt while writing
        this.coach.hide();
        break;
      case 'pick':
        this.coach.show('Pinch a card, point at a slot, let go', 'Pick up to three things for today.', STEP.pick);
        break;
      case 'wall':
        this.coach.show("Pinch the board's edge, point at a wall, let go", 'It stays on your wall, even tomorrow.', STEP.wall);
        break;
      case 'done':
        if (pinned < 3 && inbox > 0) this.coach.show(`${pinned} of 3 picked`, 'Add another, or keep the day light.', STEP.pick);
        else this.coach.show('Finished one? Drop it in the jar', 'Pinch it, point at the jar, let go.', STEP.done);
        break;
    }
    this.placeCoach(this.lesson);
    this.ghostPath = null;
  }

  /** Put the ribbon where the next action happens. */
  private placeCoach(where: Lesson | 'focus') {
    const o = this.coach.obj;
    if (where === 'focus') where = this.lesson;
    if (where === 'done' && store.userThings().every((t) => t.status !== 'today')) where = 'pick';
    if (where === 'done' || where === 'warmup') {
      // above the jar, facing the viewer
      const m = this.jarMouth();
      if (where === 'warmup') {
        // first run: under the board, between the card and the jar
        this.board.updateWorldMatrix(true, false);
        _p.set(0, -BOARD_M.h / 2 - 0.08, 0.02).applyMatrix4(this.board.matrixWorld);
        this.board.getWorldQuaternion(_q);
        setWorldPose(o, _p, _q, 1.25);
        return;
      }
      _p.copy(m).add(_p2.set(0, 0.16, 0));
      this.player.head.getWorldPosition(_p2);
      _q.setFromAxisAngle(_up, Math.atan2(_p2.x - _p.x, _p2.z - _p.z));
      setWorldPose(o, _p, _q, 0.62);
      return;
    }
    if (where === 'write') {
      // just above the slate's top edge
      this.slate.updateWorldMatrix(true, false);
      _p.set(0, SLATE_M.h / 2 + 0.04, 0.01).applyMatrix4(this.slate.matrixWorld);
      this.slate.getWorldQuaternion(_q);
      setWorldPose(o, _p, _q, 0.7);
      return;
    }
    // pick / wall: just under the board, between the rail and the board
    this.board.updateWorldMatrix(true, false);
    _p.set(0, -BOARD_M.h / 2 - 0.08, 0.02).applyMatrix4(this.board.matrixWorld);
    this.board.getWorldQuaternion(_q);
    const far = this.player.head.getWorldPosition(_p2).distanceTo(_p);
    setWorldPose(o, _p, _q, Math.max(1.25, (far / 1.1) * 1.25));
  }

  /** The gesture the ghost hand acts out for the current lesson. */
  private buildGhostPath(): GhostPath | null {
    const firstToday = store.things.find((t) => t.status === 'today' && this.views.has(t.id));
    switch (this.lesson) {
      case 'warmup':
      case 'done': {
        if (!firstToday) return null;
        this.ghostKind = 'pinch';
        return arcPath(this.views.get(firstToday.id)!.obj.getWorldPosition(new Vector3()), this.jarMouth().add(_p2.set(0, 0.03, 0)), 0.12);
      }
      case 'write':
        if (this.slateDown) return null;
        this.ghostKind = 'point';
        this.slate.updateWorldMatrix(true, false);
        return squigglePath(this.slate.matrixWorld, 0.3);
      case 'pick': {
        const t = store.things.find((x) => x.status === 'inbox' && this.views.has(x.id));
        if (!t) return null;
        let slot = 0;
        while (slot < 2 && store.slotOf(slot)) slot++;
        const to = new Vector3(), q = new Quaternion();
        this.slotPose(slot, to, q);
        this.ghostKind = 'pinch';
        return arcPath(this.views.get(t.id)!.obj.getWorldPosition(new Vector3()), to, 0.06);
      }
      case 'wall': {
        // toward the nearest wall in front of the viewer
        const head = this.player.head.getWorldPosition(new Vector3());
        _rd.set(0, 0, -1).applyQuaternion(this.player.head.getWorldQuaternion(_q));
        _ro.copy(head);
        const hit = this.aimWall();
        const from = new Vector3(BOARD_M.w / 2 - 0.04, BOARD_M.h / 2 - 0.03, 0.01);
        this.board.updateWorldMatrix(true, false);
        from.applyMatrix4(this.board.matrixWorld);
        if (!hit) return null;
        this.ghostKind = 'pinch';
        return arcPath(from, hit.p, 0.05);
      }
    }
    return null;
  }

  private haptic(intensity: number, ms: number) {
    const session = this.world.session;
    if (!session) return;
    for (const src of session.inputSources) {
      const act = (src.gamepad as any)?.hapticActuators?.[0];
      act?.pulse?.(intensity, ms);
    }
  }
}
