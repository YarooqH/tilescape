import { html, icons, pick, store, uid } from './dom';
import type { Host, Widget } from './types';

interface Note {
  at: number;
  scene: string;
  text: string;
}

const KEY = 'proc:notes';
const KEEP = 30;
const MAX = 80;

function load(): Note[] {
  try {
    const v: unknown = JSON.parse(store.get(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((n): n is Note => typeof n?.text === 'string' && typeof n?.at === 'number').slice(-KEEP) : [];
  } catch {
    return [];
  }
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** A ruled notebook page; each line written is also released into the scene. */
export function notes(host: Host): Widget {
  const id = uid('notes');
  const root = html(`
    <div class="notes">
      <section class="notes-card" data-card aria-labelledby="${id}-h">
        <header class="notes-head">
          <h2 id="${id}-h">Field notes</h2>
          <time></time>
        </header>
        <ol class="notes-list" aria-labelledby="${id}-h"></ol>
        <form class="notes-form" autocomplete="off">
          <label class="sr-only" for="${id}-in">New note</label>
          <input id="${id}-in" type="text" maxlength="${MAX}" placeholder="Write a line, press enter" aria-describedby="${id}-left" />
          <span class="notes-left" id="${id}-left" aria-live="off"></span>
        </form>
      </section>
    </div>`);
  const list = pick<HTMLOListElement>(root, 'ol');
  const form = pick<HTMLFormElement>(root, 'form');
  const input = pick<HTMLInputElement>(root, 'input');
  const left = pick(root, '.notes-left');
  const today = pick<HTMLTimeElement>(root, 'time');

  const now = new Date();
  today.dateTime = now.toISOString().slice(0, 10);
  today.textContent = day.format(now);

  let items = load();

  function render() {
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'notes-empty';
      empty.textContent = 'Nothing yet. Each line you write drifts into the scene.';
      list.append(empty);
    }
    items.forEach((n, i) => {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.dateTime = new Date(n.at).toISOString();
      time.textContent = clock.format(n.at);
      const text = document.createElement('span');
      text.className = 'notes-text';
      text.textContent = n.text;
      const where = document.createElement('span');
      where.className = 'notes-where';
      where.textContent = n.scene;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'notes-del';
      del.setAttribute('aria-label', `Delete note: ${n.text}`);
      del.innerHTML = icons.close;
      del.addEventListener('click', () => {
        items.splice(i, 1);
        save();
        render();
        input.focus();
      });
      li.append(time, text, where, del);
      list.append(li);
    });
    list.scrollTop = list.scrollHeight;
  }

  function save() {
    store.set(KEY, JSON.stringify(items));
  }

  function count() {
    const n = MAX - input.value.length;
    left.textContent = String(n);
    left.toggleAttribute('data-low', n <= 10);
  }

  input.addEventListener('input', () => {
    count();
    host.input();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    items.push({ at: Date.now(), scene: host.scene().label, text });
    items = items.slice(-KEEP);
    save();
    input.value = '';
    count();
    render();
    host.submit(text, form);
  });

  render();
  count();
  return { root, card: pick(root, '.notes-card'), focus: () => input.focus() };
}
