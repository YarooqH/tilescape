import type { Mode } from '../render';
import { html, icons, isMac, pick, uid } from './dom';
import type { Host, Widget } from './types';

interface Command {
  group: string;
  label: string;
  /** extra words that should match a search */
  terms?: string;
  meta?: string;
  current?: boolean;
  run(): void;
}

const MODES: Mode[] = ['tiles', 'ascii', 'halftone'];

/**
 * A command palette: a slim search bar that drops its list open on focus. Jump between
 * scenes and styles, or send free text into the scene.
 */
export function palette(host: Host): Widget {
  const id = uid('palette');
  const root = html(`
    <div class="palette">
      <div class="palette-card" data-card>
        <form class="palette-search" autocomplete="off">
          ${icons.search}
          <label class="sr-only" for="${id}-q">Search commands</label>
          <input id="${id}-q" type="text" role="combobox" aria-expanded="false" aria-controls="${id}-list" aria-autocomplete="list" spellcheck="false" placeholder="Jump to a scene, or type anything" />
          <kbd class="palette-kbd">${isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </form>
      </div>
      <div class="palette-drop">
        <ul class="palette-list" id="${id}-list" role="listbox" aria-label="Commands"></ul>
        <div class="palette-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
          <span class="palette-count"></span>
        </div>
      </div>
    </div>`);
  const form = pick<HTMLFormElement>(root, 'form');
  const input = pick<HTMLInputElement>(root, 'input');
  const list = pick<HTMLUListElement>(root, 'ul');
  const count = pick(root, '.palette-count');

  let shown: Command[] = [];
  let active = 0;

  function open(next: boolean) {
    root.toggleAttribute('data-open', next);
    input.setAttribute('aria-expanded', String(next));
    if (next) setActive(active);
  }

  function commands(): Command[] {
    const current = host.scene();
    const mode = host.mode();
    return [
      ...host.scenes.map((s, i) => ({
        group: 'Scenes',
        label: s.label,
        terms: s.id,
        meta: s === current ? 'showing' : String(i + 1).padStart(2, '0'),
        current: s === current,
        run: () => host.setScene(s.id),
      })),
      ...MODES.map((m, i) => ({
        group: 'Render as',
        label: m,
        meta: m === mode ? 'on' : String(i + 1),
        current: m === mode,
        run: () => host.setMode(m),
      })),
      { group: 'Render as', label: 'flip light / dark', terms: 'theme dark light', run: () => host.toggleTheme() },
      ...host.widgets
        .filter((w) => w.id !== 'palette')
        .map((w) => ({ group: 'Swap interface', label: w.label, terms: 'ui interface', run: () => host.setWidget(w.id) })),
    ];
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    shown = commands().filter((c) => !q || `${c.label} ${c.group} ${c.terms ?? ''}`.toLowerCase().includes(q));
    if (q) {
      const send: Command = {
        group: 'Send',
        label: `“${input.value.trim()}”`,
        meta: `to ${host.scene().label}`,
        run: () => {
          host.submit(input.value.trim(), form);
        },
      };
      if (shown.length) shown.push(send);
      else shown = [send];
    }
    active = Math.min(active, shown.length - 1);

    list.replaceChildren();
    let group = '';
    shown.forEach((c, i) => {
      if (c.group !== group) {
        group = c.group;
        const head = document.createElement('li');
        head.className = 'palette-group';
        head.setAttribute('role', 'presentation');
        head.textContent = group;
        list.append(head);
      }
      const li = document.createElement('li');
      li.id = `${id}-o${i}`;
      li.className = 'palette-option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      if (c.current) li.dataset.current = '';
      const label = document.createElement('span');
      label.textContent = c.label;
      li.append(label);
      if (c.meta) {
        const meta = document.createElement('span');
        meta.className = 'palette-meta';
        meta.textContent = c.meta;
        li.append(meta);
      }
      // keep focus in the field so typing carries on after a click
      li.addEventListener('pointerdown', (e) => e.preventDefault());
      li.addEventListener('click', () => run(i));
      li.addEventListener('pointermove', () => {
        if (active !== i) setActive(i);
      });
      list.append(li);
    });
    count.textContent = shown.length === 1 ? '1 result' : `${shown.length} results`;
    setActive(active);
  }

  function setActive(i: number) {
    active = i;
    for (const li of list.querySelectorAll('[role="option"]')) li.setAttribute('aria-selected', String(li.id === `${id}-o${i}`));
    const el = list.querySelector<HTMLElement>(`#${id}-o${i}`);
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function run(i: number) {
    const c = shown[i];
    if (!c) return;
    c.run();
    input.value = '';
    active = 0;
    render();
    open(false);
  }

  input.addEventListener('input', () => {
    active = 0;
    render();
    open(true);
    host.input();
  });
  input.addEventListener('focus', () => open(true));
  input.addEventListener('click', () => open(true));
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget as Node | null)) open(false);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!root.hasAttribute('data-open')) open(true);
      else if (shown.length) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) {
        input.value = '';
        render();
      } else if (root.hasAttribute('data-open')) open(false);
      else input.blur();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(active);
  });

  render();
  return {
    root,
    card: pick(root, '.palette-card'),
    sceneChanged: render,
    modeChanged: render,
    focus: () => {
      input.focus();
      open(true);
    },
  };
}
