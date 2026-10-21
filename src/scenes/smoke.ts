import { blend } from '../draw';
import { clamp, noise, rand, range } from '../math';
import { spawn } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import { inRect, type World } from '../world';

const ITER = 18;
const VMAX = 45; // cells per second

/**
 * Fires along the bottom edge feeding a small stable-fluids sim at half the grid's
 * resolution. The prompt is a solid block the heat has to curl around.
 */
export function smokeFire(world: World): Scene {
  let fc = 0;
  let fr = 0;
  let S = 16; // fluid cell size in px
  let u = new Float32Array(0);
  let v = new Float32Array(0);
  let u0 = new Float32Array(0);
  let v0 = new Float32Array(0);
  let d = new Float32Array(0);
  let d0 = new Float32Array(0);
  let T = new Float32Array(0);
  let T0 = new Float32Array(0);
  let p = new Float32Array(0);
  let div = new Float32Array(0);
  let curl = new Float32Array(0);
  let solid = new Uint8Array(0);
  let fires: { x: number; w: number; seed: number }[] = [];
  let boost = 0;
  let sparkAcc = 0;

  const alloc = (n: number) => new Float32Array(n);

  function sampleField(f: Float32Array, x: number, y: number) {
    x = clamp(x, 0, fc - 1.001);
    y = clamp(y, 0, fr - 1.001);
    const x0 = x | 0;
    const y0 = y | 0;
    const sx = x - x0;
    const sy = y - y0;
    const i = y0 * fc + x0;
    const a = f[i] + (f[i + 1] - f[i]) * sx;
    const b = f[i + fc] + (f[i + fc + 1] - f[i + fc]) * sx;
    return a + (b - a) * sy;
  }

  function advect(dst: Float32Array, src: Float32Array, dt: number) {
    for (let y = 0; y < fr; y++) {
      for (let x = 0; x < fc; x++) {
        const i = y * fc + x;
        if (solid[i]) {
          dst[i] = 0;
          continue;
        }
        dst[i] = sampleField(src, x - dt * u[i], y - dt * v[i]);
      }
    }
  }

  function project() {
    for (let y = 1; y < fr - 1; y++) {
      for (let x = 1; x < fc - 1; x++) {
        const i = y * fc + x;
        div[i] = solid[i] ? 0 : -0.5 * (u[i + 1] - u[i - 1] + v[i + fc] - v[i - fc]);
        p[i] = 0;
      }
    }
    for (let k = 0; k < ITER; k++) {
      for (let y = 1; y < fr - 1; y++) {
        for (let x = 1; x < fc - 1; x++) {
          const i = y * fc + x;
          if (solid[i]) continue;
          const pc = p[i];
          // a solid or outside neighbour mirrors this cell, so nothing flows into it
          const l = solid[i - 1] ? pc : p[i - 1];
          const r = solid[i + 1] ? pc : p[i + 1];
          const t = solid[i - fc] ? pc : y === 1 ? 0 : p[i - fc];
          const b = solid[i + fc] || y === fr - 2 ? pc : p[i + fc];
          p[i] = (div[i] + l + r + t + b) * 0.25;
        }
      }
    }
    for (let y = 1; y < fr - 1; y++) {
      for (let x = 1; x < fc - 1; x++) {
        const i = y * fc + x;
        if (solid[i]) {
          u[i] = 0;
          v[i] = 0;
          continue;
        }
        u[i] -= 0.5 * (p[i + 1] - p[i - 1]);
        v[i] -= 0.5 * (p[i + fc] - p[i - fc]);
      }
    }
  }

  function vorticity(dt: number, eps: number) {
    for (let y = 1; y < fr - 1; y++) {
      for (let x = 1; x < fc - 1; x++) {
        const i = y * fc + x;
        curl[i] = 0.5 * (v[i + 1] - v[i - 1] - (u[i + fc] - u[i - fc]));
      }
    }
    for (let y = 2; y < fr - 2; y++) {
      for (let x = 2; x < fc - 2; x++) {
        const i = y * fc + x;
        const nx = 0.5 * (Math.abs(curl[i + 1]) - Math.abs(curl[i - 1]));
        const ny = 0.5 * (Math.abs(curl[i + fc]) - Math.abs(curl[i - fc]));
        const l = Math.hypot(nx, ny) + 1e-5;
        u[i] += dt * eps * (ny / l) * curl[i];
        v[i] -= dt * eps * (nx / l) * curl[i];
      }
    }
  }

  /** Heat, smoke and push in a soft blob around a fluid cell. */
  function splat(cx: number, cy: number, rad: number, heat: number, smoke: number, pu: number, pv: number) {
    const r = Math.ceil(rad);
    for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(fr - 2, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(fc - 2, Math.ceil(cx + r)); x++) {
        const i = y * fc + x;
        if (solid[i]) continue;
        const f = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / rad);
        if (f === 0) continue;
        T[i] += heat * f;
        d[i] += smoke * f;
        u[i] += pu * f;
        v[i] += pv * f;
      }
    }
  }

  const scene: Scene = {
    fog: 0.45,
    resize(world) {
      S = world.cell * 2;
      fc = Math.ceil(world.w / S) + 1;
      fr = Math.ceil(world.h / S) + 1;
      const n = fc * fr;
      [u, v, u0, v0, d, d0, T, T0, p, div, curl] = Array.from({ length: 11 }, () => alloc(n));
      solid = new Uint8Array(n);
      for (let y = 0; y < fr; y++) {
        for (let x = 0; x < fc; x++) if (inRect(world.ui, (x + 0.5) * S, (y + 0.5) * S, 2)) solid[y * fc + x] = 1;
      }
      const count = Math.max(3, Math.round(world.w / 150));
      fires = Array.from({ length: count }, (_, k) => ({
        x: ((k + 0.5 + range(-0.25, 0.25)) / count) * fc,
        w: range(1.6, 3),
        seed: rand() * 100,
      }));
    },
    update(dt, world) {
      dt = Math.min(dt, 1 / 30);
      const t = world.time;
      boost *= Math.exp(-dt * 1.4);

      for (const f of fires) {
        const flick = 0.45 + 0.9 * noise(t * 2.2, f.seed) * (1 + boost);
        const x = f.x + (noise(t * 0.7, f.seed + 9) - 0.5) * 2;
        splat(x, fr - 2.5, f.w, flick * dt * 7, flick * dt * 3, (noise(t * 3, f.seed + 3) - 0.5) * 30 * dt, -flick * 60 * dt);
      }
      const ptr = world.pointer;
      if (ptr.active && Math.hypot(ptr.vx, ptr.vy) > 30) {
        splat(ptr.x / S - 0.5, ptr.y / S - 0.5, 2.5, 0, 0, (ptr.vx / S) * 0.25, (ptr.vy / S) * 0.25);
      }

      const damp = Math.exp(-dt * 0.8);
      for (let y = 1; y < fr - 1; y++) {
        const wind = (noise(y * 0.08, t * 0.25) - 0.5) * 10 * dt;
        for (let x = 1; x < fc - 1; x++) {
          const i = y * fc + x;
          if (solid[i]) continue;
          v[i] -= dt * (T[i] * 24 - d[i] * 1.5);
          u[i] = clamp((u[i] + wind) * damp, -VMAX, VMAX);
          v[i] = clamp(v[i] * damp, -VMAX, VMAX);
        }
      }
      vorticity(dt, 1.6);
      project();
      u0.set(u);
      v0.set(v);
      // advect the velocity through itself, reading from the copies
      for (let y = 0; y < fr; y++) {
        for (let x = 0; x < fc; x++) {
          const i = y * fc + x;
          if (solid[i]) continue;
          const sx = x - dt * u0[i];
          const sy = y - dt * v0[i];
          u[i] = sampleField(u0, sx, sy);
          v[i] = sampleField(v0, sx, sy);
        }
      }
      project();
      for (let i = 0; i < u.length; i++) {
        u[i] = clamp(u[i], -VMAX, VMAX);
        v[i] = clamp(v[i], -VMAX, VMAX);
      }
      d0.set(d);
      T0.set(T);
      advect(d, d0, dt);
      advect(T, T0, dt);
      const kT = Math.exp(-dt * 1.15);
      const kd = Math.exp(-dt * 0.4);
      for (let i = 0; i < T.length; i++) {
        T[i] = Math.min(T[i] * kT, 2);
        d[i] = Math.min(d[i] * kd, 2);
      }
      // the top edge is open
      for (let x = 0; x < fc; x++) {
        d[x] = 0;
        T[x] = 0;
      }

      sparkAcc += dt * fires.length * (2.5 + boost * 20);
      while (sparkAcc >= 1) {
        sparkAcc -= 1;
        const f = fires[(rand() * fires.length) | 0];
        spawn((f.x + range(-1, 1) * f.w + 0.5) * S, world.h - range(1, 3) * S, range(-20, 20), -range(90, 220), range(0.6, 1.8), range(0.6, 1));
      }
    },
    raster(grid) {
      const { cols, rows, cell: C } = grid;
      for (let gy = 0; gy < rows; gy++) {
        const fy = ((gy + 0.5) * C) / S - 0.5;
        for (let gx = 0; gx < cols; gx++) {
          const fx = ((gx + 0.5) * C) / S - 0.5;
          const heat = sampleField(T, fx, fy);
          const smoke = sampleField(d, fx, fy);
          const c = clamp(heat * 1.5 + smoke * 0.5, 0, 1);
          if (c < 0.04) continue;
          blend(grid, gy * cols + gx, c, clamp(0.18 + smoke * 0.22 + heat * 0.85, 0, 1));
        }
      }
    },
    background: paintGrid,
    // sparks and loose dots ride the flow and keep rising
    force(pt, dt) {
      const fx = pt.x / S - 0.5;
      const fy = pt.y / S - 0.5;
      const k = Math.min(1, dt * 2.5);
      pt.vx += (sampleField(u, fx, fy) * S - pt.vx) * k;
      pt.vy += (sampleField(v, fx, fy) * S - pt.vy) * k - 40 * dt;
    },
    pointerDown(x, y) {
      const cx = x / S - 0.5;
      const cy = y / S - 0.5;
      splat(cx, cy, 3.5, 0.9, 1.4, 0, -12);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        splat(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, 2, 0, 0.3, Math.cos(a) * 25, Math.sin(a) * 25);
      }
    },
    input() {
      const f = fires[(rand() * fires.length) | 0];
      splat(f.x, fr - 3, f.w * 1.2, 0.8, 0.4, 0, -20);
    },
    submit(_text, world) {
      boost = 1.6;
      for (const f of fires) splat(f.x, fr - 3, f.w * 2, 1.4, 1.2, 0, -45);
      for (let k = 0; k < 90; k++) {
        spawn(rand() * world.w, world.h - range(0, 3) * S, range(-40, 40), -range(200, 420), range(0.8, 2), range(0.6, 1));
      }
    },
  };
  scene.resize(world);
  return scene;
}
