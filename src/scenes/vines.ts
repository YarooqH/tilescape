import { capsule, dot, fillShape } from '../draw';
import { TAU, clamp, noise, rand, range, smoothstep, wrapAngle } from '../math';
import { burst, spawn } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import type { Grid, World } from '../world';

interface Stem {
  /** x, y, radius per point, root first */
  pts: number[];
  seed: number;
}

interface Tip {
  stem: Stem;
  x: number;
  y: number;
  ang: number;
  r: number;
  budget: number;
  since: number;
  depth: number;
  gx: number;
  gy: number;
}

interface Leaf {
  stem: Stem;
  idx: number;
  side: number;
  grow: number;
  size: number;
  drop: number;
}

interface Bloom {
  stem: Stem;
  idx: number;
  grow: number;
  size: number;
  petals: number;
}

const STEP = 6;
const GROW = 46; // px per second
type Phase = 'grow' | 'hold' | 'wilt';

/** Vines that creep in from the edges, wrap around the prompt, flower, wilt and start over. */
export function vines(world: World): Scene {
  let worldRef = world;
  let stems: Stem[] = [];
  let tips: Tip[] = [];
  let leaves: Leaf[] = [];
  let blooms: Bloom[] = [];
  let phase: Phase = 'grow';
  let clock = 0;
  let wilt = 0;
  let C = 12; // size unit: one grid cell
  let spx = -1e4;
  let spy = -1e4;
  let push = 0;

  /** Signed distance to the stage, padded: negative inside. */
  function sd(x: number, y: number, w: World) {
    const { ui } = w;
    const dx = Math.abs(x - ui.cx) - ui.w / 2 - 6;
    const dy = Math.abs(y - ui.cy) - ui.h / 2 - 6;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  }

  function addTip(x: number, y: number, ang: number, r: number, budget: number, depth: number) {
    const stem: Stem = { pts: [x, y, r], seed: rand() * 100 };
    stems.push(stem);
    const t: Tip = { stem, x, y, ang, r, budget, since: 0, depth, gx: x, gy: y };
    pickGoal(t, worldRef);
    tips.push(t);
  }

  /** Somewhere new to wander to: away from the tip, outside the prompt, upward for trunks. */
  function pickGoal(t: Tip, w: World) {
    for (let k = 0; k < 20; k++) {
      const gx = range(0.06, 0.94) * w.w;
      const gy = range(0.06, t.depth === 0 ? 0.75 : 0.94) * w.h;
      if (sd(gx, gy, w) < 50) continue;
      if (Math.hypot(gx - t.x, gy - t.y) < 160) continue;
      t.gx = gx;
      t.gy = gy;
      return;
    }
    t.gx = w.w / 2;
    t.gy = w.h * 0.1;
  }

  let planted = '';

  function plant(w: World) {
    stems = [];
    tips = [];
    leaves = [];
    blooms = [];
    phase = 'grow';
    clock = 0;
    wilt = 0;
    worldRef = w;
    C = w.cell;
    const n = w.w < 700 ? 3 : 5;
    const reach = Math.max(w.w, w.h) * 1.1;
    for (let k = 0; k < n; k++) {
      const u = (k + range(0.2, 0.8)) / n;
      // spread the roots around the frame: bottom edge, then the sides
      let x: number;
      let y: number;
      if (k % 3 !== 2) {
        x = u * w.w;
        y = w.h + 4;
      } else if (k % 2) {
        x = -4;
        y = range(0.3, 0.9) * w.h;
      } else {
        x = w.w + 4;
        y = range(0.3, 0.9) * w.h;
      }
      const ang = Math.atan2(w.view.cy - y, w.view.cx - x) + range(-0.4, 0.4);
      addTip(x, y, ang, C * 0.8, reach * range(0.45, 0.75), 0);
    }
  }

  function attach(stem: Stem, depth: number) {
    const idx = stem.pts.length / 3 - 1;
    if (idx < 3) return;
    if (idx % 9 === 0) {
      leaves.push({ stem, idx, side: (idx / 9) % 2 ? 1 : -1, grow: 0, size: range(0.8, 1.2) * (depth ? 0.85 : 1), drop: range(0, 0.7) });
    }
  }

  function growTip(t: Tip, dt: number, w: World) {
    t.since += dt * GROW;
    while (t.since >= STEP && t.budget > 0) {
      t.since -= STEP;
      t.budget -= STEP;
      if (Math.hypot(t.gx - t.x, t.gy - t.y) < 60) pickGoal(t, w);
      let want = Math.atan2(t.gy - t.y, t.gx - t.x);
      let pull = 0.1;
      // slide around the prompt instead of into it
      const d = sd(t.x, t.y, w);
      if (d < 70) {
        const e = 2;
        const out = Math.atan2(sd(t.x, t.y + e, w) - sd(t.x, t.y - e, w), sd(t.x + e, t.y, w) - sd(t.x - e, t.y, w));
        const a = out + Math.PI / 2;
        const b = out - Math.PI / 2;
        want = Math.abs(wrapAngle(a - want)) < Math.abs(wrapAngle(b - want)) ? a : b;
        if (d < 34) want = out;
        pull = 0.45;
      }
      const m = 16;
      if (t.x < m) want = 0;
      else if (t.x > w.w - m) want = Math.PI;
      else if (t.y < m) want = Math.PI / 2;
      // curls: the heading wobbles on its own noise, so stems never run straight
      const wob = (noise(t.budget * 0.008, t.stem.seed) - 0.5) * 0.5;
      t.ang += clamp(wrapAngle(want - t.ang), -pull, pull) + wob;
      t.x += Math.cos(t.ang) * STEP;
      t.y += Math.sin(t.ang) * STEP;
      t.r = Math.max(C * 0.42, t.r * 0.996);
      t.stem.pts.push(t.x, t.y, t.r);
      attach(t.stem, t.depth);
      if (t.depth < 3 && rand() < 0.016 && t.budget > 120) {
        const side = rand() < 0.5 ? -1 : 1;
        addTip(t.x, t.y, t.ang + side * range(0.6, 1.1), t.r * 0.7, t.budget * range(0.35, 0.6), t.depth + 1);
      }
    }
    if (t.budget <= 0) {
      if (rand() < 0.65) blooms.push({ stem: t.stem, idx: t.stem.pts.length / 3 - 1, grow: 0, size: range(0.8, 1.2), petals: 5 + ((rand() * 2) | 0) });
      return false;
    }
    return true;
  }

  /** Where a stem point is drawn this frame: swaying, and pushed by the cursor. */
  function at(stem: Stem, idx: number, t: number, out: number[]) {
    const p = stem.pts;
    let x = p[idx * 3];
    let y = p[idx * 3 + 1];
    const amp = Math.min(1, idx / 40) * C * 0.25;
    x += Math.sin(t * 1.1 + idx * 0.09 + stem.seed) * amp;
    y += Math.cos(t * 0.9 + idx * 0.07 + stem.seed) * amp * 0.6;
    if (push > 0.01) {
      const dx = x - spx;
      const dy = y - spy;
      const d = Math.hypot(dx, dy);
      if (d < 90 && d > 0.1) {
        const f = (1 - d / 90) ** 2 * 18 * push * Math.min(1, idx / 12);
        x += (dx / d) * f;
        y += (dy / d) * f;
      }
    }
    out[0] = x;
    out[1] = y;
  }

  function leafShape(grid: Grid, x: number, y: number, ang: number, L: number, W: number) {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ext = L + grid.cell;
    fillShape(grid, x - ext, y - ext, x + ext, y + ext, (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      if (u < 0 || u > L) return -1;
      const half = W * Math.sin((Math.PI * u) / L) ** 0.8;
      if (Math.abs(v) > half || sd(px, py, worldRef) < 0) return -1;
      return Math.abs(v) < W * 0.14 ? 0.95 : v > 0 ? 0.62 : 0.5;
    });
  }

  const scene: Scene = {
    fog: 0.55,
    resize(world) {
      // the interface moving or hiding should not pull up a garden half grown
      const size = `${world.w}x${world.h}`;
      worldRef = world;
      C = world.cell;
      if (size !== planted) {
        planted = size;
        plant(world);
      }
    },
    update(dt, world) {
      clock += dt;
      const p = world.pointer;
      const k = Math.min(1, dt * 5);
      if (p.active) {
        spx += (p.x - spx) * k;
        spy += (p.y - spy) * k;
      }
      push += ((p.active ? 1 : 0) - push) * Math.min(1, dt * 3);

      if (phase === 'grow') {
        tips = tips.filter((t) => growTip(t, dt, world));
        if (tips.length === 0 || clock > 40) {
          phase = 'hold';
          clock = 0;
        }
      } else if (phase === 'hold') {
        if (clock > 9) {
          phase = 'wilt';
          clock = 0;
        }
      } else {
        wilt = Math.min(1, clock / 5);
        const pt = [0, 0];
        leaves = leaves.filter((l) => {
          if (wilt < l.drop) return true;
          at(l.stem, Math.min(l.idx, l.stem.pts.length / 3 - 1), world.time, pt);
          for (let i = 0; i < 3; i++) spawn(pt[0] + range(-4, 4), pt[1] + range(-4, 4), range(-15, 15), range(5, 25), range(2, 4), range(0.4, 0.7));
          return false;
        });
        blooms = blooms.filter((b) => {
          if (wilt < 0.3) return true;
          at(b.stem, Math.min(b.idx, b.stem.pts.length / 3 - 1), world.time, pt);
          burst(pt[0], pt[1], 6, 30, 0.6);
          return false;
        });
        if (clock > 6.5) plant(world);
      }
      for (const l of leaves) l.grow = Math.min(1, l.grow + dt * 0.8);
      for (const b of blooms) b.grow = Math.min(1, b.grow + dt * 0.5);
    },
    raster(grid, world) {
      const t = world.time;
      const keep = 1 - smoothstep(0.35, 1, wilt);
      const a = [0, 0];
      const b = [0, 0];
      for (const s of stems) {
        const n = Math.floor((s.pts.length / 3) * keep);
        if (n < 2) continue;
        at(s, 0, t, a);
        for (let i = 1; i < n; i++) {
          at(s, i, t, b);
          capsule(grid, a[0], a[1], b[0], b[1], s.pts[i * 3 - 1], s.pts[i * 3 + 2], 0.85);
          a[0] = b[0];
          a[1] = b[1];
        }
      }
      for (const l of leaves) {
        const n = l.stem.pts.length / 3;
        if (l.idx >= n * keep) continue;
        at(l.stem, l.idx, t, a);
        at(l.stem, Math.max(0, l.idx - 1), t, b);
        const dir = Math.atan2(a[1] - b[1], a[0] - b[0]);
        const g = smoothstep(0, 1, l.grow);
        const droop = wilt * 0.8 * l.side;
        const ang = dir + l.side * (1.05 - 0.4 * g) + droop + Math.sin(t * 1.4 + l.idx) * 0.08;
        const L = C * 3.6 * l.size * g;
        if (L < 3) continue;
        leafShape(grid, a[0], a[1], ang, L, L * 0.42);
      }
      for (const bl of blooms) {
        const n = bl.stem.pts.length / 3;
        at(bl.stem, Math.min(bl.idx, n - 1), t, a);
        const g = smoothstep(0, 1, bl.grow);
        const R = C * 2.2 * bl.size * g;
        if (R < 2) {
          dot(grid, a[0], a[1], 0.8, 0.35);
          continue;
        }
        for (let k = 0; k < bl.petals; k++) {
          const th = (k / bl.petals) * TAU + bl.idx;
          capsule(grid, a[0], a[1], a[0] + Math.cos(th) * R, a[1] + Math.sin(th) * R, R * 0.2, R * 0.38, 0.22);
        }
        capsule(grid, a[0], a[1], a[0], a[1], R * 0.28, R * 0.28, 0.9);
      }
    },
    background: paintGrid,
    force(p, dt) {
      // leaves flutter down
      p.vy += 28 * dt;
      p.vx += Math.sin(p.y * 0.05) * 20 * dt;
    },
    pointerDown(x, y, world) {
      if (phase !== 'grow') {
        phase = 'grow';
        clock = 0;
        wilt = 0;
      }
      const ang = Math.atan2(world.view.cy - y, world.view.cx - x);
      addTip(x, y, ang, C * 0.7, Math.max(world.w, world.h) * 0.5, 1);
      burst(x, y, 10, 40, 0.6);
    },
    input(world) {
      if (phase !== 'grow') return;
      for (const t of tips) t.since += STEP * 2;
      if (tips.length === 0 && stems.length) {
        const s = stems[(rand() * stems.length) | 0];
        const i = (rand() * (s.pts.length / 3)) | 0;
        addTip(s.pts[i * 3], s.pts[i * 3 + 1], rand() * TAU, s.pts[i * 3 + 2] * 0.7, 160, 2);
      }
      void world;
    },
    submit() {
      // everything flowers at once
      for (const s of stems) {
        const n = s.pts.length / 3;
        for (let i = 10; i < n; i += 18 + ((rand() * 14) | 0)) {
          blooms.push({ stem: s, idx: i, grow: 0, size: range(0.6, 1), petals: 5 + ((rand() * 2) | 0) });
        }
      }
      if (phase === 'hold') clock = 0;
    },
  };
  scene.resize(world);
  return scene;
}
