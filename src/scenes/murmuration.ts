import { blend, capsule } from '../draw';
import { clamp, noise, rand, range } from '../math';
import { burst } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import { inRect, type World } from '../world';

const R = 26; // neighbour radius and hash cell size
const SEP = 14;
const VMIN = 80;
const VMAX = 175;

interface Hawk {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/** Starlings: a few thousand boids drawn as density, so the flock reads as one shape. */
export function murmuration(world: World): Scene {
  let n = 0;
  let x = new Float32Array(0);
  let y = new Float32Array(0);
  let vx = new Float32Array(0);
  let vy = new Float32Array(0);
  let head = new Int32Array(0);
  let next = new Int32Array(0);
  let bw = 0;
  let bh = 0;
  let dens = new Float32Array(0);
  let targets: number[] = [];
  let spell = 0;
  const hawks: Hawk[] = [];
  let ax = 0;
  let ay = 0;

  function seed(world: World) {
    n = world.w < 700 ? 900 : 1800;
    x = new Float32Array(n);
    y = new Float32Array(n);
    vx = new Float32Array(n);
    vy = new Float32Array(n);
    next = new Int32Array(n);
    const cx = world.w * 0.25;
    const cy = world.h * 0.25;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * Math.min(world.w, world.h) * 0.15;
      x[i] = cx + Math.cos(a) * r;
      y[i] = cy + Math.sin(a) * r;
      vx[i] = 120 + range(-20, 20);
      vy[i] = range(-20, 20);
    }
  }

  function spellOut(text: string, world: World) {
    const { view } = world;
    const c = document.createElement('canvas');
    c.width = Math.ceil(world.w);
    c.height = Math.ceil(world.h);
    const g = c.getContext('2d');
    if (!g) return;
    const words = (text.trim() || 'hello').split(/\s+/);
    while (words.length > 1 && words.join(' ').length > 48) words.pop();
    if (words[0].length > 48) words[0] = words[0].slice(0, 48);
    const font = (s: number) => `700 ${s}px Geist, system-ui, sans-serif`;
    g.font = font(100);
    const widthOf = (from: number, to: number) => g.measureText(words.slice(from, to).join(' ')).width;

    // try one to three lines and keep whichever lets the letters be biggest
    let lines = [words.join(' ')];
    let size = 0;
    for (let L = 1; L <= Math.min(3, words.length); L++) {
      let best: number[] = [];
      let bestW = Infinity;
      const nw = words.length;
      for (let a = 1; a <= (L > 1 ? nw - L + 1 : 1); a++) {
        for (let b = L > 2 ? a + 1 : nw; b <= (L > 2 ? nw - 1 : nw); b++) {
          const cuts = L === 1 ? [0, nw] : L === 2 ? [0, a, nw] : [0, a, b, nw];
          let w = 0;
          for (let k = 0; k < L; k++) w = Math.max(w, widthOf(cuts[k], cuts[k + 1]));
          if (w < bestW) {
            bestW = w;
            best = cuts;
          }
        }
      }
      const s = Math.min(140, (view.w * 0.86 * 100) / bestW, (view.h * 0.62) / (L * 1.15));
      // an extra line has to earn its place, or short phrases break up for nothing
      if (s > size * 1.15) {
        size = s;
        lines = best.slice(0, -1).map((from, k) => words.slice(from, best[k + 1]).join(' '));
      }
    }

    // there are only so many birds: shrink the type until they can cover every stroke
    const ink = () => {
      g.clearRect(0, 0, c.width, c.height);
      g.font = font(size);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#000';
      lines.forEach((line, k) => g.fillText(line, view.cx, view.cy + (k - (lines.length - 1) / 2) * size * 1.15));
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    let data = ink();
    const area = () => {
      let a = 0;
      for (let i = 3; i < data.length; i += 16) if (data[i] > 128) a += 4;
      return a;
    };
    const most = n * 36;
    const a = area();
    if (a > most) {
      size *= Math.sqrt(most / a);
      data = ink();
    }
    const step = Math.max(3, Math.sqrt(area() / n));

    targets = [];
    for (let py = 0; py < c.height; py += step) {
      for (let px = 0; px < c.width; px += step) {
        if (data[((py | 0) * c.width + (px | 0)) * 4 + 3] > 128) targets.push(px, py);
      }
    }
    if (targets.length) spell = Math.min(11, 7 + lines.join('').length * 0.08);
  }

  const scene: Scene = {
    fog: 0.55,
    resize(world) {
      if (n !== (world.w < 700 ? 900 : 1800)) seed(world);
      bw = Math.ceil(world.w / R) + 2;
      bh = Math.ceil(world.h / R) + 2;
      head = new Int32Array(bw * bh);
    },
    update(dt, world) {
      dt = Math.min(dt, 1 / 30);
      const t = world.time;
      const { card } = world;
      // the flock chases a point that loops around the prompt
      ax = world.w / 2 + Math.cos(t * 0.17) * world.w * 0.3 + (noise(t * 0.2, 1) - 0.5) * world.w * 0.12;
      ay = world.h / 2 + Math.sin(t * 0.26) * world.h * 0.27 + (noise(t * 0.2, 7) - 0.5) * world.h * 0.12;
      spell = Math.max(0, spell - dt);

      head.fill(-1);
      for (let i = 0; i < n; i++) {
        const bx = clamp(Math.floor(x[i] / R) + 1, 0, bw - 1);
        const by = clamp(Math.floor(y[i] / R) + 1, 0, bh - 1);
        const b = by * bw + bx;
        next[i] = head[b];
        head[b] = i;
      }

      for (let i = 0; i < n; i++) {
        const px = x[i];
        const py = y[i];
        const bx = clamp(Math.floor(px / R) + 1, 0, bw - 1);
        const by = clamp(Math.floor(py / R) + 1, 0, bh - 1);
        let sx = 0;
        let sy = 0;
        let mx = 0;
        let my = 0;
        let cx = 0;
        let cy = 0;
        let k = 0;
        for (let oy = -1; oy <= 1 && k < 14; oy++) {
          const yy = by + oy;
          if (yy < 0 || yy >= bh) continue;
          for (let ox = -1; ox <= 1 && k < 14; ox++) {
            const xx = bx + ox;
            if (xx < 0 || xx >= bw) continue;
            for (let j = head[yy * bw + xx]; j !== -1 && k < 14; j = next[j]) {
              if (j === i) continue;
              const dx = px - x[j];
              const dy = py - y[j];
              const d2 = dx * dx + dy * dy;
              if (d2 > R * R) continue;
              const d = Math.sqrt(d2) || 0.01;
              if (d < SEP) {
                const f = 1 - d / SEP;
                sx += (dx / d) * f;
                sy += (dy / d) * f;
              }
              mx += vx[j];
              my += vy[j];
              cx += x[j];
              cy += y[j];
              k++;
            }
          }
        }
        let ux = vx[i];
        let uy = vy[i];
        const sepK = spell > 0 ? 90 : 650;
        ux += sx * sepK * dt;
        uy += sy * sepK * dt;
        if (spell > 0 && targets.length) {
          // spread the birds evenly over the letters, so no stroke is left empty
          const ti = Math.floor((i * targets.length) / 2 / n) * 2;
          const f = Math.min(1, spell);
          ux += ((targets[ti] - px) * 4 - ux) * dt * 6 * f;
          uy += ((targets[ti + 1] - py) * 4 - uy) * dt * 6 * f;
        } else {
          if (k > 0) {
            ux += (mx / k - ux) * dt * 1.6;
            uy += (my / k - uy) * dt * 1.6;
            ux += (cx / k - px) * dt * 0.85;
            uy += (cy / k - py) * dt * 0.85;
          }
          // each third of the flock aims a little off the shared point, which stretches the shape
          const lag = (i % 3) - 1;
          const tx = ax + lag * 70 * Math.cos(t * 0.5);
          const ty = ay + lag * 50 * Math.sin(t * 0.4);
          const dx = tx - px;
          const dy = ty - py;
          const d = Math.hypot(dx, dy) || 1;
          ux += (dx / d) * 70 * dt;
          uy += (dy / d) * 70 * dt;
        }
        if (inRect(card, px, py, 26)) {
          const dx = px - card.cx;
          const dy = py - card.cy;
          const d = Math.hypot(dx, dy) || 1;
          ux += (dx / d) * 500 * dt;
          uy += (dy / d) * 500 * dt;
        }
        const m = 40;
        if (px < m) ux += 300 * dt;
        if (px > world.w - m) ux -= 300 * dt;
        if (py < m) uy += 300 * dt;
        if (py > world.h - m) uy -= 300 * dt;
        for (const h of hawks) {
          const dx = px - h.x;
          const dy = py - h.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 140 * 140) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / 140) * 1500 * dt;
            ux += (dx / d) * f;
            uy += (dy / d) * f;
          }
        }
        const s = Math.hypot(ux, uy) || 1;
        const vmax = spell > 0 ? VMAX * 2 : VMAX;
        const c = s > vmax ? vmax / s : s < VMIN && spell === 0 ? VMIN / s : 1;
        vx[i] = ux * c;
        vy[i] = uy * c;
      }
      for (let i = 0; i < n; i++) {
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
      }

      for (let i = hawks.length - 1; i >= 0; i--) {
        const h = hawks[i];
        h.age += dt;
        // dive at whichever starling is closest to where the hawk is heading
        let best = 1e12;
        let bx = ax;
        let by = ay;
        for (let j = 0; j < n; j += 7) {
          const d = (x[j] - h.x) ** 2 + (y[j] - h.y) ** 2;
          if (d < best) {
            best = d;
            bx = x[j];
            by = y[j];
          }
        }
        const leave = h.age > 5;
        const dx = leave ? h.x - world.w / 2 : bx - h.x;
        const dy = leave ? h.y - world.h / 2 : by - h.y;
        const d = Math.hypot(dx, dy) || 1;
        h.vx += ((dx / d) * 280 - h.vx) * dt * 2;
        h.vy += ((dy / d) * 280 - h.vy) * dt * 2;
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        if (leave && (h.x < -60 || h.y < -60 || h.x > world.w + 60 || h.y > world.h + 60)) hawks.splice(i, 1);
      }
    },
    raster(grid, world) {
      const { cell: C, cols, rows } = grid;
      if (dens.length !== cols * rows) dens = new Float32Array(cols * rows);
      else dens.fill(0);
      for (let i = 0; i < n; i++) {
        // splat each bird over the four nearest cells
        const fx = x[i] / C - 0.5;
        const fy = y[i] / C - 0.5;
        const gx = Math.floor(fx);
        const gy = Math.floor(fy);
        const sx = fx - gx;
        const sy = fy - gy;
        if (gx < 0 || gy < 0 || gx >= cols - 1 || gy >= rows - 1) continue;
        const j = gy * cols + gx;
        dens[j] += (1 - sx) * (1 - sy);
        dens[j + 1] += sx * (1 - sy);
        dens[j + cols] += (1 - sx) * sy;
        dens[j + cols + 1] += sx * sy;
      }
      for (let i = 0; i < dens.length; i++) {
        const v = dens[i];
        if (v < 0.12) continue;
        blend(grid, i, clamp(v * 0.45, 0, 1), clamp(0.45 + v * 0.1, 0, 1));
      }
      for (const h of hawks) {
        const s = Math.hypot(h.vx, h.vy) || 1;
        const fx = h.vx / s;
        const fy = h.vy / s;
        const flap = Math.sin(world.time * 14) * 0.35;
        const L = C * 2.6;
        capsule(grid, h.x + fx * L * 0.5, h.y + fy * L * 0.5, h.x - fx * L * 0.6, h.y - fy * L * 0.6, C * 0.55, C * 0.3, 0.95);
        for (const side of [-1, 1]) {
          const wx = -fy * side;
          const wy = fx * side;
          const tipx = h.x + (wx * (1 + flap) - fx * 0.7) * L;
          const tipy = h.y + (wy * (1 + flap) - fy * 0.7) * L;
          capsule(grid, h.x, h.y, tipx, tipy, C * 0.45, C * 0.12, 0.95);
        }
      }
    },
    background: paintGrid,
    pointerDown(px, py) {
      if (hawks.length >= 3) hawks.shift();
      hawks.push({ x: px, y: py, vx: 0, vy: 0, age: 0 });
      burst(px, py, 12, 60, 0.6);
    },
    input() {
      // a shiver runs through the flock
      if (spell > 0) return;
      let j = (rand() * n) | 0;
      const px = x[j];
      const py = y[j];
      for (j = 0; j < n; j++) {
        const dx = x[j] - px;
        const dy = y[j] - py;
        const d = Math.hypot(dx, dy);
        if (d < 90 && d > 0) {
          vx[j] += (dx / d) * 120 * (1 - d / 90);
          vy[j] += (dy / d) * 120 * (1 - d / 90);
        }
      }
    },
    submit(text, world) {
      spellOut(text, world);
    },
  };
  scene.resize(world);
  return scene;
}
