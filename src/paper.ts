/**
 * 2D canvas drawing for everything paper-like: card faces, the board, the jar
 * label. Rendered into CanvasTextures so the 3D scene stays a handful of quads.
 */
import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import type { Thing } from './state.js';

export const PAPER_COLORS = ['#ffe27a', '#ffc6a5', '#bfe9c9', '#bcdcf6', '#dccaf3'];
export const INK = '#1d2a5c';
export const HAND_FONT = '"Caveat", "Segoe Print", "Comic Sans MS", cursive';

let fontReady: Promise<void> | null = null;

export function loadFont(): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    try {
      const face = new FontFace('Caveat', `url(${import.meta.env.BASE_URL}fonts/caveat-600-latin.woff2)`, {
        weight: '600',
      });
      await face.load();
      document.fonts.add(face);
    } catch {
      // fall back to the system cursive font
    }
  })();
  return fontReady;
}

export function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Subtle paper grain so flat colour reads as paper in passthrough. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.save();
  g.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
    g.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
  g.restore();
}

// ---------------------------------------------------------------- slate ink

export const SLATE_PX = { w: 1024, h: 640 };

/** Bounding box of drawn pixels, or null when the canvas is empty. */
export function inkBounds(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 2) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 2) {
      if (data[row + x * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 2, h: y1 - y0 + 2 };
}

/** Crop the ink with a margin and return it as a PNG data URL. */
export function cropInk(c: HTMLCanvasElement): string | null {
  const b = inkBounds(c);
  if (!b) return null;
  const pad = 24;
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  const w = Math.min(c.width - x, b.w + pad * 2), h = Math.min(c.height - y, b.h + pad * 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

// ---------------------------------------------------------------- cards

export const CARD_PX = { w: 512, h: 352 };
export const CARD_M = { w: 0.17, h: 0.117 };

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function image(src: string) {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

/**
 * Draw a card face. The canvas is sized and painted synchronously (the GPU
 * texture keeps the size of its first upload), then repainted once the font
 * and the handwriting image are ready.
 */
export async function drawCard(c: HTMLCanvasElement, thing: Thing): Promise<void> {
  c.width = CARD_PX.w;
  c.height = CARD_PX.h;
  paintCard(c, thing, null);
  await loadFont();
  const im = thing.kind === 'ink' && thing.ink ? await image(thing.ink).catch(() => null) : null;
  paintCard(c, thing, im);
}

function paintCard(c: HTMLCanvasElement, thing: Thing, im: HTMLImageElement | null) {
  const g = c.getContext('2d')!;
  const { w, h } = CARD_PX;
  g.clearRect(0, 0, w, h);
  const base = PAPER_COLORS[thing.color % PAPER_COLORS.length];
  roundRect(g, 0, 0, w, h, 22);
  g.fillStyle = base;
  g.fill();
  // darker strip along the top, like the glued edge of a sticky note
  g.save();
  g.clip();
  g.fillStyle = 'rgba(0,0,0,0.06)';
  g.fillRect(0, 0, w, 34);
  grain(g, w, h, thing.id.charCodeAt(0));
  g.restore();

  const m = 30;
  const box = { x: m, y: 46, w: w - m * 2, h: h - 46 - m };
  if (im) {
    const s = Math.min(box.w / im.width, box.h / im.height, 1.4);
    const dw = im.width * s, dh = im.height * s;
    g.drawImage(im, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  } else if (thing.kind === 'text' && thing.text) {
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 96;
    g.font = `600 ${size}px ${HAND_FONT}`;
    while (g.measureText(thing.text).width > box.w && size > 40) {
      size -= 6;
      g.font = `600 ${size}px ${HAND_FONT}`;
    }
    g.fillText(thing.text, w / 2, box.y + box.h / 2);
  }
  if (thing.carried > 0) {
    g.fillStyle = 'rgba(29,42,92,0.55)';
    g.font = `600 34px ${HAND_FONT}`;
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillText(thing.carried === 1 ? 'from yesterday' : `carried ${thing.carried} days`, w - 22, 2);
  }
}

// ---------------------------------------------------------------- board

export const BOARD_PX = { w: 1200, h: 500 };
export const BOARD_M = { w: 0.66, h: 0.275 };
/** Slot centres in board-local metres (board faces +Z, origin at centre). */
export const SLOT_CENTERS: [number, number][] = [
  [-0.205, -0.03],
  [0, -0.03],
  [0.205, -0.03],
];

export function drawBoard(c: HTMLCanvasElement, opts: { date: Date; filled: boolean[]; doneToday: number; highlight?: number }) {
  c.width = BOARD_PX.w;
  c.height = BOARD_PX.h;
  const g = c.getContext('2d')!;
  const { w, h } = BOARD_PX;
  const pxPerM = w / BOARD_M.w;
  g.clearRect(0, 0, w, h);
  roundRect(g, 4, 4, w - 8, h - 8, 34);
  g.fillStyle = '#f7f1e3';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(60,45,20,0.25)';
  g.stroke();
  g.save();
  g.clip();
  grain(g, w, h, 7);
  g.restore();

  const day = opts.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  g.fillStyle = INK;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `600 64px ${HAND_FONT}`;
  g.fillText('Today', 40, 58);
  g.font = `600 44px ${HAND_FONT}`;
  g.fillStyle = 'rgba(29,42,92,0.6)';
  g.fillText(day, 210, 62);
  g.textAlign = 'right';
  g.fillText(opts.doneToday > 0 ? `${opts.doneToday} done` : '', w - 40, 62);

  const sw = CARD_M.w * pxPerM + 22, sh = CARD_M.h * pxPerM + 22;
  SLOT_CENTERS.forEach(([sx, sy], i) => {
    const cx = w / 2 + sx * pxPerM, cy = h / 2 - sy * pxPerM;
    roundRect(g, cx - sw / 2, cy - sh / 2, sw, sh, 24);
    if (opts.highlight === i) {
      g.fillStyle = 'rgba(58,123,213,0.22)';
      g.fill();
    }
    g.setLineDash([18, 14]);
    g.lineWidth = 5;
    g.strokeStyle = opts.highlight === i ? 'rgba(58,123,213,0.9)' : opts.filled[i] ? 'rgba(29,42,92,0.0)' : 'rgba(29,42,92,0.35)';
    g.stroke();
    g.setLineDash([]);
    if (!opts.filled[i]) {
      g.fillStyle = 'rgba(29,42,92,0.28)';
      g.textAlign = 'center';
      g.font = `600 120px ${HAND_FONT}`;
      g.fillText(String(i + 1), cx, cy + 6);
    }
  });
}

// ---------------------------------------------------------------- jar label

const ui = (px: number, weight = 600) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/**
 * Jar label: total done, the streak, and the last seven days as dots
 * (filled when something went in the jar that day).
 */
export function drawJarLabel(c: HTMLCanvasElement, done: number, streak: number, week: { label: string; done: number }[]) {
  c.width = 512;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 300);
  roundRect(g, 8, 8, 496, 284, 30);
  g.fillStyle = '#f7f1e3';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(60,45,20,0.3)';
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 80px ${HAND_FONT}`;
  g.fillText(done === 1 ? '1 done' : `${done} done`, 256, 70);
  g.font = `600 46px ${HAND_FONT}`;
  g.fillStyle = 'rgba(29,42,92,0.75)';
  g.fillText(streak > 1 ? `${streak}-day streak` : streak === 1 ? 'day 1 of a streak' : 'drop done things here', 256, 140);
  // the week
  const n = week.length;
  const span = 420, x0 = 256 - span / 2;
  week.forEach((d, i) => {
    const x = x0 + (span / (n - 1)) * i;
    g.beginPath();
    g.arc(x, 205, 19, 0, Math.PI * 2);
    if (d.done > 0) {
      g.fillStyle = i === n - 1 ? '#3a7bd5' : INK;
      g.fill();
    } else {
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(29,42,92,0.35)';
      g.stroke();
    }
    g.fillStyle = 'rgba(29,42,92,0.6)';
    g.font = ui(24);
    g.fillText(d.label, x, 252);
  });
}

// ---------------------------------------------------------------- coach ribbon

export const COACH_PX = { w: 1100, h: 200 };
export const COACH_M = { w: 0.5, h: 0.5 * (200 / 1100) };

/** A dark pill with one instruction line and one smaller reason line. */
export function drawCoach(c: HTMLCanvasElement, title: string, sub: string, step?: string) {
  c.width = COACH_PX.w;
  c.height = COACH_PX.h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  roundRect(g, 6, 6, c.width - 12, c.height - 12, 46);
  g.fillStyle = 'rgba(22,30,64,0.92)';
  g.fill();
  let x = 44;
  if (step) {
    g.beginPath();
    g.arc(x + 34, c.height / 2, 34, 0, Math.PI * 2);
    g.fillStyle = '#ffe27a';
    g.fill();
    g.fillStyle = '#16203f';
    g.font = ui(34, 700);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(step, x + 34, c.height / 2 + 1);
    x += 96;
  }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  let size = 46;
  g.font = ui(size, 700);
  while (g.measureText(title).width > c.width - x - 40 && size > 30) g.font = ui((size -= 2), 700);
  g.fillText(title, x, sub ? 76 : c.height / 2);
  if (sub) {
    g.fillStyle = 'rgba(255,255,255,0.72)';
    size = 32;
    g.font = ui(size, 500);
    while (g.measureText(sub).width > c.width - x - 40 && size > 22) g.font = ui((size -= 2), 500);
    g.fillText(sub, x, 138);
  }
}

// ---------------------------------------------------------------- slate

export function drawSlateBackground(c: HTMLCanvasElement, prompt: string, sub = '') {
  c.width = SLATE_PX.w;
  c.height = SLATE_PX.h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  roundRect(g, 4, 4, c.width - 8, c.height - 8, 36);
  g.fillStyle = '#fbf8f0';
  g.fill();
  g.save();
  g.clip();
  // ruled lines
  g.strokeStyle = 'rgba(70,110,180,0.16)';
  g.lineWidth = 3;
  for (let y = 190; y < c.height - 40; y += 92) {
    g.beginPath();
    g.moveTo(40, y);
    g.lineTo(c.width - 40, y);
    g.stroke();
  }
  grain(g, c.width, c.height, 3);
  g.restore();
  g.fillStyle = 'rgba(29,42,92,0.62)';
  g.font = `600 56px ${HAND_FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(prompt, 44, 62);
  if (sub) {
    g.fillStyle = 'rgba(29,42,92,0.45)';
    g.font = ui(30, 500);
    g.fillText(sub, 46, 118);
  }
}
