import { blend, capsule } from '../draw';
import { TAU, clamp, fbm, noise, rand, range, seeded, smoothstep } from '../math';
import { burst, spawn } from '../particles';
import type { Scene } from '../scene';
import type { World } from '../world';

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  shed: number;
}

/**
 * A black hole in the open part of the screen: an accretion disk seen almost edge-on, the far side of
 * the disk lensed up over the shadow, a thin photon ring, and grid paper bent around it.
 */
export function blackHole(world: World): Scene {
  let cx = NaN;
  let cy = NaN;
  // where the open space is; the hole drifts over when the interface moves or hides
  let tx = 0;
  let ty = 0;
  // where the bent grid was last drawn around
  let paintedX = NaN;
  let paintedY = NaN;
  let Rs = 100; // shadow radius
  let rin = 150;
  let rout = 450;
  let G = 1;
  const q = 0.17; // how flat the disk looks
  let flare = 0;
  let dustAcc = 0;
  const stars: Star[] = [];

  /** Disk brightness at radius r and disk angle th (0 = right edge, +pi/2 = nearest the viewer). */
  function disk(r: number, th: number, t: number) {
    if (r < rin * 0.9 || r > rout) return 0;
    const prof = smoothstep(rin * 0.92, rin * 1.12, r) * Math.pow(rin / r, 1.1) * (1 - smoothstep(rout * 0.62, rout, r));
    if (prof < 0.01) return 0;
    const w = 1.1 * Math.pow(rin / r, 1.5);
    // two copies of the texture, each sheared by the differential rotation and swapped
    // before the shear gets too thin to read
    const P = 9;
    const t1 = t % P;
    const t2 = (t + P / 2) % P;
    const mix = Math.abs((t1 / P) * 2 - 1);
    const k = 0.022;
    const a1 = th - w * t1;
    const a2 = th - w * t2;
    const A = fbm(Math.cos(a1) * r * k + 11, Math.sin(a1) * r * k * 1.6);
    const B = fbm(Math.cos(a2) * r * k + 47, Math.sin(a2) * r * k * 1.6);
    const tex = A + (B - A) * mix;
    const bands = 0.55 + 0.45 * noise(r * 0.045, 3.3);
    const doppler = 1 + 0.5 * Math.cos(th);
    return prof * (0.3 + 1.1 * tex * tex * bands) * doppler * (1 + flare);
  }

  function emission(x: number, y: number, t: number) {
    const X = x - cx;
    const Y = y - cy;
    const b = Math.hypot(X, Y);
    const Z = Y / q;
    const r = Math.hypot(X, Z);
    let e = 0;
    // the disk itself; its far half hides behind the shadow
    if (r < rout && (Z > 0 || b > Rs)) e = disk(r, Math.atan2(Z, X), t);
    // far side of the disk, bent up over the top of the shadow (and thinly under it)
    if (e < 0.08 && b > Rs) {
      const up = -Y / b;
      const width = Rs * (0.14 + 0.5 * smoothstep(-0.4, 1, up));
      const u = (b - Rs * 1.04) / width;
      if (u > 0 && u < 1) {
        const lensed = disk(rin + u * (rout * 0.55 - rin), -Math.abs(Math.atan2(Y, X)), t) * (1 - u * 0.6) * 0.9;
        if (lensed > e) e = lensed;
      }
    }
    // photon ring
    const ring = (b - Rs * 1.02) / (Rs * 0.04);
    e = Math.max(e, Math.exp(-ring * ring) * 0.9 * (1 + flare * 0.5));
    return e;
  }

  /** Screen-space velocity of the swirl at a point: orbiting in the disk plane and slowly falling in. */
  function flow(x: number, y: number): [number, number, number] {
    const X = x - cx;
    const Z = (y - cy) / q;
    const r = Math.hypot(X, Z) || 1;
    const w = 1.1 * Math.pow(rin / Math.max(r, rin), 1.5);
    const vr = -26 * Math.sqrt(rin / Math.max(r, rin));
    const c = X / r;
    const s = Z / r;
    const vX = -s * r * w + c * vr;
    const vZ = c * r * w + s * vr;
    return [vX, vZ * q, r];
  }

  function dust(world: World) {
    const r = range(rout * 0.75, rout * 1.35);
    const th = rand() * TAU;
    const x = cx + Math.cos(th) * r;
    const y = cy + Math.sin(th) * r * q + range(-1, 1) * world.cell;
    const [vx, vy] = flow(x, y);
    spawn(x, y, vx, vy, range(5, 11), range(0.25, 0.75));
  }

  const scene: Scene = {
    fog: 0.3,
    resize(world) {
      const { view } = world;
      tx = view.cx;
      ty = view.cy;
      if (Number.isNaN(cx)) {
        cx = tx;
        cy = ty;
      }
      Rs = clamp(Math.min(view.w * 0.8, view.h, world.w, world.h) * 0.17, 40, 130);
      rin = Rs * 1.55;
      rout = Math.max(view.w * 0.46, Rs * 3.4);
      G = Rs * Rs * Rs * 10;
    },
    update(dt, world) {
      const k = Math.min(1, dt * 2.5);
      cx += (tx - cx) * k;
      cy += (ty - cy) * k;
      if (Math.hypot(tx - cx, ty - cy) < 0.25) {
        cx = tx;
        cy = ty;
      }
      flare *= Math.exp(-dt * 1.1);
      dustAcc += dt * 34;
      while (dustAcc >= 1) {
        dustAcc -= 1;
        dust(world);
      }
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];
        const dx = cx - s.x;
        const dy = cy - s.y;
        const b = Math.hypot(dx, dy) || 1;
        const a = G / (b * b);
        s.vx += (dx / b) * a * dt;
        s.vy += (dy / b) * a * dt;
        const drag = Math.exp(-dt * 0.22);
        s.vx *= drag;
        s.vy *= drag;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        // tidal stripping: close in, the star sheds a stream that joins the disk
        const tide = clamp(1 - (b - Rs * 1.2) / (Rs * 2.4), 0, 1);
        s.shed += dt * tide * 80;
        while (s.shed >= 1) {
          s.shed -= 1;
          spawn(s.x + range(-3, 3), s.y + range(-3, 3), s.vx * 0.6 + range(-20, 20), s.vy * 0.6 + range(-20, 20), range(2, 5), range(0.5, 0.9));
        }
        s.r = Math.max(0, s.r - dt * tide * s.r * 0.35);
        if (b < Rs * 1.05 || s.r < 1) {
          flare = Math.min(2, flare + 0.8);
          burst(s.x, s.y, 30, 90, 0.8);
          stars.splice(i, 1);
        }
      }
    },
    raster(grid, world) {
      const { cell: C, cols, rows } = grid;
      const t = world.time;
      const x0 = Math.max(0, Math.floor((cx - rout - C) / C));
      const x1 = Math.min(cols - 1, Math.floor((cx + rout + C) / C));
      const span = Math.max(rout * q, Rs * 1.8) + C;
      const y0 = Math.max(0, Math.floor((cy - span) / C));
      const y1 = Math.min(rows - 1, Math.floor((cy + span) / C));
      const h = C * 0.25;
      for (let gy = y0; gy <= y1; gy++) {
        const py = (gy + 0.5) * C;
        for (let gx = x0; gx <= x1; gx++) {
          const px = (gx + 0.5) * C;
          let c = 0;
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            const e = emission(px + (k & 1 ? h : -h), py + (k & 2 ? h : -h), t);
            c += Math.min(1, e * 2.6);
            sum += e;
          }
          c *= 0.25;
          if (c < 0.03) continue;
          blend(grid, gy * cols + gx, c, clamp(0.3 + 0.9 * sum * 0.25, 0, 1));
        }
      }
      for (const s of stars) {
        const v = Math.hypot(s.vx, s.vy) || 1;
        const stretch = clamp(1 - (Math.hypot(s.x - cx, s.y - cy) - Rs) / (Rs * 3), 0, 1);
        const len = s.r * (0.6 + stretch * 5);
        capsule(grid, s.x, s.y, s.x - (s.vx / v) * len, s.y - (s.vy / v) * len, s.r, s.r * 0.35, 0.95);
      }
    },
    backdropStale() {
      return cx !== paintedX || cy !== paintedY;
    },
    background(g, world, grid, ink) {
      const { dpr } = world;
      paintedX = cx;
      paintedY = cy;
      const E = Rs * 1.35; // Einstein radius
      const E2 = E * E;
      const step = grid.cell * 2;
      // point-lens images of a source point: the outer one and the flipped inner one
      const images = (sx: number, sy: number, out: number[]) => {
        const X = sx - cx;
        const Y = sy - cy;
        const b = Math.hypot(X, Y) || 1e-3;
        const root = Math.sqrt(b * b + 4 * E2);
        const kp = (b + root) / (2 * b);
        out[0] = cx + X * kp;
        out[1] = cy + Y * kp;
        const inner = (root - b) / 2; // distance of the inner image from the centre
        if (inner > Rs * 1.03) {
          const km = -inner / b;
          out[2] = cx + X * km;
          out[3] = cy + Y * km;
        } else out[2] = NaN;
      };
      const pt = [0, 0, 0, 0];
      const line = (ax: number, ay: number, bx: number, by: number) => {
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 3);
        for (let pass = 0; pass < 2; pass++) {
          g.beginPath();
          let pen = false;
          let lx = 0;
          let ly = 0;
          for (let i = 0; i <= n; i++) {
            images(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, pt);
            const x = pt[pass * 2];
            const y = pt[pass * 2 + 1];
            if (Number.isNaN(x) || (pen && Math.hypot(x - lx, y - ly) > 30)) {
              pen = false;
              if (Number.isNaN(x)) continue;
            }
            if (pen) g.lineTo(x * dpr, y * dpr);
            else g.moveTo(x * dpr, y * dpr);
            pen = true;
            lx = x;
            ly = y;
          }
          g.stroke();
        }
      };
      g.strokeStyle = ink(0.06);
      g.lineWidth = 1;
      const ox = cx % step;
      const oy = cy % step;
      for (let x = ox - step; x <= world.w + step; x += step) line(x, -step, x, world.h + step);
      for (let y = oy - step; y <= world.h + step; y += step) line(-step, y, world.w + step, y);

      // background stars, lensed the same way
      const r = seeded(7);
      const count = Math.round((world.w * world.h) / 7000);
      for (let i = 0; i < count; i++) {
        const sx = r() * world.w;
        const sy = r() * world.h;
        const size = (r() < 0.85 ? 1 : 2) * dpr;
        g.fillStyle = ink(0.12 + r() * 0.35);
        images(sx, sy, pt);
        g.fillRect(Math.round(pt[0] * dpr), Math.round(pt[1] * dpr), size, size);
        if (!Number.isNaN(pt[2])) g.fillRect(Math.round(pt[2] * dpr), Math.round(pt[3] * dpr), size, size);
      }
    },
    // the swirl captures loose dots; jets and the submit burst fly free
    force(p, dt) {
      if (p.clear) return;
      const [vx, vy, r] = flow(p.x, p.y);
      if (r < rin * 0.85) {
        p.life = 0;
        return;
      }
      const k = Math.min(1, dt * 1.6);
      p.vx += (vx - p.vx) * k;
      p.vy += (vy - p.vy) * k;
    },
    pointerDown(x, y) {
      if (stars.length >= 5) stars.shift();
      const dx = x - cx;
      const dy = y - cy;
      const b = Math.hypot(dx, dy) || 1;
      const v = Math.sqrt(G / b) * 0.62;
      stars.push({ x, y, vx: (-dy / b) * v, vy: (dx / b) * v, r: world.cell * 0.9, shed: 0 });
      burst(x, y, 10, 40, 0.5);
    },
    input(world) {
      const { card } = world;
      for (let i = 0; i < 5; i++) {
        const x = card.cx + range(-0.5, 0.5) * card.w;
        const y = card.cy + (rand() < 0.5 ? -0.5 : 0.5) * card.h;
        spawn(x, y, range(-30, 30), range(-30, 30), range(3, 7), range(0.4, 0.8));
      }
    },
    submit() {
      flare = Math.min(2, flare + 1.4);
      for (let i = 0; i < 140; i++) {
        const dir = i & 1 ? 1 : -1;
        const v = range(260, 520);
        spawn(cx + range(-4, 4), cy + dir * Rs * range(0.2, 0.9), range(-14, 14), dir * v, range(0.8, 1.6), range(0.5, 0.95), true);
      }
    },
  };
  scene.resize(world);
  return scene;
}
