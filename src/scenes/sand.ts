import { blend } from '../draw';
import { clamp, fbm, noise, rand, range, smoothstep } from '../math';
import { burst } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import { textMask } from '../type';
import { inRect, type World } from '../world';

const STEP = 1 / 50;
/** steps a grain still counts as falling after it last moved */
const SETTLE = 6;
/** for grains dropping into a word, in cells per second */
const GRAVITY = 140;
const TERMINAL = 70;

/** a grain on its way down to its place in a word; it skips the pile until it lands */
interface Drop {
  x: number;
  y: number;
  v: number;
  to: number;
  wait: number;
  tone: number;
}

/** Falling sand, one grain per cell: it pours from the top, heaps on the interface and slides off its edges. */
export function fallingSand(world: World): Scene {
  let cols = 0;
  let rows = 0;
  let cell = 8;
  /** 0 is empty; anything else is a grain and its tone */
  let grain = new Uint8Array(0);
  let wall = new Uint8Array(0);
  let moving = new Uint8Array(0);
  /** grains frozen into the shape of a sent word */
  let held = new Uint8Array(0);
  let hold = 0;
  const drops: Drop[] = [];
  let count = 0;
  let open = 1;
  let acc = 0;
  let flip = 0;
  let time = 0;
  const streams = [
    { seed: 3, rate: 1 },
    { seed: 11, rate: 0.8 },
    { seed: 29, rate: 0.6 },
  ];

  const free = (i: number) => grain[i] === 0 && wall[i] === 0;
  const tone = () => 1 + ((rand() * 254) | 0);

  function put(x: number, y: number) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const i = y * cols + x;
    if (!free(i)) return;
    grain[i] = tone();
    moving[i] = SETTLE;
    count++;
  }

  function buildWall(world: World) {
    wall = new Uint8Array(cols * rows);
    open = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (inRect(world.card, (x + 0.5) * cell, (y + 0.5) * cell, 2)) {
          wall[i] = 1;
          // sand caught where the interface now stands is swept away; what sat on top falls
          if (grain[i]) {
            grain[i] = 0;
            count--;
          }
        } else open++;
      }
    }
  }

  /** a few low dunes so the scene doesn't start empty */
  function dunes() {
    const s = rand() * 100;
    for (let x = 0; x < cols; x++) {
      const h = Math.round((0.06 + 0.2 * fbm(x * 0.03, s)) * rows);
      for (let y = rows - 1; y >= rows - h; y--) put(x, y);
    }
    moving.fill(0);
  }

  function step() {
    flip ^= 1;
    for (let k = drops.length - 1; k >= 0; k--) {
      const d = drops[k];
      if (d.wait > 0) {
        d.wait -= STEP;
        continue;
      }
      d.v = Math.min(TERMINAL, d.v + GRAVITY * STEP);
      d.y += d.v * STEP;
      if (d.y < d.to) continue;
      const i = d.to * cols + d.x;
      drops.splice(k, 1);
      if (wall[i]) continue;
      if (grain[i] === 0) {
        grain[i] = d.tone;
        count++;
      }
      held[i] = 1;
      moving[i] = 0;
    }
    for (let y = rows - 2; y >= 0; y--) {
      for (let k = 0; k < cols; k++) {
        const x = flip ? k : cols - 1 - k;
        const i = y * cols + x;
        if (grain[i] === 0 || held[i]) continue;
        const below = i + cols;
        let to = -1;
        if (free(below)) to = below;
        else {
          const d = rand() < 0.5 ? -1 : 1;
          if (x + d >= 0 && x + d < cols && free(below + d)) to = below + d;
          else if (x - d >= 0 && x - d < cols && free(below - d)) to = below - d;
        }
        if (to < 0) {
          if (moving[i] > 0) moving[i]--;
          continue;
        }
        grain[to] = grain[i];
        moving[to] = SETTLE;
        grain[i] = 0;
        moving[i] = 0;
      }
    }

    // pours drift along the top and stop now and then
    for (const s of streams) {
      const on = smoothstep(0.38, 0.55, noise(time * 0.08, s.seed + 50));
      if (rand() > s.rate * on) continue;
      const x = Math.round((0.06 + 0.88 * noise(time * 0.04, s.seed)) * (cols - 1));
      put(x + Math.round(range(-1, 1)), 0);
    }

    const p = world.pointer;
    if (p.down && p.active) {
      const gx = Math.floor(p.x / cell);
      const gy = Math.floor(p.y / cell);
      for (let k = 0; k < 3; k++) put(gx + Math.round(range(-1.5, 1.5)), gy + Math.round(range(-1, 1)));
    } else if (p.active && Math.hypot(p.vx, p.vy) > 260) blow(p.x, p.y, p.vx, p.vy);

    // the floor drains slowly once the screen is about a third full, so the pile never fills it
    const cap = open * 0.3;
    const drain = count > cap ? 2 + Math.min(6, (count - cap) / (cols * 4)) : 0;
    for (let k = 0; k < drain; k++) {
      const i = (rows - 1) * cols + ((rand() * cols) | 0);
      if (grain[i] && !held[i]) {
        grain[i] = 0;
        count--;
      }
    }
  }

  /** a fast pointer kicks grains up and along the way it is moving */
  function blow(px: number, py: number, vx: number, vy: number) {
    const gx = Math.floor(px / cell);
    const gy = Math.floor(py / cell);
    const s = Math.hypot(vx, vy);
    const dx = vx / s;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const x = gx + ox;
        const y = gy + oy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const i = y * cols + x;
        if (grain[i] === 0 || held[i]) continue;
        const tx = clamp(x + Math.round(dx * range(1, 4)), 0, cols - 1);
        const ty = clamp(y - Math.round(range(1, 4)), 0, rows - 1);
        const j = ty * cols + tx;
        if (!free(j)) continue;
        grain[j] = grain[i];
        moving[j] = SETTLE;
        grain[i] = 0;
        moving[i] = 0;
      }
    }
  }

  const scene: Scene = {
    // sand resting on the interface should stay visible right up to its edge
    fog: 0.2,
    resize(world) {
      const c = Math.ceil(world.w / world.cell);
      const r = Math.ceil(world.h / world.cell);
      if (c !== cols || r !== rows || world.cell !== cell) {
        cell = world.cell;
        cols = c;
        rows = r;
        grain = new Uint8Array(cols * rows);
        moving = new Uint8Array(cols * rows);
        held = new Uint8Array(cols * rows);
        count = 0;
        drops.length = 0;
        buildWall(world);
        dunes();
      } else buildWall(world);
    },
    update(dt) {
      if (dt === 0) return;
      time += dt;
      // the word only starts to wear once every grain has landed
      if (hold > 0 && drops.length === 0) {
        hold -= dt;
        if (hold <= 0) held.fill(0);
      }
      acc = Math.min(acc + dt, STEP * 4);
      while (acc >= STEP) {
        acc -= STEP;
        step();
      }
    },
    raster(grid) {
      if (grid.cols !== cols || grid.rows !== rows) return;
      // deeper grains read darker, so dunes get some body
      for (let x = 0; x < cols; x++) {
        let depth = 0;
        for (let y = 0, i = x; y < rows; y++, i += cols) {
          const g = grain[i];
          if (g === 0) {
            depth = 0;
            continue;
          }
          const t = g / 255;
          if (held[i]) blend(grid, i, 1, 0.82 + t * 0.18);
          else if (moving[i] > 0) blend(grid, i, 0.55, 0.3 + t * 0.2);
          else {
            depth++;
            blend(grid, i, 1, 0.34 + Math.min(depth, 14) * 0.028 + t * 0.14);
          }
        }
      }
      for (const d of drops) {
        if (d.wait > 0 || d.y < 0) continue;
        const i = Math.floor(d.y) * cols + d.x;
        blend(grid, i, 0.8, 0.55 + (d.tone / 255) * 0.2);
        // a short streak behind the fast ones
        if (d.v > 30 && d.y >= 1) blend(grid, i - cols, 0.35, 0.35);
      }
    },
    background: paintGrid,
    pointerDown(px, py) {
      const gx = Math.floor(px / cell);
      const gy = Math.floor(py / cell);
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (ox * ox + oy * oy <= 5) put(gx + ox, gy + oy);
      burst(px, py, 10, 50, 0.5);
    },
    input() {
      const x = (rand() * cols) | 0;
      for (let k = 0; k < 6; k++) put(x + Math.round(range(-2, 2)), (rand() * 2) | 0);
    },
    submit(text, world) {
      const { view } = world;
      // the word forms high in the open space so it has room to fall
      const mask = textMask(text, cols, rows, view.cx / cell, (view.cy - view.h * 0.18) / cell, (view.w * 0.86) / cell, (view.h * 0.4) / cell, 18);
      if (!mask) return;
      // a word already standing lets go, and the new one rains down into place, bottom rows first
      held.fill(0);
      drops.length = 0;
      let top = rows;
      let bottom = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] < 0.45 || wall[i]) continue;
        const y = (i / cols) | 0;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      const span = Math.max(1, bottom - top);
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] < 0.45 || wall[i]) continue;
        const y = (i / cols) | 0;
        drops.push({ x: i % cols, y: -range(1, 6), v: range(0, 10), to: y, wait: ((bottom - y) / span) * 0.9 + rand() * 0.35, tone: tone() });
      }
      hold = 4.5;
    },
  };
  scene.resize(world);
  return scene;
}
