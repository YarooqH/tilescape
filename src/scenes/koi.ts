import { blend, capsule, dot, fillShape } from '../draw';
import { TAU, clamp, noise, rand, range, seeded, wrapAngle } from '../math';
import { burst } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import { inRect, type World } from '../world';

type Pattern = 'kohaku' | 'showa' | 'ogon' | 'tancho';

interface Koi {
  x: number;
  y: number;
  heading: number;
  speed: number;
  phase: number;
  len: number;
  scale: number;
  seed: number;
  pattern: Pattern;
  joints: number[]; // x, y pairs, head first
}

interface Pellet {
  x: number;
  y: number;
  age: number;
}

interface Pad {
  x: number;
  y: number;
  r: number;
  rot: number;
  flower: boolean;
}

const N = 16;

/** A koi pond seen from above: ripples that bounce off the prompt, fish that come for food. */
export function koiPond(world: World): Scene {
  let cols = 0;
  let rows = 0;
  let cell = 8;
  let h0 = new Float32Array(0);
  let h1 = new Float32Array(0);
  let wall = new Uint8Array(0);
  let acc = 0;
  let rain = 1.5;
  // where the pointer last dropped a ring; it leaves spaced rings, not a solid wake
  let dropX = NaN;
  let dropY = NaN;
  let baseLen = 100;
  const fish: Koi[] = [];
  const pellets: Pellet[] = [];
  let pads: Pad[] = [];

  function disturb(x: number, y: number, amt: number, rad = 1) {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const X = gx + dx;
        const Y = gy + dy;
        if (X < 1 || Y < 1 || X >= cols - 1 || Y >= rows - 1) continue;
        const f = 1 - Math.hypot(dx, dy) / (rad + 1);
        if (f > 0) h0[Y * cols + X] += amt * f;
      }
    }
  }

  function stepWater() {
    // h1 holds the previous state and receives the next one
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (wall[i]) {
          h1[i] = 0;
          continue;
        }
        h1[i] = ((h0[i - 1] + h0[i + 1] + h0[i - cols] + h0[i + cols]) * 0.5 - h1[i]) * 0.975;
      }
    }
    const t = h0;
    h0 = h1;
    h1 = t;
  }

  function makeKoi(world: World): Koi {
    const patterns: Pattern[] = ['kohaku', 'kohaku', 'showa', 'ogon', 'tancho'];
    const scale = range(0.75, 1.15);
    let x = 0;
    let y = 0;
    do {
      x = range(0.1, 0.9) * world.w;
      y = range(0.1, 0.9) * world.h;
    } while (inRect(world.card, x, y, 60));
    const heading = rand() * TAU;
    const k: Koi = { x, y, heading, speed: 40, phase: rand() * TAU, len: 0, scale, seed: rand() * 100, pattern: patterns[(rand() * patterns.length) | 0], joints: [] };
    k.len = baseLen * scale;
    for (let i = 0; i < N; i++) k.joints.push(x - Math.cos(heading) * (k.len * i) / (N - 1), y - Math.sin(heading) * (k.len * i) / (N - 1));
    return k;
  }

  function radius(k: Koi, s: number) {
    const m = k.len * 0.115;
    return s < 0.25 ? m * (0.72 + (s / 0.25) * 0.28) : m * (1 - ((s - 0.25) / 0.75) * 0.84);
  }

  function drawKoi(grid: Parameters<Scene['raster']>[0], k: Koi) {
    const J = k.joints;
    const L = k.len;
    const flap = Math.sin(k.phase * 0.5);
    // fins first so the body sits over them
    const hx = J[6] - J[0];
    const hy = J[7] - J[1];
    const hl = Math.hypot(hx, hy) || 1;
    const bx = hx / hl;
    const by = hy / hl;
    const nx = -by;
    const ny = bx;
    for (const side of [-1, 1]) {
      const r = radius(k, 0.2);
      const fx = J[6] + nx * side * r * 0.8;
      const fy = J[7] + ny * side * r * 0.8;
      const sw = 0.6 + 0.25 * flap * side;
      const ex = fx + (nx * side * Math.cos(sw) + bx * Math.sin(sw)) * L * 0.17;
      const ey = fy + (ny * side * Math.cos(sw) + by * Math.sin(sw)) * L * 0.17;
      capsule(grid, fx, fy, ex, ey, L * 0.04, L * 0.012, 0.45, 0.6);
    }
    const tx = J[2 * (N - 1)];
    const ty = J[2 * (N - 1) + 1];
    const ta = Math.atan2(ty - J[2 * (N - 3) + 1], tx - J[2 * (N - 3)]);
    for (const side of [-1, 1]) {
      const a = ta + side * (0.42 + 0.12 * flap * side) + Math.sin(k.phase) * 0.25;
      capsule(grid, tx, ty, tx + Math.cos(a) * L * 0.24, ty + Math.sin(a) * L * 0.24, L * 0.045, L * 0.015, 0.4, 0.65);
    }

    const base = k.pattern === 'showa' ? 0.82 : k.pattern === 'ogon' ? 0.58 : 0.26;
    const spot = k.pattern === 'showa' ? 0.25 : 0.88;
    for (let i = 0; i < N - 1; i++) {
      const s0 = i / (N - 1);
      const s1 = (i + 1) / (N - 1);
      capsule(grid, J[2 * i], J[2 * i + 1], J[2 * i + 2], J[2 * i + 3], radius(k, s0), radius(k, s1), base);
    }
    // patches ride on top, pushed to one side or the other
    for (let i = 1; i < N - 3; i++) {
      const s = i / (N - 1);
      let on: boolean;
      if (k.pattern === 'ogon') on = false;
      else if (k.pattern === 'tancho') on = i === 2;
      else on = noise(i * 0.42 + k.seed, 1.7) > 0.52;
      if (!on) continue;
      const x = J[2 * i];
      const y = J[2 * i + 1];
      const dx = J[2 * i + 2] - x;
      const dy = J[2 * i + 3] - y;
      const l = Math.hypot(dx, dy) || 1;
      const off = (noise(i * 0.31 + k.seed, 6.1) - 0.5) * radius(k, s) * 1.1;
      const px = x + (-dy / l) * off;
      const py = y + (dx / l) * off;
      const r = radius(k, s) * (k.pattern === 'tancho' ? 0.7 : 0.75);
      capsule(grid, px, py, px + dx * 0.9, py + dy * 0.9, r, r, spot);
    }
    // eyes
    const er = radius(k, 0.05) * 0.7;
    dot(grid, J[0] - bx * er * 0.4 + nx * er, J[1] - by * er * 0.4 + ny * er, 0.9, 0.22);
    dot(grid, J[0] - bx * er * 0.4 - nx * er, J[1] - by * er * 0.4 - ny * er, 0.9, 0.22);
  }

  function steer(k: Koi, dt: number, world: World) {
    let want = k.heading + (noise(world.time * 0.22, k.seed) - 0.5) * 2.2;
    let urgency = 0.9;
    let target: Pellet | null = null;
    let best = (300 * k.scale) ** 2;
    for (const p of pellets) {
      const d = (p.x - k.x) ** 2 + (p.y - k.y) ** 2;
      if (d < best) {
        best = d;
        target = p;
      }
    }
    if (target) {
      want = Math.atan2(target.y - k.y, target.x - k.x);
      urgency = 2.4;
    }
    const m = 70;
    if (k.x < m || k.x > world.w - m || k.y < m || k.y > world.h - m) {
      want = Math.atan2(world.h / 2 - k.y, world.w / 2 - k.x);
      urgency = 1.6;
    }
    if (inRect(world.card, k.x, k.y, 46)) {
      want = Math.atan2(k.y - world.card.cy, k.x - world.card.cx);
      urgency = 2.4;
    }
    for (const o of fish) {
      if (o === k) continue;
      const dx = k.x - o.x;
      const dy = k.y - o.y;
      if (dx * dx + dy * dy < (k.len * 0.4) ** 2) want += wrapAngle(Math.atan2(dy, dx) - want) * 0.3;
    }
    const turn = clamp(wrapAngle(want - k.heading), -urgency * dt, urgency * dt);
    k.heading += turn;
    const target_v = (target ? 75 : 36) * k.scale;
    k.speed += (target_v - k.speed) * Math.min(1, dt * 1.2);
    k.phase += dt * (3 + k.speed * 0.06);
    const a = k.heading + Math.sin(k.phase) * 0.22;
    k.x += Math.cos(a) * k.speed * dt;
    k.y += Math.sin(a) * k.speed * dt;
    const J = k.joints;
    J[0] = k.x;
    J[1] = k.y;
    const seg = k.len / (N - 1);
    for (let i = 1; i < N; i++) {
      const dx = J[2 * i] - J[2 * i - 2];
      const dy = J[2 * i + 1] - J[2 * i - 1];
      const l = Math.hypot(dx, dy) || 1;
      J[2 * i] = J[2 * i - 2] + (dx / l) * seg;
      J[2 * i + 1] = J[2 * i - 1] + (dy / l) * seg;
    }
    if (target && Math.hypot(target.x - k.x, target.y - k.y) < radius(k, 0) * 1.6) {
      pellets.splice(pellets.indexOf(target), 1);
      disturb(k.x, k.y, 1.2, 1);
    }
    disturb(k.x, k.y, k.speed * 0.0005, 0);
  }

  const scene: Scene = {
    fog: 0.5,
    resize(world) {
      cell = world.cell;
      cols = Math.ceil(world.w / cell);
      rows = Math.ceil(world.h / cell);
      h0 = new Float32Array(cols * rows);
      h1 = new Float32Array(cols * rows);
      wall = new Uint8Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) if (inRect(world.card, (x + 0.5) * cell, (y + 0.5) * cell, 2)) wall[y * cols + x] = 1;
      }
      baseLen = clamp(Math.min(world.w, world.h) * 0.27, 110, 220);
      const want = world.w < 700 ? 4 : 6;
      if (fish.length !== want) {
        fish.length = 0;
        for (let i = 0; i < want; i++) fish.push(makeKoi(world));
      }
      for (const k of fish) k.len = baseLen * k.scale;

      const r = seeded(5);
      const count = clamp(Math.round((world.w * world.h) / 160000), 2, 6);
      pads = [];
      for (let tries = 0; pads.length < count && tries < 200; tries++) {
        const pr = clamp(Math.min(world.w, world.h) * 0.045, 18, 40) * (0.7 + r() * 0.5);
        const x = r() * world.w;
        const y = r() * world.h;
        if (inRect(world.ui, x, y, pr + 20)) continue;
        if (pads.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + pr + 10)) continue;
        pads.push({ x, y, r: pr, rot: r() * TAU, flower: r() < 0.3 });
      }
    },
    update(dt, world) {
      acc += dt;
      let n = 0;
      while (acc >= 1 / 60 && n < 3) {
        acc -= 1 / 60;
        stepWater();
        n++;
      }
      if (n === 3) acc = 0;
      rain -= dt;
      if (rain <= 0) {
        rain = range(2, 5);
        disturb(rand() * world.w, rand() * world.h, range(1.4, 2.4), 2);
      }
      const p = world.pointer;
      const sp = Math.hypot(p.vx, p.vy);
      if (p.active && sp > 220 && !(Math.hypot(p.x - dropX, p.y - dropY) < cell * 3)) {
        disturb(p.x, p.y, Math.min(0.5, sp * 0.0005), 0);
        dropX = p.x;
        dropY = p.y;
      }
      for (const k of fish) steer(k, dt, world);
      for (let i = pellets.length - 1; i >= 0; i--) {
        pellets[i].age += dt;
        if (pellets[i].age > 14) pellets.splice(i, 1);
      }
      for (const pad of pads) pad.rot += dt * 0.03 * Math.sin(world.time * 0.2 + pad.x);
    },
    raster(grid) {
      // ripples: only the faces tilted toward the light leave ink
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          const i = y * cols + x;
          const s = h0[i - 1] - h0[i + 1] + h0[i - cols] - h0[i + cols];
          const v = clamp(s * 2, 0, 1);
          if (v > 0.08 && i < grid.cov.length) blend(grid, i, v * 0.6, 0.3 + 0.4 * v);
        }
      }
      for (const p of pellets) dot(grid, p.x, p.y, 0.85 * (1 - p.age / 14), 0.38);
      const order = [...fish].sort((a, b) => a.scale - b.scale);
      for (const k of order) drawKoi(grid, k);
      for (const pad of pads) {
        const ext = pad.r + grid.cell;
        fillShape(grid, pad.x - ext, pad.y - ext, pad.x + ext, pad.y + ext, (x, y) => {
          const dx = x - pad.x;
          const dy = y - pad.y;
          const d = Math.hypot(dx, dy);
          if (d > pad.r) return -1;
          const a = wrapAngle(Math.atan2(dy, dx) - pad.rot);
          if (Math.abs(a) < 0.22 * (d / pad.r)) return -1;
          if (d > pad.r * 0.88) return 0.7;
          return Math.abs(Math.sin(a * 6)) < 0.12 * (pad.r / (d + 4)) + 0.03 ? 0.3 : 0.52;
        });
        if (pad.flower) {
          const fx = pad.x + Math.cos(pad.rot + Math.PI) * pad.r * 0.35;
          const fy = pad.y + Math.sin(pad.rot + Math.PI) * pad.r * 0.35;
          const pr = pad.r * 0.32;
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * TAU + pad.rot;
            capsule(grid, fx, fy, fx + Math.cos(a) * pr, fy + Math.sin(a) * pr, pr * 0.15, pr * 0.32, 0.12);
          }
          dot(grid, fx, fy, 0.9, 0.4);
        }
      }
    },
    background: paintGrid,
    pointerDown(x, y) {
      for (let k = 0; k < 7; k++) {
        const a = rand() * TAU;
        const r = range(4, 28);
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        pellets.push({ x: px, y: py, age: 0 });
        disturb(px, py, 1.2, 1);
      }
      while (pellets.length > 40) pellets.shift();
      burst(x, y, 10, 50, 0.5);
    },
    input(world) {
      disturb(rand() * world.w, rand() * world.h, range(1.2, 2), 1);
    },
    submit(_text, world) {
      const { card } = world;
      const per = 2 * (card.w + card.h);
      for (let d = 0; d < per; d += cell * 3) {
        let x: number;
        let y: number;
        if (d < card.w) [x, y] = [card.cx - card.w / 2 + d, card.cy - card.h / 2 - cell * 2];
        else if (d < card.w + card.h) [x, y] = [card.cx + card.w / 2 + cell * 2, card.cy - card.h / 2 + d - card.w];
        else if (d < 2 * card.w + card.h) [x, y] = [card.cx + card.w / 2 - (d - card.w - card.h), card.cy + card.h / 2 + cell * 2];
        else [x, y] = [card.cx - card.w / 2 - cell * 2, card.cy + card.h / 2 - (d - 2 * card.w - card.h)];
        disturb(x, y, 2.2, 1);
      }
    },
  };
  scene.resize(world);
  return scene;
}
