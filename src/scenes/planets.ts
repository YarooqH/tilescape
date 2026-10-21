import { capsule, dot, fillShape, sample } from '../draw';
import { TAU, clamp, fbm, lerp, noise, rand, range, smoothstep, wrapAngle } from '../math';
import { ambient, burst, spawn } from '../particles';
import { paintGrid } from '../render';
import type { Scene } from '../scene';
import type { Grid, World } from '../world';

type Kind = 'rock' | 'gas' | 'ice';

interface Moon {
  dist: number;
  ang: number;
  speed: number;
  size: number;
  seed: number;
}

interface Planet {
  /** 0..1 position between the innermost and outermost orbit */
  f: number;
  a: number;
  ang: number;
  size: number;
  kind: Kind;
  ringed: boolean;
  tilt: number;
  spin: number;
  seed: number;
  moons: Moon[];
}

interface Comet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  shed: number;
}

const Q = 0.42; // orbit plane tilt: how squashed the orbits look
const S = Math.sqrt(1 - Q * Q);

/** A small solar system centred on the open part of the screen, every planet lit from its sun. */
export function planets(world: World): Scene {
  let cx = NaN;
  let cy = NaN;
  // where the open space is; the whole system drifts over when the interface moves or hides
  let tx = 0;
  let ty = 0;
  // where the orbit lines were last drawn around
  let paintedX = NaN;
  let paintedY = NaN;
  let portrait = false;
  let amin = 200;
  let base = 30;
  let sunR = 40;
  let G = 1;
  let flare = 0;
  let dust = 0;
  let list: Planet[] = [];
  const comets: Comet[] = [];

  // the orbit frame is landscape; on tall screens it is turned a quarter
  const sx = (u: number, v: number) => (portrait ? cx - v : cx + u);
  const sy = (u: number, v: number) => (portrait ? cy + u : cy + v);

  function build(n: number) {
    const kinds: [Kind, boolean, number][] =
      n <= 3
        ? [
            ['rock', false, 0.6],
            ['gas', true, 1],
            ['ice', false, 0.8],
          ]
        : [
            ['rock', false, 0.5],
            ['rock', false, 0.65],
            ['gas', true, 1],
            ['gas', false, 1.15],
            ['ice', false, 0.8],
          ];
    list = kinds.map(([kind, ringed, size], i) => ({
      f: n === 1 ? 0 : i / (kinds.length - 1),
      a: 0,
      ang: rand() * TAU,
      size,
      kind,
      ringed,
      tilt: range(-0.45, 0.45),
      spin: range(0.15, 0.4) * (rand() < 0.2 ? -1 : 1),
      seed: rand() * 100,
      moons: Array.from({ length: kind === 'rock' && size < 0.6 ? 0 : 1 + ((rand() * (kind === 'gas' ? 2 : 1.4)) | 0) }, () => ({
        dist: range(1.7, 2.6),
        ang: rand() * TAU,
        speed: range(0.5, 1.1) * (rand() < 0.5 ? -1 : 1),
        size: range(0.16, 0.26),
        seed: rand() * 100,
      })),
    }));
  }

  function albedo(p: Planet, lon: number, lat: number) {
    const sd = p.seed;
    if (p.kind === 'rock') {
      const land = smoothstep(0.47, 0.55, fbm(lon * 1.3 + sd, lat * 1.7 + sd * 0.3));
      let v = 0.38 + 0.45 * land + (fbm(lon * 5 + sd, lat * 5) - 0.5) * 0.25;
      if (Math.abs(lat) > 1.15) v = 0.2;
      return v;
    }
    if (p.kind === 'gas') {
      let v = 0.52 + 0.28 * Math.sin(lat * 7 + 2.2 * noise(lon * 0.8 + sd, lat * 3)) + 0.18 * (noise(lon * 2 + sd, lat * 14) - 0.5);
      // a storm riding the bands
      const dl = wrapAngle(lon - sd) / 0.42;
      const db = (lat - 0.38) / 0.16;
      const d = dl * dl + db * db;
      if (d < 1) v = lerp(0.95, v, d * d);
      return v;
    }
    return 0.34 + 0.16 * noise(lon * 2 + sd, lat * 4) + 0.07 * Math.sin(lat * 15) + (Math.abs(lat) > 1.05 ? -0.15 : 0);
  }

  /** Shade a sphere at local offset (du, dv) in units of its radius, lit along L. */
  function sphere(p: Planet | null, seed: number, du: number, dv: number, L: number[], t: number) {
    const d2 = du * du + dv * dv;
    if (d2 > 1) return -1;
    const nz = Math.sqrt(1 - d2);
    const lam = du * L[0] + dv * L[1] + nz * L[2];
    let a: number;
    if (p) {
      const ct = Math.cos(p.tilt);
      const st = Math.sin(p.tilt);
      const tu = du * ct + dv * st;
      const tv = -du * st + dv * ct;
      a = albedo(p, Math.atan2(tu, nz) + p.spin * t, Math.asin(clamp(tv, -1, 1)));
    } else {
      // moons: pale with craters
      a = 0.42 + (fbm(du * 3 + seed, dv * 3) - 0.5) * 0.5;
    }
    a *= 0.8 + 0.2 * nz;
    const lit = smoothstep(-0.12 - flare * 0.5, 0.32, lam);
    sample.cov = 0.16 + 0.84 * lit;
    return clamp(a * (0.3 + 0.7 * lit) + (1 - nz) * 0.18, 0, 1);
  }

  /** Granulated disk with a darker limb and a ragged corona that reaches out on a flare. */
  function sun(grid: Grid, t: number) {
    const r = sunR * (1 + flare * 0.06);
    const ext = r * (1.5 + flare * 0.4);
    fillShape(grid, cx - ext, cy - ext, cx + ext, cy + ext, (x, y) => {
      const du = (x - cx) / r;
      const dv = (y - cy) / r;
      const d = Math.hypot(du, dv);
      if (d > 1) {
        const a = Math.atan2(dv, du);
        const reach = 1 + (0.12 + 0.3 * noise(a * 2.5 + 7, t * 0.4)) * (1 + flare);
        if (d > reach) return -1;
        sample.cov = 0.55 * (1 - (d - 1) / (reach - 1));
        return 0.3;
      }
      const nz = Math.sqrt(1 - d * d);
      const gran = fbm(du * 5 + t * 0.12, dv * 5 - t * 0.09);
      return clamp(0.18 + 0.55 * gran * (0.45 + 0.55 * nz) + (1 - nz) * 0.35 - flare * 0.1, 0, 1);
    });
  }

  function ring(p: Planet, rr: number) {
    if (rr < 1.38 || rr > 2.3 || Math.abs(rr - 1.82) < 0.05) return -1;
    sample.cov = clamp(0.55 + 0.5 * noise(rr * 9, p.seed), 0, 1);
    return rr < 1.82 ? 0.7 : 0.5;
  }

  const scene: Scene = {
    fog: 0.35,
    resize(world) {
      const { view } = world;
      tx = view.cx;
      ty = view.cy;
      if (Number.isNaN(cx)) {
        cx = tx;
        cy = ty;
      }
      portrait = view.h > view.w * 1.15;
      const along = portrait ? view.h : view.w;
      base = clamp(Math.min(world.w, world.h) * 0.085, 24, 64);
      sunR = base * 0.9;
      amin = sunR + base * 1.8;
      const amax = Math.max(amin + base * 4, along * 0.5);
      const n = world.w < 700 ? 3 : 5;
      if (list.length !== n) build(n);
      for (const p of list) p.a = lerp(amin, amax, p.f);
      const m = Math.min(world.w, world.h) * 0.5;
      G = 0.35 * m * m * m;
    },
    update(dt, world) {
      const k = Math.min(1, dt * 2);
      cx += (tx - cx) * k;
      cy += (ty - cy) * k;
      if (Math.hypot(tx - cx, ty - cy) < 0.25) {
        cx = tx;
        cy = ty;
      }
      flare *= Math.exp(-dt * 1.3);
      dust = ambient(dust, dt, world, 0.5, 0.8);
      for (const p of list) {
        p.ang += dt * 0.3 * Math.pow(amin / p.a, 1.5);
        for (const m of p.moons) m.ang += dt * m.speed;
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.age += dt;
        for (let k = 0; k < 2; k++) {
          const h = dt / 2;
          const dx = cx - c.x;
          const dy = cy - c.y;
          const b2 = dx * dx + dy * dy;
          const b = Math.sqrt(b2) || 1;
          const a = G / (b2 + 3600);
          c.vx += (dx / b) * a * h;
          c.vy += (dy / b) * a * h;
          c.x += c.vx * h;
          c.y += c.vy * h;
        }
        // the tail always points away from the sun and grows near it
        const dx = c.x - cx;
        const dy = c.y - cy;
        const b = Math.hypot(dx, dy) || 1;
        c.shed += dt * clamp(140 - b * 0.15, 25, 120);
        while (c.shed >= 1) {
          c.shed -= 1;
          const v = range(20, 70);
          spawn(c.x, c.y, (dx / b) * v + c.vx * 0.15 + range(-8, 8), (dy / b) * v + c.vy * 0.15 + range(-8, 8), range(0.8, 2.2), range(0.35, 0.85));
        }
        if (c.age > 30 || b > Math.max(world.w, world.h) * 1.6) comets.splice(i, 1);
      }
    },
    raster(grid, world) {
      const t = world.time;
      // back to front
      const order = list
        .map((p) => ({ p, z: Math.sin(p.ang) }))
        .sort((a, b) => a.z - b.z);
      let sunDrawn = false;
      for (const { p, z } of order) {
        if (z > 0 && !sunDrawn) {
          sun(grid, t);
          sunDrawn = true;
        }
        const c = Math.cos(p.ang);
        const pu = p.a * c;
        const pv = p.a * z * Q;
        const persp = 1 + 0.2 * z;
        const pr = p.size * base * persp;
        // from the planet toward the sun, in the orbit frame (u right, v down, z toward the viewer)
        const L = [-c, -z * Q, -z * S];
        const px = sx(pu, pv);
        const py = sy(pu, pv);

        const moon = (m: Moon, front: boolean) => {
          const s = Math.sin(m.ang);
          if (s > 0 !== front) return;
          const mu = pu + Math.cos(m.ang) * m.dist * pr;
          const mv = pv + s * m.dist * pr * 0.32;
          const mr = m.size * pr * (1 + 0.12 * s);
          const mx = sx(mu, mv);
          const my = sy(mu, mv);
          fillShape(grid, mx - mr, my - mr, mx + mr, my + mr, (x, y) => {
            const lu = portrait ? y - cy : x - cx;
            const lv = portrait ? cx - x : y - cy;
            return sphere(null, m.seed, (lu - mu) / mr, (lv - mv) / mr, L, t);
          });
        };

        for (const m of p.moons) moon(m, false);
        const ext = (p.ringed ? 2.35 : 1) * pr;
        const ct = Math.cos(p.tilt);
        const st = Math.sin(p.tilt);
        fillShape(grid, px - ext, py - ext, px + ext, py + ext, (x, y) => {
          const du = ((portrait ? y - cy : x - cx) - pu) / pr;
          const dv = ((portrait ? cx - x : y - cy) - pv) / pr;
          if (!p.ringed) return sphere(p, 0, du, dv, L, t);
          const ru = du * ct + dv * st;
          const rv = -du * st + dv * ct;
          const rr = Math.hypot(ru, rv / 0.3);
          if (rv > 0) {
            const r = ring(p, rr);
            if (r >= 0) return r;
          }
          const s = sphere(p, 0, du, dv, L, t);
          if (s >= 0) return s;
          return rv <= 0 ? ring(p, rr) : -1;
        });
        for (const m of p.moons) moon(m, true);
      }
      if (!sunDrawn) sun(grid, t);

      for (const c of comets) {
        const v = Math.hypot(c.vx, c.vy) || 1;
        const C = grid.cell;
        capsule(grid, c.x, c.y, c.x - (c.vx / v) * C * 1.5, c.y - (c.vy / v) * C * 1.5, C * 0.55, C * 0.2, 0.95);
        dot(grid, c.x + (c.vx / v) * C, c.y + (c.vy / v) * C, 0.5, 0.25);
      }
    },
    backdropStale() {
      return cx !== paintedX || cy !== paintedY;
    },
    background(g, world, grid, ink) {
      paintGrid(g, world, grid, ink);
      const { dpr } = world;
      paintedX = cx;
      paintedY = cy;
      g.strokeStyle = ink(0.2);
      g.lineWidth = Math.max(1, dpr);
      g.setLineDash([1.5 * dpr, 6 * dpr]);
      for (const p of list) {
        g.beginPath();
        const rx = portrait ? p.a * Q : p.a;
        const ry = portrait ? p.a : p.a * Q;
        g.ellipse(cx * dpr, cy * dpr, rx * dpr, ry * dpr, 0, 0, TAU);
        g.stroke();
      }
    },
    // solar wind: loose dots drift away from the sun
    force(p, dt) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const b = Math.hypot(dx, dy) || 1;
      p.vx += (dx / b) * 16 * dt;
      p.vy += (dy / b) * 16 * dt;
    },
    pointerDown(x, y) {
      if (comets.length >= 4) comets.shift();
      const dx = x - cx;
      const dy = y - cy;
      const b = Math.hypot(dx, dy) || 1;
      // a long ellipse: mostly sideways, a little inward, so it whips around the sun
      const v = Math.sqrt(G / b) * 0.75;
      comets.push({ x, y, vx: (-dy / b) * v - (dx / b) * v * 0.25, vy: (dx / b) * v - (dy / b) * v * 0.25, age: 0, shed: 0 });
      burst(x, y, 10, 40, 0.5);
    },
    input(world) {
      // a meteor streaks past
      const fromLeft = rand() < 0.5;
      const x = fromLeft ? -10 : world.w + 10;
      const y = range(0.1, 0.9) * world.h;
      const vx = (fromLeft ? 1 : -1) * range(380, 520);
      const vy = range(-80, 80);
      const v = Math.hypot(vx, vy);
      for (let k = 0; k < 6; k++) {
        spawn(x - (vx / v) * k * world.cell, y - (vy / v) * k * world.cell, vx, vy, range(1.6, 2.4), 0.7 - k * 0.09);
      }
    },
    submit() {
      flare = 1.2;
    },
  };
  scene.resize(world);
  return scene;
}
