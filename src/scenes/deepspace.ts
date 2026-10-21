import { blend, capsule, dot, fillShape, sample } from '../draw';
import { TAU, clamp, fbm, noise, rand, range, seeded, smoothstep } from '../math';
import { burst, spawn } from '../particles';
import type { Scene } from '../scene';
import type { World } from '../world';

interface Star {
  x: number;
  y: number;
  /** 0 far .. 1 near: sets parallax, drift and brightness */
  z: number;
  tw: number;
}

interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  spin: number;
  seed: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

interface Nova {
  x: number;
  y: number;
  age: number;
}

const SCALE = 170; // px per nebula noise unit

/** Drifting through deep space: layered stars that follow the cursor, a slow nebula, asteroids. */
export function deepSpace(world: World): Scene {
  let stars: Star[] = [];
  const rocks: Rock[] = [];
  const meteors: Meteor[] = [];
  const novas: Nova[] = [];
  let neb = new Float32Array(0);
  let nebInk = new Float32Array(0);
  let nebCols = 0;
  let frame = 0;
  let ox = 0;
  let oy = 0;
  let warp = 0;
  let travel = 0;
  let nextMeteor = 2;

  function nebula(cols: number, rows: number, C: number, t: number, row0: number, step: number) {
    for (let gy = row0; gy < rows; gy += step) {
      for (let gx = 0; gx < cols; gx++) {
        const x = ((gx + 0.5) * C - ox * 0.15) / SCALE + travel * 0.05;
        const y = ((gy + 0.5) * C - oy * 0.15) / SCALE;
        // domain warp: the noise looks up its own position through more noise
        const qx = fbm(x * 0.8 + t * 0.012, y * 0.8);
        const qy = fbm(x * 0.8 + 5.2, y * 0.8 - t * 0.01);
        const d = fbm(x + 2.4 * qx, y + 2.4 * qy);
        const mask = smoothstep(0.36, 0.66, noise(x * 0.3 + 3.1, y * 0.3 + 9.7));
        const fine = noise(x * 4.3 + qx * 3, y * 4.3);
        const i = gy * cols + gx;
        neb[i] = smoothstep(0.43, 0.8, d * 0.85 + fine * 0.15) * mask;
        nebInk[i] = 0.12 + 0.45 * smoothstep(0.55, 0.8, d) + 0.15 * fine;
      }
    }
  }

  function addRock(world: World, edge: boolean) {
    const r = range(0.025, 0.05) * Math.min(world.w, world.h) + world.cell;
    const ang = range(-0.5, 0.5) + (rand() < 0.5 ? 0 : Math.PI);
    const v = range(6, 16);
    rocks.push({
      x: edge ? (Math.cos(ang) > 0 ? -r * 2 : world.w + r * 2) : rand() * world.w,
      y: rand() * world.h,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v,
      r,
      rot: rand() * TAU,
      spin: range(-0.4, 0.4),
      seed: rand() * 100,
    });
  }

  const scene: Scene = {
    fog: 0.45,
    resize(world) {
      const r = seeded(31);
      const n = Math.round((world.w * world.h) / 2600);
      stars = Array.from({ length: n }, () => ({ x: r() * world.w, y: r() * world.h, z: r() * r(), tw: 0 }));
      nebCols = Math.ceil(world.w / world.cell);
      const rows = Math.ceil(world.h / world.cell);
      neb = new Float32Array(nebCols * rows);
      nebInk = new Float32Array(nebCols * rows);
      nebula(nebCols, rows, world.cell, world.time, 0, 1);
      const want = world.w < 700 ? 2 : 4;
      while (rocks.length < want) addRock(world, false);
      rocks.length = want;
    },
    update(dt, world) {
      const p = world.pointer;
      const k = Math.min(1, dt * 1.5);
      ox += ((p.active ? p.x - world.w / 2 : 0) - ox) * k;
      oy += ((p.active ? p.y - world.h / 2 : 0) - oy) * k;
      warp *= Math.exp(-dt * 0.9);
      travel += dt * (1 + warp * 30);
      for (const s of stars) s.tw *= Math.exp(-dt * 2.5);

      for (const r of rocks) {
        r.x += r.vx * dt * (1 + warp * 6);
        r.y += r.vy * dt;
        r.rot += r.spin * dt;
        const m = r.r * 2.5;
        if (r.x < -m || r.x > world.w + m || r.y < -m || r.y > world.h + m) {
          r.x = r.vx > 0 ? -m + 1 : world.w + m - 1;
          r.y = rand() * world.h;
        }
      }

      nextMeteor -= dt;
      if (nextMeteor <= 0) {
        nextMeteor = range(2.5, 6);
        const dir = rand() < 0.5 ? 1 : -1;
        const v = range(620, 900);
        const a = range(0.35, 0.75);
        meteors.push({ x: rand() * world.w, y: range(-0.1, 0.4) * world.h, vx: Math.cos(a) * v * dir, vy: Math.sin(a) * v, age: 0, life: range(0.5, 0.9) });
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.age += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (rand() < dt * 40) spawn(m.x, m.y, m.vx * 0.03, m.vy * 0.03, range(0.3, 0.8), 0.45);
        if (m.age > m.life) meteors.splice(i, 1);
      }
      for (let i = novas.length - 1; i >= 0; i--) {
        novas[i].age += dt;
        if (novas[i].age > 3) novas.splice(i, 1);
      }
    },
    raster(grid, world) {
      const { cell: C, cols, rows } = grid;
      const t = world.time;
      if (cols !== nebCols || neb.length !== cols * rows) {
        nebCols = cols;
        neb = new Float32Array(cols * rows);
        nebInk = new Float32Array(cols * rows);
        nebula(cols, rows, C, t, 0, 1);
      } else {
        // half the rows each frame; the nebula moves slowly enough that nobody can tell
        nebula(cols, rows, C, t, frame & 1, 2);
      }
      frame++;
      for (let i = 0; i < neb.length; i++) if (neb[i] > 0.03) blend(grid, i, neb[i] * 0.62, nebInk[i]);

      for (const r of rocks) {
        const ext = r.r * 1.35;
        const cr = Math.cos(r.rot);
        const sr = Math.sin(r.rot);
        fillShape(grid, r.x - ext, r.y - ext, r.x + ext, r.y + ext, (x, y) => {
          const dx = x - r.x;
          const dy = y - r.y;
          const u = dx * cr + dy * sr;
          const v = -dx * sr + dy * cr;
          const d = Math.hypot(u, v);
          const ang = Math.atan2(v, u);
          const edge = r.r * (0.78 + 0.45 * noise(Math.cos(ang) * 1.4 + r.seed, Math.sin(ang) * 1.4 + r.seed));
          if (d > edge) return -1;
          const f = d / edge;
          const nz = Math.sqrt(1 - f * f);
          // lit from the upper left
          const lam = (-dx / edge) * 0.55 + (-dy / edge) * 0.45 + nz * 0.7;
          const lit = smoothstep(-0.1, 0.7, lam);
          const crater = fbm(u / r.r * 2.2 + r.seed, v / r.r * 2.2);
          sample.cov = 0.25 + 0.75 * lit;
          return clamp(0.35 + 0.35 * lit + (crater - 0.5) * 0.6, 0, 1);
        });
      }

      // stars: near ones move more with the cursor and the drift
      const W = world.w + 40;
      const H = world.h + 40;
      for (const s of stars) {
        const z = 0.15 + s.z * 0.85;
        let x = (s.x - ox * z * 0.06 - travel * z * 14) % W;
        let y = (s.y - oy * z * 0.06) % H;
        if (x < 0) x += W;
        if (y < 0) y += H;
        x -= 20;
        y -= 20;
        const ink = 0.3 + 0.6 * s.z + s.tw * 0.5;
        if (warp > 0.05) {
          const len = warp * z * z * 160;
          capsule(grid, x, y, x + len, y, C * 0.18 * (0.6 + z), C * 0.05, Math.min(1, ink), Math.min(1, warp * 1.5));
        }
        dot(grid, x, y, Math.min(1, ink), 0.18 + 0.3 * s.z + s.tw * 0.45);
        if (s.tw > 0.2) {
          const a = s.tw * 0.7;
          for (let k = 1; k <= 2; k++) {
            dot(grid, x + k * C, y, a / k, 0.25);
            dot(grid, x - k * C, y, a / k, 0.25);
            dot(grid, x, y + k * C, a / k, 0.25);
            dot(grid, x, y - k * C, a / k, 0.25);
          }
        }
      }

      for (const m of meteors) {
        const fade = Math.sin((m.age / m.life) * Math.PI);
        const v = Math.hypot(m.vx, m.vy);
        const len = 110 * fade;
        capsule(grid, m.x, m.y, m.x - (m.vx / v) * len, m.y - (m.vy / v) * len, C * 0.4, C * 0.04, 0.95, fade);
      }

      for (const n of novas) {
        const a = n.age;
        if (a < 0.7) {
          const f = 1 - a / 0.7;
          capsule(grid, n.x, n.y, n.x, n.y, C * (0.6 + 2.2 * f), C * (0.6 + 2.2 * f), 1, f);
        }
        // a shell of dots expanding and thinning out
        const R = 220 * Math.pow(a / 3, 0.55);
        const fade = 1 - a / 3;
        const count = Math.max(12, Math.floor((TAU * R) / C));
        for (let k = 0; k < count; k++) {
          const th = (k / count) * TAU;
          const wob = 1 + 0.12 * (noise(Math.cos(th) * 2 + n.x, Math.sin(th) * 2 + n.y) - 0.5);
          if (noise(th * 3 + n.x, a * 2) < 0.35) continue;
          dot(grid, n.x + Math.cos(th) * R * wob, n.y + Math.sin(th) * R * wob, fade, 0.3);
        }
      }
    },
    background(g, world, _grid, ink) {
      // the far field: tiny fixed points
      const { dpr } = world;
      const r = seeded(97);
      const count = Math.round((world.w * world.h) / 1800);
      for (let i = 0; i < count; i++) {
        g.fillStyle = ink(0.06 + r() * 0.2);
        g.fillRect(Math.round(r() * world.w * dpr), Math.round(r() * world.h * dpr), dpr, dpr);
      }
    },
    force(p, dt) {
      // everything streams past while warping
      p.vx -= warp * 600 * dt;
    },
    pointerDown(x, y) {
      if (novas.length >= 4) novas.shift();
      novas.push({ x, y, age: 0 });
      burst(x, y, 70, 240, 0.9, true);
    },
    input() {
      for (let k = 0; k < 3; k++) stars[(rand() * stars.length) | 0].tw = 1;
    },
    submit() {
      warp = 1;
    },
  };
  scene.resize(world);
  return scene;
}
