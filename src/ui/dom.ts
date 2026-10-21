/** Build one element from static markup. Never pass user text through here. */
export function html<T extends HTMLElement = HTMLElement>(markup: string): T {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as T;
}

export const pick = <T extends Element = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

let next = 0;
export const uid = (prefix: string) => `${prefix}-${++next}`;

export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

export const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: settings just won't stick */
    }
  },
};

const svg = (size: number, body: string, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const icons = {
  up: svg(14, '<path d="M7 11.5v-9M3 6.5l4-4 4 4" />'),
  right: svg(14, '<path d="M2.5 7h9M7.5 3l4 4-4 4" />'),
  search: svg(16, '<circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" />'),
  close: svg(12, '<path d="m3 3 6 6M9 3 3 9" />'),
  prev: svg(16, '<path d="M4 3v10" /><path d="M13 3.5 6.5 8l6.5 4.5z" fill="currentColor" />'),
  next: svg(16, '<path d="M12 3v10" /><path d="M3 3.5 9.5 8 3 12.5z" fill="currentColor" />'),
  play: svg(18, '<path d="M5.5 3.5v11l9-5.5z" fill="currentColor" />'),
  pause: svg(18, '<path d="M6 4v10M12 4v10" stroke-width="2.4" />'),
  /** the little dither glyph the hint chip uses */
  glyph: '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="3" height="3" /><rect x="6" y="5" width="2" height="2" /><rect x="3" y="7" width="2" height="2" /><rect x="8" y="2" width="2" height="2" /></svg>',
};
