import { clamp } from './math';
import type { Grid } from './world';

/** Composite one cell, near over far: call in back-to-front order. */
export function blend(grid: Grid, i: number, c: number, v: number) {
  const { cov, dark } = grid;
  if (cov[i] === 0) dark[i] = v;
  else dark[i] += (v - dark[i]) * c;
  if (c > cov[i]) cov[i] = c;
}

/** A loose mark snapped to the grid, drawn smaller than a full cell. */
export function dot(grid: Grid, x: number, y: number, ink: number, size = 0.3) {
  grid.dots.push(x, y, ink, size);
}

/** `shade` may lower this for the current sample to make that point partly transparent. */
export const sample = { cov: 1 };

/**
 * Supersample any shape 2x2 per cell inside a box. `shade` returns ink for a point
 * inside the shape and a negative number outside.
 */
export function fillShape(grid: Grid, x0: number, y0: number, x1: number, y1: number, shade: (x: number, y: number) => number, alpha = 1) {
  const { cell: C, cols, rows } = grid;
  const c0 = Math.max(0, Math.floor(x0 / C));
  const c1 = Math.min(cols - 1, Math.floor(x1 / C));
  const r0 = Math.max(0, Math.floor(y0 / C));
  const r1 = Math.min(rows - 1, Math.floor(y1 / C));
  const q = C * 0.25;
  for (let gy = r0; gy <= r1; gy++) {
    const py = (gy + 0.5) * C;
    for (let gx = c0; gx <= c1; gx++) {
      const px = (gx + 0.5) * C;
      let n = 0;
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sample.cov = 1;
        const v = shade(px + (k & 1 ? q : -q), py + (k & 2 ? q : -q));
        if (v < 0) continue;
        n += sample.cov;
        sum += v * sample.cov;
      }
      if (n > 0.01) blend(grid, gy * cols + gx, n * 0.25 * alpha, sum / n);
    }
  }
}

/**
 * A tapered line with analytic coverage, so strokes thinner than a cell fade into
 * dithered dots instead of vanishing.
 */
export function capsule(grid: Grid, ax: number, ay: number, bx: number, by: number, ra: number, rb: number, ink: number, alpha = 1) {
  const { cell: C, cols, rows } = grid;
  const pad = Math.max(ra, rb) + C;
  const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad) / C));
  const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + pad) / C));
  const r0 = Math.max(0, Math.floor((Math.min(ay, by) - pad) / C));
  const r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + pad) / C));
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey || 1;
  const invC = 1 / C;
  for (let gy = r0; gy <= r1; gy++) {
    const py = (gy + 0.5) * C;
    for (let gx = c0; gx <= c1; gx++) {
      const px = (gx + 0.5) * C;
      const t = clamp(((px - ax) * ex + (py - ay) * ey) / l2, 0, 1);
      const dx = px - ax - ex * t;
      const dy = py - ay - ey * t;
      const r = ra + (rb - ra) * t;
      const c = clamp((r - Math.sqrt(dx * dx + dy * dy)) * invC + 0.5, 0, 1) * alpha;
      if (c > 0.02) blend(grid, gy * cols + gx, c, ink);
    }
  }
}
