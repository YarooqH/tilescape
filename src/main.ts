import './style.css';
import { TINTS, type Tint } from './colors';
import { TAU, clamp, rand, range, smoothstep } from './math';
import { particles, spawn, stepParticles } from './particles';
import { Renderer, type Mode, type RGB } from './render';
import type { Scene, SceneInfo } from './scene';
import { SCENES } from './scenes';
import { WIDGETS } from './ui';
import { store } from './ui/dom';
import type { Host, Widget, WidgetInfo } from './ui/types';
import type { Grid, Rect, World } from './world';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const hintText = hint.querySelector('span')!;
const themeButton = document.querySelector<HTMLButtonElement>('#theme')!;
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')];
const scenePicker = document.querySelector<HTMLSelectElement>('#scene-pick')!;
const prevScene = document.querySelector<HTMLButtonElement>('#prev-scene')!;
const nextScene = document.querySelector<HTMLButtonElement>('#next-scene')!;
const uiPicker = document.querySelector<HTMLSelectElement>('#ui-pick')!;
const prevUi = document.querySelector<HTMLButtonElement>('#prev-ui')!;
const nextUi = document.querySelector<HTMLButtonElement>('#next-ui')!;
const controls = document.querySelector<HTMLElement>('.controls')!;
const hideButton = document.querySelector<HTMLButtonElement>('#hide-ui')!;
const tintButton = document.querySelector<HTMLButtonElement>('#tint')!;
const tintPop = document.querySelector<HTMLElement>('#tint-pop')!;
const tintName = document.querySelector<HTMLElement>('#tint-name')!;

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const coarse = matchMedia('(pointer: coarse)').matches;

const MODES: readonly Mode[] = ['tiles', 'ascii', 'halftone'];

const renderer = new Renderer(ctx);
const grid: Grid = {
  cell: 9,
  cols: 0,
  rows: 0,
  cov: new Float32Array(0),
  dark: new Float32Array(0),
  fog: new Float32Array(0),
  dots: [],
};
/** fog before the scene's own strength is applied */
let baseFog = new Float32Array(0);

const world: World = {
  w: 0,
  h: 0,
  dpr: 1,
  time: 0,
  cell: 9,
  ui: { cx: 0, cy: 0, w: 0, h: 0 },
  card: { cx: 0, cy: 0, w: 0, h: 0 },
  view: { cx: 0, cy: 0, w: 0, h: 0 },
  pointer: { x: 0, y: 0, vx: 0, vy: 0, active: false, down: false },
};

let info: SceneInfo = SCENES[0];
let scene: Scene | null = null;
let ui: WidgetInfo = WIDGETS[0];
let widget: Widget | null = null;
let paused = false;
/** the interface is faded out and the scene has the whole screen */
let hidden = false;
/** 0..1 while a new scene dissolves in */
let appear = 1;
/** phones: the interface sheet is folded down to its handle */
let folded = false;
let tint: Tint = TINTS[0];

/** On phones the interface sits in a sheet with a handle that folds it away. */
const handle = document.createElement('button');
handle.type = 'button';
handle.className = 'sheet-handle';
handle.innerHTML = '<span class="sheet-grip" aria-hidden="true"></span><span class="sheet-label"></span>';
const handleLabel = handle.querySelector('.sheet-label')!;

function hexToRgb(value: string): RGB {
  const hex = value.trim().replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readTheme() {
  const css = getComputedStyle(root);
  const color = (name: string) => hexToRgb(css.getPropertyValue(name));
  const ramp = isDark() ? tint.dark : tint.light;
  renderer.setTheme(color('--bg'), color('--ink'), color('--bg-core'), ramp ? [hexToRgb(ramp[0]), hexToRgb(ramp[1])] : undefined);
  paintSwatches();
  paintBackground();
}

function paintBackground() {
  if (world.w > 0) renderer.paintBackground(world, grid, scene?.background);
}

const toRect = (r: DOMRect): Rect => ({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height });

function applyFog() {
  const k = scene?.fog ?? 1;
  for (let i = 0; i < baseFog.length; i++) grid.fog[i] = 1 - k * (1 - baseFog[i]);
}

const OFF: Rect = { cx: -1e5, cy: -1e5, w: 0, h: 0 };

/**
 * The biggest open space beside the interface: left, right, above or below it, above the
 * controls. Long thin strips lose to squarer ones.
 */
function openView(w: number, h: number, ui: Rect): Rect {
  const bottom = Math.min(h, controls.getBoundingClientRect().top - 8);
  if (hidden || ui.w === 0) return { cx: w / 2, cy: h / 2, w, h };
  const gap = 12;
  const l = ui.cx - ui.w / 2 - gap;
  const r = ui.cx + ui.w / 2 + gap;
  const t = ui.cy - ui.h / 2 - gap;
  const b = ui.cy + ui.h / 2 + gap;
  const boxes: [number, number, number, number][] = [
    [0, 0, l, bottom],
    [r, 0, w, bottom],
    [0, 0, w, Math.min(t, bottom)],
    [0, b, w, bottom],
  ];
  let best: Rect = { cx: w / 2, cy: bottom / 2, w, h: bottom };
  let score = -1;
  for (const [x0, y0, x1, y1] of boxes) {
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0) continue;
    const s = bw * bh * Math.min(1, (2 * Math.min(bw, bh)) / Math.max(bw, bh));
    if (s > score) {
      score = s;
      best = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: bw, h: bh };
    }
  }
  return best;
}

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w === 0 || h === 0) return; // hidden or collapsed; the next resize lays out
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  world.w = w;
  world.h = h;
  world.dpr = dpr;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  // bottom docks sit just above the controls, however many rows those wrap to
  root.style.setProperty('--controls-top', `${Math.round(h - controls.getBoundingClientRect().top)}px`);
  const ui = (world.ui = hidden ? OFF : toRect(stage.getBoundingClientRect()));
  world.card = hidden ? OFF : toRect((widget?.card ?? stage).getBoundingClientRect());
  if (folded && !hidden) world.card = world.ui;
  world.view = openView(w, h, ui);

  const C = clamp(Math.round(Math.min(w, h) / 100), 7, 11);
  grid.cell = world.cell = C;
  grid.cols = Math.ceil(w / C);
  grid.rows = Math.ceil(h / C);
  const n = grid.cols * grid.rows;
  grid.cov = new Float32Array(n);
  grid.dark = new Float32Array(n);
  grid.fog = new Float32Array(n);
  baseFog = new Float32Array(n);
  // clear under the interface, back to full strength a short way past its edge
  const reach = clamp(Math.min(ui.w, ui.h) * 0.4, 60, 130);
  for (let gy = 0; gy < grid.rows; gy++) {
    for (let gx = 0; gx < grid.cols; gx++) {
      const dx = Math.abs((gx + 0.5) * C - ui.cx) - ui.w / 2;
      const dy = Math.abs((gy + 0.5) * C - ui.cy) - ui.h / 2;
      const d = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
      baseFog[gy * grid.cols + gx] = smoothstep(-24, reach, d);
    }
  }

  if (scene) scene.resize(world);
  else scene = info.create(world);
  applyFog();
  readTheme();
}

/** Break whatever is on screen into drifting dots, then bring the next scene in. */
function setScene(next: SceneInfo) {
  if (next === info && scene) return;
  if (scene && world.w > 0) {
    let lit = 0;
    for (let i = 0; i < grid.cov.length; i++) if (grid.cov[i] > 0.35) lit++;
    const keep = Math.min(1, 700 / (lit || 1));
    const C = grid.cell;
    for (let i = 0; i < grid.cov.length; i++) {
      if (grid.cov[i] <= 0.35 || rand() > keep) continue;
      const a = rand() * TAU;
      const v = range(10, 70);
      const x = ((i % grid.cols) + 0.5) * C;
      const y = (Math.floor(i / grid.cols) + 0.5) * C;
      spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, range(0.5, 1.5), grid.dark[i] * grid.cov[i]);
    }
    appear = 0;
  }
  info = next;
  scene = world.w > 0 ? next.create(world) : null;
  scenePicker.value = next.id;
  store.set('proc:scene', next.id);
  writeHash();
  hintText.textContent = next.hint.replace('{click}', coarse ? 'tap' : 'click');
  hint.classList.remove('is-gone');
  applyFog();
  paintBackground();
  widget?.sceneChanged?.(next);
}

const writeHash = () => history.replaceState(null, '', `#${info.id}/${ui.id}`);

/** Swap the interface; the scene re-forms around whatever replaces it. */
function setWidget(next: WidgetInfo, focus = false) {
  if (next === ui && widget) return;
  const hadFocus = widget?.root.contains(document.activeElement) ?? false;
  widget?.destroy?.();
  ui = next;
  widget = next.create(host);
  stage.replaceChildren(handle, widget.root);
  stage.dataset.widget = next.id;
  handleLabel.textContent = next.label;
  uiPicker.value = next.id;
  store.set('proc:ui', next.id);
  writeHash();
  if (focus) fold(false);
  if (focus || hadFocus) widget.focus?.();
  watch.disconnect();
  watch.observe(stage);
  watch.observe(widget.card);
  layout();
}

/** Phones: fold the sheet down to its handle, or open it back up. */
function fold(next: boolean) {
  if (next === folded) return;
  folded = next;
  stage.toggleAttribute('data-folded', folded);
  handle.setAttribute('aria-expanded', String(!folded));
  if (folded && widget?.root.contains(document.activeElement)) handle.focus();
  layout();
}

/** Lay out again once the interface settles on a new size, but not for sub-pixel jitter. */
let settle = 0;
const watch = new ResizeObserver(() => {
  clearTimeout(settle);
  settle = window.setTimeout(() => {
    if (!widget || world.w === 0 || hidden) return;
    const off = (r: Rect, d: DOMRect) =>
      Math.abs(r.w - d.width) + Math.abs(r.h - d.height) + Math.abs(r.cx - d.left - d.width / 2) + Math.abs(r.cy - d.top - d.height / 2);
    const card = folded ? stage : widget.card;
    if (off(world.ui, stage.getBoundingClientRect()) + off(world.card, card.getBoundingClientRect()) > 4) layout();
  }, 120);
});

/** Fade the interface out so the scene has the whole screen. */
function setHidden(next: boolean) {
  if (next === hidden) return;
  hidden = next;
  root.classList.toggle('ui-hidden', hidden);
  hideButton.setAttribute('aria-pressed', String(hidden));
  hideButton.setAttribute('aria-label', hidden ? 'Show interface' : 'Hide interface');
  hideButton.title = hidden ? 'Show interface (H)' : 'Hide interface (H)';
  stage.inert = hidden;
  if (hidden && stage.contains(document.activeElement)) hideButton.focus();
  layout();
}
hideButton.addEventListener('click', () => setHidden(!hidden));

// the sheet only folds on phones; going wide opens it again
const sheet = matchMedia('(max-width: 560px)');
sheet.addEventListener('change', () => {
  if (!sheet.matches) fold(false);
});

handle.setAttribute('aria-expanded', 'true');
handle.addEventListener('click', () => {
  if (swiped) swiped = false;
  else fold(!folded);
});
// a swipe on the handle folds or opens the sheet the way it moved
let swipeFrom = -1;
let swiped = false;
handle.addEventListener('pointerdown', (e) => {
  swipeFrom = e.clientY;
  swiped = false;
  handle.setPointerCapture(e.pointerId);
});
handle.addEventListener('pointermove', (e) => {
  if (swipeFrom < 0) return;
  const dy = e.clientY - swipeFrom;
  if (Math.abs(dy) > 30) {
    swiped = true;
    swipeFrom = -1;
    fold(dy > 0);
  }
});
handle.addEventListener('pointerup', () => (swipeFrom = -1));
handle.addEventListener('pointercancel', () => (swipeFrom = -1));

let last = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (world.w === 0 || world.h === 0 || !scene) return;
  const sim = paused ? 0 : dt * (reducedMotion.matches ? 0.4 : 1);
  world.time += sim;
  widget?.tick?.(sim);

  const p = world.pointer;
  p.vx *= Math.exp(-dt * 8);
  p.vy *= Math.exp(-dt * 8);

  scene.update(sim, world);
  if (scene.backdropStale?.()) paintBackground();
  grid.cov.fill(0);
  grid.dots.length = 0;
  scene.raster(grid, world);
  if (appear < 1) {
    appear = Math.min(1, appear + dt * 1.4);
    const k = smoothstep(0, 1, appear);
    for (let i = 0; i < grid.cov.length; i++) grid.cov[i] *= k;
  }
  stepParticles(sim, scene.force);
  renderer.draw(world, grid);
}

/* ---------- input ---------- */

let lastMove = 0;
window.addEventListener('pointermove', (e) => {
  const p = world.pointer;
  const now = performance.now();
  const dt = Math.max(0.008, (now - lastMove) / 1000);
  if (p.active && now - lastMove < 100) {
    p.vx += ((e.clientX - p.x) / dt - p.vx) * 0.5;
    p.vy += ((e.clientY - p.y) / dt - p.vy) * 0.5;
  }
  lastMove = now;
  p.x = e.clientX;
  p.y = e.clientY;
  p.active = true;
});
window.addEventListener('pointerout', (e) => {
  if (!e.relatedTarget) world.pointer.active = false;
});
window.addEventListener('pointerup', (e) => {
  world.pointer.down = false;
  if (e.pointerType !== 'mouse') world.pointer.active = false;
});

canvas.addEventListener('pointerdown', (e) => {
  const p = world.pointer;
  p.x = e.clientX;
  p.y = e.clientY;
  p.vx = p.vy = 0;
  p.active = p.down = true;
  lastMove = performance.now();
  scene?.pointerDown?.(e.clientX, e.clientY, world);
  hint.classList.add('is-gone');
});

/** Text leaves the interface as a ring of sparks, then the scene answers. */
function submit(text: string, from: Element) {
  const r = from.getBoundingClientRect();
  for (let i = 0; i < 64; i++) {
    const a = rand() * TAU;
    const v = range(60, 160);
    const x = r.left + r.width / 2 + Math.cos(a) * r.width * 0.52;
    const y = r.top + r.height / 2 + Math.sin(a) * r.height * 0.6;
    spawn(x, y, Math.cos(a) * v, Math.sin(a) * v * 0.6, range(0.8, 1.8), range(0.4, 0.8), true);
  }
  scene?.submit?.(text, world);
}

/* ---------- controls ---------- */

function setMode(mode: Mode) {
  renderer.mode = mode;
  for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  store.set('proc:mode', mode);
  widget?.modeChanged?.(mode);
}
const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);

for (const b of modeButtons) {
  b.addEventListener('click', () => {
    if (isMode(b.dataset.mode)) setMode(b.dataset.mode);
  });
}

const findScene = (id: string | null | undefined) => SCENES.find((s) => s.id === id);
const findWidget = (id: string | null | undefined) => WIDGETS.find((w) => w.id === id);
const cycle = <T>(list: readonly T[], at: T, by: number) => list[(list.indexOf(at) + by + list.length) % list.length];
const stepScene = (by: number) => setScene(cycle(SCENES, info, by));
const stepWidget = (by: number) => setWidget(cycle(WIDGETS, ui, by));

for (const s of SCENES) scenePicker.add(new Option(s.label, s.id));
scenePicker.addEventListener('change', () => {
  const s = findScene(scenePicker.value);
  if (s) setScene(s);
});
prevScene.addEventListener('click', () => stepScene(-1));
nextScene.addEventListener('click', () => stepScene(1));

for (const w of WIDGETS) uiPicker.add(new Option(w.label, w.id));
uiPicker.addEventListener('change', () => {
  const w = findWidget(uiPicker.value);
  if (w) setWidget(w);
});
prevUi.addEventListener('click', () => stepWidget(-1));
nextUi.addEventListener('click', () => stepWidget(1));

const readHash = () => location.hash.slice(1).split('/');
window.addEventListener('hashchange', () => {
  const [s, w] = readHash();
  const sceneFromHash = findScene(s);
  const widgetFromHash = findWidget(w);
  if (sceneFromHash) setScene(sceneFromHash);
  if (widgetFromHash) setWidget(widgetFromHash);
});

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    setHidden(false);
    fold(false);
    if (ui.id === 'palette') widget?.focus?.();
    else setWidget(findWidget('palette')!, true);
    return;
  }
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'h' || e.key === 'H') return setHidden(!hidden);
  if (e.key === 'c' || e.key === 'C') return setTint(cycle(TINTS, tint, e.shiftKey ? -1 : 1));
  if (e.key === 'Escape' && hidden) return setHidden(false);
  if (e.key === 'ArrowLeft' || e.key === '[') return stepScene(-1);
  if (e.key === 'ArrowRight' || e.key === ']') return stepScene(1);
  if (e.key === 'ArrowUp') return stepWidget(-1);
  if (e.key === 'ArrowDown') return stepWidget(1);
  const mode = MODES[Number(e.key) - 1];
  if (mode) setMode(mode);
});

const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : prefersDark.matches);
function syncThemeButton() {
  themeButton.setAttribute('aria-pressed', String(isDark()));
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  root.dataset.theme = next;
  store.set('proc:theme', next);
  syncThemeButton();
  readTheme();
}
themeButton.addEventListener('click', toggleTheme);
prefersDark.addEventListener('change', () => {
  if (root.dataset.theme) return;
  syncThemeButton();
  readTheme();
});

/* ink colour */

const swatch = (el: HTMLElement, t: Tint) => {
  const ramp = isDark() ? t.dark : t.light;
  el.style.setProperty('--lo', ramp ? ramp[0] : null);
  el.style.setProperty('--hi', ramp ? ramp[1] : null);
};
const tintOptions = TINTS.map((t) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', t.label);
  b.title = t.label;
  b.innerHTML = '<span class="swatch" aria-hidden="true"></span>';
  b.addEventListener('click', () => {
    setTint(t);
    openTints(false);
    tintButton.focus();
  });
  tintPop.append(b);
  return b;
});
function paintSwatches() {
  swatch(tintButton.querySelector('.swatch')!, tint);
  TINTS.forEach((t, i) => swatch(tintOptions[i].querySelector('.swatch')!, t));
}
function setTint(next: Tint) {
  tint = next;
  tintName.textContent = next.label;
  TINTS.forEach((t, i) => {
    tintOptions[i].setAttribute('aria-checked', String(t === next));
    tintOptions[i].tabIndex = t === next ? 0 : -1;
  });
  store.set('proc:tint', next.id);
  readTheme();
}
function openTints(open: boolean) {
  tintPop.hidden = !open;
  tintButton.setAttribute('aria-expanded', String(open));
  if (open) tintOptions[TINTS.indexOf(tint)].focus();
}
tintButton.addEventListener('click', () => openTints(tintPop.hidden));
tintPop.addEventListener('keydown', (e) => {
  // arrows move through the swatches like any radio group
  const by = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (by) {
    e.preventDefault();
    e.stopPropagation();
    const next = cycle(TINTS, tint, by);
    setTint(next);
    tintOptions[TINTS.indexOf(next)].focus();
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    openTints(false);
    tintButton.focus();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!tintPop.hidden && !(e.target instanceof Node && tintButton.parentElement!.contains(e.target))) openTints(false);
});

const host: Host = {
  scenes: SCENES,
  widgets: WIDGETS,
  scene: () => info,
  setScene(id) {
    const s = findScene(id);
    if (s) setScene(s);
  },
  stepScene,
  mode: () => renderer.mode,
  setMode,
  toggleTheme,
  tints: TINTS,
  tint: () => tint.id,
  setTint(id) {
    const t = TINTS.find((t) => t.id === id);
    if (t) setTint(t);
  },
  setWidget(id) {
    const w = findWidget(id);
    if (w) setWidget(w, true);
  },
  isPaused: () => paused,
  setPaused(p) {
    paused = p;
  },
  input: () => scene?.input?.(world),
  submit,
};

/* ---------- boot ---------- */

const savedTheme = store.get('proc:theme');
if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;
syncThemeButton();
setTint(TINTS.find((t) => t.id === store.get('proc:tint')) ?? TINTS[0]);

const savedMode = store.get('proc:mode');
setMode(isMode(savedMode) ? savedMode : 'tiles');

const [hashScene, hashWidget] = readHash();
setScene(findScene(hashScene) ?? findScene(store.get('proc:scene')) ?? SCENES[0]);
setWidget(findWidget(hashWidget) ?? findWidget(store.get('proc:ui')) ?? WIDGETS[0]);
appear = 1;
particles.length = 0;
window.addEventListener('resize', layout);
document.fonts?.ready.then(layout);
requestAnimationFrame(frame);
