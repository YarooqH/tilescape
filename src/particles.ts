import { TAU, rand, range } from './math';
import type { World } from './world';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  /** ink density at full life */
  d: number;
  /** ignore the fog around the prompt */
  clear: boolean;
}

/** Extra per-scene motion; set `p.life = 0` to remove a particle. */
export type Force = (p: Particle, dt: number) => void;

const MAX = 1800;
export const particles: Particle[] = [];

export function spawn(x: number, y: number, vx: number, vy: number, life: number, d: number, clear = false) {
  if (particles.length >= MAX) return;
  particles.push({ x, y, vx, vy, life, max: life, d, clear });
}

export function burst(x: number, y: number, count: number, speed: number, d: number, clear = false) {
  for (let i = 0; i < count; i++) {
    const a = rand() * TAU;
    const v = speed * range(0.25, 1);
    spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, range(0.6, 1.6), d * range(0.6, 1), clear);
  }
}

export function stepParticles(dt: number, force?: Force) {
  const drag = Math.exp(-dt * 1.1);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (force) force(p, dt);
    p.life -= dt;
    if (p.life <= 0) {
      particles[i] = particles[particles.length - 1];
      particles.pop();
      continue;
    }
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

/** Faint dots and short dotted runs that blink in and out across the screen. */
export function ambient(acc: number, dt: number, world: World, rate = 1, ink = 1): number {
  acc += (dt * world.w * world.h * rate) / (1600 * world.cell * world.cell);
  while (acc >= 1) {
    acc -= 1;
    const x = rand() * world.w;
    const y = rand() * world.h;
    const run = 1 + ((rand() * 5) | 0);
    const vx = range(-3, 3);
    const vy = range(-3, 1);
    const life = range(1.2, 3.6);
    const d = range(0.12, 0.38) * ink;
    for (let k = 0; k < run; k++) spawn(x + k * world.cell, y, vx, vy, life, d);
  }
  return acc;
}
