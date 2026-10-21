import type { Mode } from '../render';
import type { SceneInfo } from '../scene';
import { html, pick, uid } from './dom';
import type { Host, Widget } from './types';

const MODES: Mode[] = ['tiles', 'ascii', 'halftone'];
const KEEP = 80;

/** A small shell: commands drive the page, anything else goes to the scene. */
export function terminal(host: Host): Widget {
  const id = uid('term');
  const root = html(`
    <div class="term">
      <section class="term-card" data-card aria-label="Terminal">
        <header class="term-bar">
          <span class="term-path"></span>
          <span class="term-tty">tty1</span>
        </header>
        <div class="term-log" role="log" aria-live="polite"></div>
        <form class="term-line" autocomplete="off">
          <label class="term-ps1" for="${id}-in"></label>
          <input id="${id}-in" type="text" spellcheck="false" autocapitalize="off" aria-describedby="${id}-help" />
        </form>
        <p class="sr-only" id="${id}-help">Type help for commands. Anything else is sent to the scene.</p>
      </section>
    </div>`);
  const card = pick(root, '.term-card');
  const log = pick(root, '.term-log');
  const form = pick<HTMLFormElement>(root, 'form');
  const input = pick<HTMLInputElement>(root, 'input');
  const ps1 = pick(root, '.term-ps1');
  const path = pick(root, '.term-path');

  const history: string[] = [];
  let back = 0;

  function print(text: string, kind: 'out' | 'cmd' | 'dim' | 'err' = 'out') {
    const line = document.createElement('div');
    line.className = `term-${kind}`;
    line.textContent = text;
    log.append(line);
    while (log.childElementCount > KEEP) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
  }

  const findScene = (q: string) => {
    const s = q.toLowerCase();
    return host.scenes.find((x) => x.id === s || x.label === s) ?? host.scenes.find((x) => x.id.startsWith(s) || x.label.startsWith(s));
  };

  const commands: Record<string, { help: string; run(arg: string): void }> = {
    help: {
      help: 'this list',
      run() {
        for (const [name, c] of Object.entries(commands)) print(`  ${name.padEnd(7)}${c.help}`);
        print('anything else is sent to the scene', 'dim');
      },
    },
    ls: {
      help: 'list scenes',
      run() {
        const now = host.scene();
        for (const s of host.scenes) print(`${s === now ? '*' : ' '} ${s.id}`, s === now ? 'out' : 'dim');
      },
    },
    open: {
      help: 'open <scene>',
      run(arg) {
        if (!arg) return print('usage: open <scene>', 'err');
        const s = findScene(arg);
        if (!s) return print(`no such scene: ${arg}`, 'err');
        host.setScene(s.id);
      },
    },
    next: { help: 'next scene', run: () => host.stepScene(1) },
    prev: { help: 'previous scene', run: () => host.stepScene(-1) },
    mode: {
      help: 'mode [tiles|ascii|halftone]',
      run(arg) {
        if (!arg) return print(host.mode());
        const m = MODES.find((x) => x.startsWith(arg.toLowerCase()));
        if (!m) return print(`unknown mode: ${arg}`, 'err');
        host.setMode(m);
        print(`render: ${m}`, 'dim');
      },
    },
    theme: { help: 'flip light / dark', run: () => host.toggleTheme() },
    ui: {
      help: 'ui <name>',
      run(arg) {
        const w = host.widgets.find((x) => x.id === arg.toLowerCase() || x.label === arg.toLowerCase());
        if (!w) return print(`try one of: ${host.widgets.map((x) => x.id).join(', ')}`, arg ? 'err' : 'dim');
        host.setWidget(w.id);
      },
    },
    clear: { help: 'clear the screen', run: () => log.replaceChildren() },
  };

  function exec(line: string) {
    print(`${ps1.textContent} ${line}`, 'cmd');
    const [name, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    const cmd = commands[name.toLowerCase()];
    if (cmd) cmd.run(arg);
    else {
      host.submit(line, card);
      print(`→ sent to ${host.scene().label}`, 'dim');
    }
  }

  function prompt(info: SceneInfo) {
    ps1.textContent = `${info.id} %`;
    path.textContent = `~/scenes/${info.id}`;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = input.value.trim();
    input.value = '';
    back = 0;
    if (!line) return print(`${ps1.textContent}`, 'cmd');
    if (history[history.length - 1] !== line) history.push(line);
    exec(line);
  });
  input.addEventListener('input', () => host.input());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    back = Math.max(0, Math.min(history.length, back + (e.key === 'ArrowUp' ? 1 : -1)));
    input.value = back ? history[history.length - back] : '';
  });
  // clicking anywhere in the window types into it, unless the reader is selecting text
  card.addEventListener('click', () => {
    if (!getSelection()?.toString()) input.focus();
  });

  prompt(host.scene());
  print('procedural scenes, tty1');
  print("type 'help' for commands, or just say something", 'dim');

  return {
    root,
    card,
    sceneChanged(info) {
      prompt(info);
      print(`opened ${info.label}`, 'dim');
    },
    focus: () => input.focus(),
  };
}
