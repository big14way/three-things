/**
 * Teaching without a wall of text.
 *
 * Coach: one dark ribbon with a single instruction, placed where the next
 * action happens (under the board, above the jar).
 * Ghost: a hand icon with a dotted trail that acts out the gesture (pinch a
 * card, carry it, let go) until the person does it themselves.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { COACH_M, drawCoach, texture } from './paper.js';

export class Coach {
  readonly obj: Mesh;
  private canvas = document.createElement('canvas');
  private tex = texture(this.canvas);
  private mat: MeshBasicMaterial;
  private key = '';
  private opacity = 0;
  private target = 0;

  constructor(add: (o: Mesh) => void) {
    drawCoach(this.canvas, '', '');
    this.mat = new MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    this.obj = new Mesh(new PlaneGeometry(COACH_M.w, COACH_M.h), this.mat);
    this.obj.renderOrder = 20;
    this.obj.visible = false;
    add(this.obj);
  }

  show(title: string, sub = '', step?: string) {
    const key = `${title}|${sub}|${step ?? ''}`;
    if (key !== this.key) {
      this.key = key;
      drawCoach(this.canvas, title, sub, step);
      this.tex.needsUpdate = true;
    }
    this.target = 1;
    this.obj.visible = true;
  }

  hide() {
    this.target = 0;
  }

  update(dt: number) {
    const k = Math.min(1, dt * 6);
    this.opacity += (this.target - this.opacity) * k;
    this.mat.opacity = this.opacity;
    this.obj.visible = this.opacity > 0.02;
  }
}

function emojiTexture(ch: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '96px "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif';
  // soft halo so the hand reads against any real-world background
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.fillText(ch, 64, 70);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export type GhostPath = (t: number, out: Vector3) => void;

const TRAIL = 9;

export class Ghost {
  private sprite: Sprite;
  private pinch: SpriteMaterial;
  private point: SpriteMaterial;
  private dots: Mesh[] = [];
  private path: GhostPath | null = null;
  private t = 0;
  private alpha = 0;
  private want = 0;
  private readonly period = 2.8;
  private readonly tmp = new Vector3();

  constructor(add: (o: Sprite | Mesh) => void) {
    this.pinch = new SpriteMaterial({ map: emojiTexture('🤏'), depthTest: false, transparent: true, opacity: 0 });
    this.point = new SpriteMaterial({ map: emojiTexture('☝️'), depthTest: false, transparent: true, opacity: 0 });
    this.sprite = new Sprite(this.pinch);
    this.sprite.scale.setScalar(0.055);
    this.sprite.renderOrder = 30;
    this.sprite.visible = false;
    add(this.sprite);
    const geo = new SphereGeometry(0.0055, 10, 8);
    for (let i = 0; i < TRAIL; i++) {
      const m = new Mesh(geo, new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, opacity: 0 }));
      m.renderOrder = 29;
      m.visible = false;
      this.dots.push(m);
      add(m);
    }
  }

  /** Start acting out a gesture along `path` (t from 0 to 1). */
  play(path: GhostPath, kind: 'pinch' | 'point') {
    if (this.path !== path) this.t = 0;
    this.path = path;
    this.sprite.material = kind === 'pinch' ? this.pinch : this.point;
    this.want = 1;
  }

  stop() {
    this.want = 0;
  }

  get active() {
    return this.want > 0;
  }

  update(dt: number) {
    this.alpha += (this.want - this.alpha) * Math.min(1, dt * 5);
    const on = this.alpha > 0.02 && this.path;
    this.sprite.visible = !!on;
    for (const d of this.dots) d.visible = !!on;
    if (!on || !this.path) return;
    this.t += dt;
    // 0..0.15 press, 0.15..0.8 carry, 0.8..1 rest
    const phase = (this.t % this.period) / this.period;
    const carry = Math.min(1, Math.max(0, (phase - 0.15) / 0.65));
    const k = carry * carry * (3 - 2 * carry);
    this.path(k, this.sprite.position);
    const press = phase < 0.15 ? phase / 0.15 : phase > 0.8 ? 1 - (phase - 0.8) / 0.2 : 1;
    this.sprite.scale.setScalar(0.055 * (1 - 0.18 * Math.sin(Math.PI * Math.min(1, press))));
    (this.sprite.material as SpriteMaterial).opacity = this.alpha * (phase > 0.9 ? 1 - (phase - 0.9) / 0.1 : 1);
    this.dots.forEach((d, i) => {
      const lag = Math.max(0, k - (i + 1) * 0.045);
      this.path!(lag, d.position);
      (d.material as MeshBasicMaterial).opacity = this.alpha * (carry > 0 ? 0.7 * (1 - i / TRAIL) : 0);
    });
  }
}

/** Quadratic arc from a to b, lifted by `lift` metres at the middle. */
export function arcPath(a: Vector3, b: Vector3, lift: number): GhostPath {
  const A = a.clone(), B = b.clone();
  return (t, out) => {
    out.lerpVectors(A, B, t);
    out.y += Math.sin(Math.PI * t) * lift;
  };
}

/** A cursive-looking squiggle across a surface given by its world matrix. */
export function squigglePath(matrixWorld: { elements: ArrayLike<number> }, width: number): GhostPath {
  const m = matrixWorld;
  const tmp = new Vector3();
  return (t, out) => {
    const x = -width / 2 + width * t + 0.022 * Math.cos(t * Math.PI * 9);
    const y = 0.028 * Math.sin(t * Math.PI * 9) - 0.02;
    tmp.set(x, y, 0.02);
    out.copy(tmp).applyMatrix4(m as never);
  };
}

