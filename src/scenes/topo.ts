import { blend, dot } from '../draw';
import { clamp, fbm, hash, noise, range, smoothstep } from '../math';
import { burst } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import { textMask } from '../type';
import type { World } from '../world';

/** contour lines per unit of height */
const LEVELS = 13;
const SEA = 0.34;
const HILLS = 8;

interface Hill {
  x: number;
  y: number;
  r: number;
  amp: number;
  age: number;
  life: number;
}

/** A contour map of slowly drifting terrain. The interface sits on a mesa, so the lines ring it. */
export function topographic(world: World): Scene {
  let cols = 0;
  let rows = 0;
  let height = new Float32Array(0);
  let word: Float32Array | null = null;
  let wordAge = 0;
  /** how far the word has risen right now */
  let wordK = 0;
  const hills: Hill[] = [];
  /** the hill under a held pointer keeps rising */
  let raising: Hill | null = null;
  let time = 0;

  const envelope = (age: number, rise: number, stay: number, fall: number) =>
    smoothstep(0, rise, age) * (1 - smoothstep(rise + stay, rise + stay + fall, age));

  function terrain(world: World) {
    const { cell: C, card } = world;
    const drift = time * 0.012;
    wordK = word ? 0.32 * envelope(wordAge, 1.6, 5, 2.4) : 0;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        const x = (gx + 0.5) * C;
        const y = (gy + 0.5) * C;
        const u = x * 0.0032 + drift;
        const v = y * 0.0032 - drift * 0.6;
        let h = fbm(u, v) * 0.85 + noise(u * 4.1 + 9, v * 4.1) * 0.15;
        // a flat-topped rise under the card
        const dx = Math.max(0, Math.abs(x - card.cx) - card.w * 0.5);
        const dy = Math.max(0, Math.abs(y - card.cy) - card.h * 0.5);
        h += 0.2 * (1 - smoothstep(0, 170, Math.hypot(dx, dy)));
        for (const k of hills) {
          const d2 = ((x - k.x) ** 2 + (y - k.y) ** 2) / (k.r * k.r);
          if (d2 < 9) h += k.amp * envelope(k.age, 0.8, k.life - 4.8, 4) * Math.exp(-d2);
        }
        if (wordK > 0 && word) h += wordK * word[i];
        height[i] = h;
      }
    }
  }

  function addHill(x: number, y: number, amp: number) {
    if (hills.length >= HILLS) hills.shift();
    const h = { x, y, r: range(60, 110), amp, age: 0, life: range(22, 28) };
    hills.push(h);
    return h;
  }

  /** a cheap 2-pass box blur, so a word rises with sloped sides and gets nested rings */
  function soften(m: Float32Array, r: number) {
    const tmp = new Float32Array(m.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= cols) continue;
          s += m[y * cols + xx];
          n++;
        }
        tmp[y * cols + x] = s / n;
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= rows) continue;
          s += tmp[yy * cols + x];
          n++;
        }
        m[y * cols + x] = s / n;
      }
    }
    return m;
  }

  const scene: Scene = {
    fog: 0.5,
    resize(world) {
      const c = Math.ceil(world.w / world.cell);
      const r = Math.ceil(world.h / world.cell);
      if (c === cols && r === rows) return;
      cols = c;
      rows = r;
      height = new Float32Array(cols * rows);
      word = null;
    },
    update(dt, world) {
      time += dt;
      wordAge += dt;
      if (word && wordAge > 10) word = null;
      for (let i = hills.length - 1; i >= 0; i--) {
        const h = hills[i];
        h.age += dt;
        if (h.age > h.life) hills.splice(i, 1);
      }
      const p = world.pointer;
      if (raising && p.down && hills.includes(raising)) raising.amp = Math.min(0.42, raising.amp + dt * 0.1);
      else raising = null;
      terrain(world);
    },
    raster(grid) {
      if (grid.cols !== cols || grid.rows !== rows) return;
      const H = height;
      const raised = wordK > 0 ? word : null;
      for (let gy = 1; gy < rows - 1; gy++) {
        for (let gx = 1; gx < cols - 1; gx++) {
          const i = gy * cols + gx;
          const h = H[i];
          if (h < SEA) {
            // open water: sparse diagonal hatching that thickens with depth
            const deep = clamp((SEA - h) / 0.12, 0, 1);
            if ((gx + gy) % 3 === 0 && hash(gx, gy) < 0.35 + deep * 0.5) blend(grid, i, 0.35 + deep * 0.3, 0.3 + deep * 0.2);
            // the shoreline is drawn as a heavier contour
            const ds = Math.hypot(H[i + 1] - H[i - 1], H[i + cols] - H[i - cols]) * 0.5;
            if (ds > 1e-4 && (SEA - h) / ds < 0.9) blend(grid, i, 1, 0.75);
            continue;
          }
          // the raised word is shaded like a plateau on a printed map, so it reads between the rings
          if (raised && raised[i] * wordK > 0.14 && (gx + gy) % 2 === 0) blend(grid, i, 0.6, 0.4);
          const v = h * LEVELS;
          const g = Math.hypot(H[i + 1] - H[i - 1], H[i + cols] - H[i - cols]) * 0.5 * LEVELS;
          if (g < 1e-4) continue;
          const n = Math.round(v);
          const index = n % 5 === 0;
          // distance to the nearest contour in cells, from the local slope
          const dist = Math.abs(v - n) / g;
          const w = index ? 1.05 : 0.7;
          if (dist >= w) continue;
          blend(grid, i, Math.min(1, 1.5 * (1 - dist / w)), index ? 0.86 : 0.5);
        }
      }
      // survey marks on the summits people raised
      for (const k of hills) {
        const a = envelope(k.age, 0.8, k.life - 4.8, 4);
        if (a > 0.2) dot(grid, k.x, k.y, 0.9 * a, 0.42);
      }
    },
    background: paintGrid,
    pointerDown(px, py) {
      raising = addHill(px, py, 0.1);
      burst(px, py, 8, 40, 0.5);
    },
    input(world) {
      const { view } = world;
      addHill(view.cx + range(-0.45, 0.45) * view.w, view.cy + range(-0.45, 0.45) * view.h, range(0.05, 0.1));
    },
    submit(text, world) {
      const { view, cell: C } = world;
      const mask = textMask(text, cols, rows, view.cx / C, view.cy / C, (view.w * 0.82) / C, (view.h * 0.5) / C, 22);
      if (!mask) return;
      word = soften(mask, 1);
      wordAge = 0;
    },
  };
  scene.resize(world);
  return scene;
}
