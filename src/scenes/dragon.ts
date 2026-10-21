import { capsule, dot, fillShape, sample } from '../draw';
import { TAU, clamp, noise, range, smoothstep, wrapAngle } from '../math';
import { burst, spawn } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import { inRect, type World } from '../world';

const N = 60; // spine joints, head first
const WHISK = 7;

/** A long eastern dragon, seen from above, chasing a pearl around the prompt. */
export function dragon(world: World): Scene {
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  // whiskers: two verlet strands, current and previous positions
  const wx = [new Float32Array(WHISK), new Float32Array(WHISK)];
  const wy = [new Float32Array(WHISK), new Float32Array(WHISK)];
  const px0 = [new Float32Array(WHISK), new Float32Array(WHISK)];
  const py0 = [new Float32Array(WHISK), new Float32Array(WHISK)];
  let R = 12;
  let seg = 12;
  let ang = 0;
  let walk = 0;
  let pearlX = 0;
  let pearlY = 0;
  let tossX = 0;
  let tossY = 0;
  let toss = 0;
  let breath = 0;
  let excite = 0;
  let fireAcc = 0;

  /** Body radius along the spine, u = 0 at the head. */
  function radius(u: number) {
    if (u < 0.05) return R * 0.9;
    if (u < 0.12) return R * (0.68 + 0.32 * smoothstep(0.05, 0.12, u));
    return R * (0.12 + 0.88 * (1 - smoothstep(0.42, 1, u)));
  }

  /** Where the pearl is at time t: a squarish loop (superellipse) filling the open space. */
  function orbit(w: World, t: number, out: number[]) {
    const { view } = w;
    const c = Math.cos(t * 0.3);
    const s = Math.sin(t * 0.3);
    out[0] = view.cx + Math.sign(c) * Math.sqrt(Math.abs(c)) * Math.max(0, view.w / 2 - R * 5);
    out[1] = view.cy + Math.sign(s) * Math.sqrt(Math.abs(s)) * Math.max(0, view.h / 2 - R * 4);
  }

  function lay(w: World) {
    R = clamp(Math.min(w.w, w.h) * 0.034, 11, 24);
    seg = clamp(Math.min(w.w, w.h) * 1.3, 420, 980) / N;
    const o = [0, 0];
    orbit(w, w.time, o);
    pearlX = o[0];
    pearlY = o[1];
    ang = Math.PI;
    for (let i = 0; i < N; i++) {
      xs[i] = clamp(o[0] + R * 6 + i * seg, 0, w.w + N * seg);
      ys[i] = o[1] + Math.sin(i * 0.25) * R * 2;
    }
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < WHISK; k++) {
        wx[s][k] = px0[s][k] = xs[0] + k * R * 0.5;
        wy[s][k] = py0[s][k] = ys[0];
      }
    }
  }

  const scene: Scene = {
    fog: 0.5,
    resize(w) {
      lay(w);
    },
    update(dt, w) {
      dt = Math.min(dt, 1 / 30);
      const t = w.time;
      excite *= Math.exp(-dt * 1.5);
      breath = Math.max(0, breath - dt);
      toss = Math.max(0, toss - dt);

      // the pearl circles the prompt unless someone has thrown it
      const o = [0, 0];
      orbit(w, t, o);
      const tx = toss > 0 ? tossX : o[0];
      const ty = toss > 0 ? tossY : o[1];
      const pk = Math.min(1, dt * (toss > 0 ? 5 : 1.5));
      pearlX += (tx - pearlX) * pk;
      pearlY += (ty - pearlY) * pk;

      // head steering: toward the pearl, round it when close, weaving as it goes
      const hx = xs[0];
      const hy = ys[0];
      const dx = pearlX - hx;
      const dy = pearlY - hy;
      const dist = Math.hypot(dx, dy);
      let want = Math.atan2(dy, dx);
      if (dist < R * 6) want += Math.PI / 2 * (1 - dist / (R * 6)) * 1.2;
      want += Math.sin(t * 2.1) * 0.55 + (noise(t * 0.4, 3) - 0.5) * 0.8;
      if (inRect(w.card, hx, hy, R * 3)) want = Math.atan2(hy - w.card.cy, hx - w.card.cx);
      const m = R * 2;
      if (hx < m || hx > w.w - m || hy < m || hy > w.h - m) want = Math.atan2(pearlY - hy, pearlX - hx);
      const turn = (breath > 0 ? 1.4 : 3.2) * dt;
      ang += clamp(wrapAngle(want - ang), -turn, turn);
      const speed = clamp(dist * 1.1, R * 12, R * 26) * (1 + excite * 0.8) * (breath > 0 ? 0.55 : 1);
      xs[0] += Math.cos(ang) * speed * dt;
      ys[0] += Math.sin(ang) * speed * dt;
      walk += (speed * dt) / (R * 5);

      // the body follows the head's path at a fixed spacing
      for (let i = 1; i < N; i++) {
        const ex = xs[i] - xs[i - 1];
        const ey = ys[i] - ys[i - 1];
        const d = Math.hypot(ex, ey) || 1;
        xs[i] = xs[i - 1] + (ex / d) * seg;
        ys[i] = ys[i - 1] + (ey / d) * seg;
      }

      // whiskers trail from the snout
      const fx = Math.cos(ang);
      const fy = Math.sin(ang);
      for (let s = 0; s < 2; s++) {
        const side = s ? 1 : -1;
        const X = wx[s];
        const Y = wy[s];
        X[0] = xs[0] + fx * R * 1.7 - fy * side * R * 0.35;
        Y[0] = ys[0] + fy * R * 1.7 + fx * side * R * 0.35;
        for (let k = 1; k < WHISK; k++) {
          const vx = (X[k] - px0[s][k]) * 0.9;
          const vy = (Y[k] - py0[s][k]) * 0.9;
          px0[s][k] = X[k];
          py0[s][k] = Y[k];
          const curl = Math.sin(t * 3 + k * 0.8 + s) * 40;
          X[k] += vx + (-fy * side * 60 + -fy * curl) * dt * dt;
          Y[k] += vy + (fx * side * 60 + fx * curl) * dt * dt;
        }
        const L = R * 0.6;
        for (let it = 0; it < 2; it++) {
          for (let k = 1; k < WHISK; k++) {
            const ex = X[k] - X[k - 1];
            const ey = Y[k] - Y[k - 1];
            const d = Math.hypot(ex, ey) || 1;
            X[k] = X[k - 1] + (ex / d) * L;
            Y[k] = Y[k - 1] + (ey / d) * L;
          }
        }
      }

      if (breath > 0) {
        fireAcc += dt * 110;
        const mx = xs[0] + fx * R * 2;
        const my = ys[0] + fy * R * 2;
        while (fireAcc >= 1) {
          fireAcc -= 1;
          const a = ang + range(-0.22, 0.22);
          const v = range(280, 480);
          spawn(mx, my, Math.cos(a) * v, Math.sin(a) * v, range(0.45, 1.05), range(0.75, 1));
        }
      }
    },
    raster(grid, w) {
      const C = grid.cell;
      const t = w.time;
      const fx = Math.cos(ang);
      const fy = Math.sin(ang);

      // the pearl, with a few motes circling it
      const pr = R * 0.95;
      fillShape(grid, pearlX - pr - C, pearlY - pr - C, pearlX + pr + C, pearlY + pr + C, (x, y) => {
        const dx = (x - pearlX) / pr;
        const dy = (y - pearlY) / pr;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) return -1;
        const nz = Math.sqrt(1 - d2);
        const lit = clamp(-dx * 0.5 - dy * 0.5 + nz * 0.7, 0, 1);
        sample.cov = 0.5 + 0.5 * lit;
        return 0.55 + 0.45 * lit;
      });
      for (let k = 0; k < 6; k++) {
        const a = t * 1.3 + (k / 6) * TAU;
        const rr = pr * (1.9 + 0.3 * Math.sin(t * 2 + k));
        dot(grid, pearlX + Math.cos(a) * rr, pearlY + Math.sin(a) * rr, 0.6, 0.22);
      }

      // legs go under the body
      for (const j of [Math.round(N * 0.17), Math.round(N * 0.47)]) {
        const bx = xs[j - 1] - xs[j + 1];
        const by = ys[j - 1] - ys[j + 1];
        const bl = Math.hypot(bx, by) || 1;
        const dx = bx / bl;
        const dy = by / bl;
        const r = radius(j / N);
        for (const side of [-1, 1]) {
          const nx = -dy * side;
          const ny = dx * side;
          const ph = walk + (side > 0 ? 0 : Math.PI) + (j > N * 0.3 ? Math.PI : 0);
          const swing = Math.sin(ph);
          const hipX = xs[j] + nx * r * 0.6;
          const hipY = ys[j] + ny * r * 0.6;
          const footX = xs[j] + nx * r * 2.6 + dx * swing * r * 1.4;
          const footY = ys[j] + ny * r * 2.6 + dy * swing * r * 1.4;
          const kneeX = (hipX + footX) / 2 + nx * r * 0.5 - dx * r * 0.6;
          const kneeY = (hipY + footY) / 2 + ny * r * 0.5 - dy * r * 0.6;
          capsule(grid, hipX, hipY, kneeX, kneeY, r * 0.42, r * 0.3, 0.62);
          capsule(grid, kneeX, kneeY, footX, footY, r * 0.3, r * 0.22, 0.62);
          for (let c = -1; c <= 1; c++) {
            const ca = Math.atan2(dy, dx) + c * 0.45 + side * 0.4;
            capsule(grid, footX, footY, footX + Math.cos(ca) * r * 0.75, footY + Math.sin(ca) * r * 0.75, r * 0.14, r * 0.03, 0.95);
          }
        }
      }

      // tail tuft
      {
        const k = N - 1;
        const dx = xs[k] - xs[k - 1];
        const dy = ys[k] - ys[k - 1];
        const base = Math.atan2(dy, dx);
        for (let f = -2; f <= 2; f++) {
          const a = base + f * 0.28 + Math.sin(t * 2.4 + f) * 0.15;
          const L = R * (2.4 - Math.abs(f) * 0.35);
          capsule(grid, xs[k], ys[k], xs[k] + Math.cos(a) * L, ys[k] + Math.sin(a) * L, R * 0.3, R * 0.04, 0.55);
        }
      }

      // body, tail first so the neck lies on top
      for (let i = N - 1; i > 1; i--) {
        capsule(grid, xs[i], ys[i], xs[i - 1], ys[i - 1], radius(i / N), radius((i - 1) / N), 0.5);
      }
      // scales: a staggered pair of glints per joint
      for (let i = 3; i < N - 4; i++) {
        const dx = xs[i - 1] - xs[i + 1];
        const dy = ys[i - 1] - ys[i + 1];
        const d = Math.hypot(dx, dy) || 1;
        const r = radius(i / N);
        const off = i % 2 ? 0.52 : 0.3;
        for (const side of [-1, 1]) {
          dot(grid, xs[i] - (dy / d) * r * off * side, ys[i] + (dx / d) * r * off * side, 0.82, 0.2);
        }
      }
      // spine ridge with backward-swept spikes
      for (let i = 3; i < N - 3; i++) {
        const r = radius(i / N);
        capsule(grid, xs[i], ys[i], xs[i + 1], ys[i + 1], r * 0.18, radius((i + 1) / N) * 0.18, 0.88);
        if (i % 2 === 0 && i < N * 0.85) {
          const dx = xs[i + 1] - xs[i];
          const dy = ys[i + 1] - ys[i];
          const d = Math.hypot(dx, dy) || 1;
          capsule(grid, xs[i], ys[i], xs[i] + (dx / d) * r * 1.1, ys[i] + (dy / d) * r * 1.1, r * 0.34, r * 0.02, 0.95);
        }
      }
      // mane along the neck
      for (let i = 2; i < 11; i++) {
        const dx = xs[i - 1] - xs[i + 1];
        const dy = ys[i - 1] - ys[i + 1];
        const d = Math.hypot(dx, dy) || 1;
        const r = radius(i / N);
        for (const side of [-1, 1]) {
          const nx = (-dy / d) * side;
          const ny = (dx / d) * side;
          const flow = Math.sin(t * 3 + i * 0.7 + side) * 0.35;
          const ex = nx * r * 1.6 - (dx / d) * r * (1 + flow);
          const ey = ny * r * 1.6 - (dy / d) * r * (1 + flow);
          capsule(grid, xs[i], ys[i], xs[i] + ex, ys[i] + ey, r * 0.22, r * 0.03, 0.5);
        }
      }

      // head
      const hx = xs[0];
      const hy = ys[0];
      const nx = -fy;
      const ny = fx;
      capsule(grid, hx - fx * R * 0.4, hy - fy * R * 0.4, hx + fx * R * 0.7, hy + fy * R * 0.7, R * 1.05, R * 0.8, 0.58);
      capsule(grid, hx + fx * R * 0.6, hy + fy * R * 0.6, hx + fx * R * 1.9, hy + fy * R * 1.9, R * 0.62, R * 0.4, 0.6);
      // brow ridges
      for (const side of [-1, 1]) {
        capsule(grid, hx + fx * R * 0.9 + nx * side * R * 0.45, hy + fy * R * 0.9 + ny * side * R * 0.45, hx - fx * R * 0.2 + nx * side * R * 0.7, hy - fy * R * 0.2 + ny * side * R * 0.7, R * 0.2, R * 0.12, 0.88);
      }
      // horns sweep back
      for (const side of [-1, 1]) {
        const sway = Math.sin(t * 1.3 + side) * 0.08;
        const bx = hx - fx * R * 0.3 + nx * side * R * 0.55;
        const by = hy - fy * R * 0.3 + ny * side * R * 0.55;
        const mx = bx - fx * R * 1.3 + nx * side * R * (0.7 + sway);
        const my = by - fy * R * 1.3 + ny * side * R * (0.7 + sway);
        const ex = mx - fx * R * 1.1 + nx * side * R * 0.1;
        const ey = my - fy * R * 1.1 + ny * side * R * 0.1;
        capsule(grid, bx, by, mx, my, R * 0.28, R * 0.18, 0.95);
        capsule(grid, mx, my, ex, ey, R * 0.18, R * 0.03, 0.95);
      }
      // whiskers
      for (let s = 0; s < 2; s++) {
        for (let k = 1; k < WHISK; k++) {
          const f = k / WHISK;
          capsule(grid, wx[s][k - 1], wy[s][k - 1], wx[s][k], wy[s][k], R * 0.13 * (1 - f) + 0.6, R * 0.13 * (1 - f * 0.9) * 0.8 + 0.4, 0.8);
        }
      }
      for (const side of [-1, 1]) {
        dot(grid, hx + fx * R * 0.55 + nx * side * R * 0.5, hy + fy * R * 0.55 + ny * side * R * 0.5, 1, 0.38);
        dot(grid, hx + fx * R * 1.8 + nx * side * R * 0.22, hy + fy * R * 1.8 + ny * side * R * 0.22, 0.9, 0.18);
      }
    },
    background: paintGrid,
    force(p, dt) {
      // flames and smoke slow down and rise
      const k = Math.exp(-dt * 1.6);
      p.vx *= k;
      p.vy = p.vy * k - 30 * dt;
    },
    pointerDown(x, y, w) {
      tossX = clamp(x, R * 2, w.w - R * 2);
      tossY = clamp(y, R * 2, w.h - R * 2);
      toss = 4;
      excite = 1;
      burst(x, y, 10, 50, 0.6);
    },
    input() {
      // a snort of smoke from the nostrils
      excite = Math.min(1, excite + 0.15);
      const fx = Math.cos(ang);
      const fy = Math.sin(ang);
      for (const side of [-1, 1]) {
        const x = xs[0] + fx * R * 1.9 - fy * side * R * 0.25;
        const y = ys[0] + fy * R * 1.9 + fx * side * R * 0.25;
        spawn(x, y, fx * 90 - fy * side * 30, fy * 90 + fx * side * 30, range(0.5, 0.9), 0.4);
      }
    },
    submit() {
      breath = 2.4;
      excite = 1;
    },
  };
  scene.resize(world);
  return scene;
}
