import { html, icons, pick, uid } from './dom';
import type { Host, Widget } from './types';

/** An editorial launch page with a single email field. */
export function waitlist(host: Host): Widget {
  const id = uid('wait');
  const root = html(`
    <div class="wait">
      <div class="wait-inner" data-card>
        <p class="wait-over"></p>
        <h1 class="wait-title">Something slow<br /><em>is taking shape.</em></h1>
        <p class="wait-copy">One letter when it’s ready. Nothing before that.</p>
        <form class="wait-form" novalidate autocomplete="off">
          <label class="sr-only" for="${id}-email">Email address</label>
          <input id="${id}-email" type="email" inputmode="email" required placeholder="you@somewhere.com" aria-describedby="${id}-note" />
          <button type="submit"><span>Notify me</span>${icons.right}</button>
        </form>
        <p class="wait-note" id="${id}-note" aria-live="polite">No newsletter, no tracking.</p>
      </div>
    </div>`);
  const over = pick(root, '.wait-over');
  const form = pick<HTMLFormElement>(root, 'form');
  const input = pick<HTMLInputElement>(root, 'input');
  const note = pick(root, '.wait-note');

  function label() {
    const s = host.scene();
    over.textContent = `No. ${String(host.scenes.indexOf(s) + 1).padStart(2, '0')} — ${s.label}`;
  }

  input.addEventListener('input', () => {
    host.input();
    if (input.getAttribute('aria-invalid')) {
      input.removeAttribute('aria-invalid');
      note.removeAttribute('data-state');
      note.textContent = 'No newsletter, no tracking.';
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value || !input.checkValidity()) {
      input.setAttribute('aria-invalid', 'true');
      note.dataset.state = 'error';
      note.textContent = value ? 'That address looks unfinished.' : 'An email address goes here.';
      return;
    }
    input.value = '';
    note.dataset.state = 'done';
    note.textContent = `Noted. We’ll write to ${value} once.`;
    host.submit(value.split('@')[0], form);
  });

  label();
  return { root, card: pick(root, '.wait-inner'), sceneChanged: label, focus: () => input.focus() };
}
