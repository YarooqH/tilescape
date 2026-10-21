export interface Rect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Per-frame raster target: one value per grid cell. */
export interface Grid {
  cell: number;
  cols: number;
  rows: number;
  /** 0..1, how much of the cell is covered */
  cov: Float32Array;
  /** 0..1, ink density of the covered part */
  dark: Float32Array;
  /** 0..1, falloff around the interface; 0 dissolves everything */
  fog: Float32Array;
  /** loose marks drawn after the cells, as (x, y, ink, size as a fraction of a cell) */
  dots: number[];
}

export interface Pointer {
  x: number;
  y: number;
  /** smoothed velocity in px/s */
  vx: number;
  vy: number;
  active: boolean;
  down: boolean;
}

export interface World {
  w: number;
  h: number;
  dpr: number;
  time: number;
  cell: number;
  /** the docked interface; parked off screen while it is hidden */
  ui: Rect;
  /** the solid card inside it */
  card: Rect;
  /** the largest open part of the screen, where a scene puts its centrepiece */
  view: Rect;
  pointer: Pointer;
}

/** Inside a rect grown by `pad` on every side. */
export const inRect = (r: Rect, x: number, y: number, pad = 0) =>
  Math.abs(x - r.cx) < r.w * 0.5 + pad && Math.abs(y - r.cy) < r.h * 0.5 + pad;
