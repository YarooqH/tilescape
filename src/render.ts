import { TAU, bayer, clamp, hash } from './math';
import { particles } from './particles';
import type { Backdrop } from './scene';
import type { Grid, World } from './world';

export type Mode = 'tiles' | 'ascii' | 'halftone';
export type RGB = [number, number, number];

const LEVELS = 24;
const MAX_LEVEL = LEVELS - 1;
const RAMP = ' .:-=+*#%@';
const toLevel = (v: number) => clamp(Math.round(v * MAX_LEVEL), 0, MAX_LEVEL);

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const rgba = ([r, g, b]: RGB, a = 1) => `rgba(${r},${g},${b},${a})`;

/**
 * Turns the coverage grid into marks. Every mark is bucketed by ink level so a frame
 * costs one fillStyle change per level instead of one per cell.
 */
export class Renderer {
  mode: Mode = 'tiles';
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');
  private readonly buckets: number[][] = Array.from({ length: LEVELS }, () => []);
  private palette: string[] = [];
  private paper: RGB = [255, 255, 255];
  private ink: RGB = [0, 0, 0];
  private core: RGB = [255, 255, 255];
  private C = 9;
  private dpr = 1;
  private tick = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /** `ramp` tints the marks from its first colour (faint) to its second (dense) instead of plain ink. */
  setTheme(paper: RGB, ink: RGB, core: RGB, ramp?: [RGB, RGB]) {
    this.paper = paper;
    this.core = core;
    // the backdrop's grid lines take the middle of the ramp
    this.ink = ramp ? mix(ramp[0], ramp[1], 0.5) : ink;
    this.palette = Array.from({ length: LEVELS }, (_, i) => {
      const t = i / MAX_LEVEL;
      return rgba(mix(paper, ramp ? mix(ramp[0], ramp[1], t) : ink, 0.05 + 0.95 * t));
    });
  }

  /** Scene backdrop (grid paper by default) plus the soft light behind the prompt, cached until resize, theme change or the scene asks. */
  paintBackground(world: World, grid: Grid, backdrop: Backdrop = paintGrid) {
    const { dpr, ui } = world;
    const bg = this.bg;
    // repaints can run every frame while a scene glides, so keep the buffer unless the size changed
    const bw = Math.round(world.w * dpr);
    const bh = Math.round(world.h * dpr);
    if (bg.width !== bw || bg.height !== bh) {
      bg.width = bw;
      bg.height = bh;
    }
    if (bg.width === 0 || bg.height === 0) return;
    const g = bg.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = rgba(this.paper);
    g.fillRect(0, 0, bg.width, bg.height);

    g.save();
    backdrop(g, world, grid, (a) => rgba(this.ink, a));
    g.restore();

    const r = Math.max(ui.w * 0.75, 260) * dpr;
    const glow = g.createRadialGradient(ui.cx * dpr, ui.cy * dpr, 0, ui.cx * dpr, ui.cy * dpr, r);
    glow.addColorStop(0, rgba(this.core, 1));
    glow.addColorStop(0.5, rgba(this.core, 0.75));
    glow.addColorStop(1, rgba(this.core, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, bg.width, bg.height);
  }

  draw(world: World, grid: Grid) {
    this.C = grid.cell;
    this.dpr = world.dpr;
    this.tick = Math.floor(world.time * 7);
    for (const b of this.buckets) b.length = 0;

    const { cols, rows, cov, dark, fog } = grid;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0, i = gy * cols; gx < cols; gx++, i++) {
        const c = cov[i];
        if (c === 0) continue;
        const f = fog[i];
        const ce = c * f;
        // ordered dither: thin edges and fogged cells break into scattered pixels
        if (ce < 0.98 && ce < bayer(gx, gy) * 0.95) continue;
        this.cell(gx, gy, dark[i] * (0.45 + 0.55 * f), ce);
      }
    }

    const C = this.C;
    for (const p of particles) {
      const gx = Math.floor(p.x / C);
      const gy = Math.floor(p.y / C);
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      const i = gy * cols + gx;
      if (cov[i] > 0.3) continue;
      let s = p.d * Math.min(1, p.life / (p.max * 0.6)) * Math.min(1, (p.max - p.life) * 6);
      if (!p.clear) s *= fog[i];
      if (s < 0.06) continue;
      this.dot(gx, gy, s, 0.24);
    }

    const { dots } = grid;
    for (let i = 0; i < dots.length; i += 4) {
      const gx = Math.floor(dots[i] / C);
      const gy = Math.floor(dots[i + 1] / C);
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      const s = dots[i + 2] * (0.35 + 0.65 * fog[gy * cols + gx]);
      if (s > 0.06) this.dot(gx, gy, s, dots[i + 3]);
    }

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bg.width > 0 && this.bg.height > 0) ctx.drawImage(this.bg, 0, 0);
    this.flush();
  }

  private cell(gx: number, gy: number, d: number, ce: number) {
    const C = this.C;
    const cx = (gx + 0.5) * C;
    const cy = (gy + 0.5) * C;
    if (this.mode === 'tiles') {
      const fill = Math.min(1, ce * 1.3);
      const size = C * (0.34 + 0.58 * fill);
      const x = cx - size * 0.5;
      const y = cy - size * 0.5;
      const lv = toLevel(d);
      this.rect(lv, x, y, size);
      if (fill > 0.6) {
        // a smaller chip in one corner gives each tile some grain, and flickers now and then
        const inner = size * 0.46;
        let corner = (hash(gx, gy + 91) * 4) | 0;
        if (hash(gx + this.tick, gy) > 0.9) corner ^= 3;
        const shift = hash(gx, gy) < 0.5 ? -5 : 4;
        this.rect(clamp(lv + shift, 0, MAX_LEVEL), x + (corner & 1 ? size - inner : 0), y + (corner & 2 ? size - inner : 0), inner);
      }
    } else if (this.mode === 'ascii') {
      const density = d * (0.45 + 0.55 * Math.min(1, ce * 1.3));
      let ch = clamp(Math.round(density * (RAMP.length - 1)), 1, RAMP.length - 1);
      if (hash(gx + this.tick, gy) > 0.88) ch = Math.max(1, ch - 1);
      this.glyph(toLevel(0.3 + 0.7 * d), cx, cy, ch);
    } else {
      const r = C * 0.5 * Math.sqrt(clamp(0.15 + 0.85 * d, 0, 1) * Math.min(1, ce * 1.2));
      this.circle(toLevel(Math.max(0.25, d)), cx, cy, r);
    }
  }

  private dot(gx: number, gy: number, s: number, frac: number) {
    const C = this.C;
    const cx = (gx + 0.5) * C;
    const cy = (gy + 0.5) * C;
    if (this.mode === 'tiles') {
      const size = C * frac;
      this.rect(toLevel(s), cx - size * 0.5, cy - size * 0.5, size);
    } else if (this.mode === 'ascii') {
      this.glyph(toLevel(0.25 + 0.75 * s), cx, cy, s > 0.6 ? 2 : 1);
    } else {
      this.circle(toLevel(Math.max(0.25, s)), cx, cy, C * frac * 0.5);
    }
  }

  // buckets hold device-pixel triplets: tiles (x, y, size), glyphs (x, y, ramp index), circles (x, y, r)
  private rect(lv: number, x: number, y: number, size: number) {
    const d = this.dpr;
    this.buckets[lv].push(Math.round(x * d), Math.round(y * d), Math.max(1, Math.round(size * d)));
  }

  private glyph(lv: number, x: number, y: number, ch: number) {
    this.buckets[lv].push(x * this.dpr, y * this.dpr, ch);
  }

  private circle(lv: number, x: number, y: number, r: number) {
    this.buckets[lv].push(x * this.dpr, y * this.dpr, Math.max(0.5, r * this.dpr));
  }

  private flush() {
    const ctx = this.ctx;
    if (this.mode === 'ascii') {
      ctx.font = `500 ${Math.round(this.C * 1.25 * this.dpr)}px "Geist Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }
    for (let lv = 0; lv < LEVELS; lv++) {
      const b = this.buckets[lv];
      if (b.length === 0) continue;
      ctx.fillStyle = this.palette[lv];
      if (this.mode === 'tiles') {
        for (let i = 0; i < b.length; i += 3) ctx.fillRect(b[i], b[i + 1], b[i + 2], b[i + 2]);
      } else if (this.mode === 'ascii') {
        for (let i = 0; i < b.length; i += 3) ctx.fillText(RAMP[b[i + 2]], b[i], b[i + 1]);
      } else {
        ctx.beginPath();
        for (let i = 0; i < b.length; i += 3) {
          ctx.moveTo(b[i] + b[i + 2], b[i + 1]);
          ctx.arc(b[i], b[i + 1], b[i + 2], 0, TAU);
        }
        ctx.fill();
      }
    }
  }
}

/** Default backdrop: faint lines every two cells, drawn in device pixels. */
export const paintGrid: Backdrop = (g, world, grid, ink) => {
  const { dpr } = world;
  const W = Math.round(world.w * dpr);
  const H = Math.round(world.h * dpr);
  g.fillStyle = ink(0.05);
  const step = grid.cell * 2;
  for (let x = 0; x <= world.w; x += step) g.fillRect(Math.round(x * dpr), 0, 1, H);
  for (let y = 0; y <= world.h; y += step) g.fillRect(0, Math.round(y * dpr), W, 1);
};
