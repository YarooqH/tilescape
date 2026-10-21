import { rand } from '../math';
import type { SceneInfo } from '../scene';
import { html, icons, pick, uid } from './dom';
import type { Host, Widget } from './types';

interface Persona {
  name: string;
  status: string;
  hello: string;
  replies: string[];
}

const PERSONAS: Record<string, Persona> = {
  'koi-pond': {
    name: 'the koi pond',
    status: 'answers in ripples',
    hello: 'The water is still. Say something and watch it move.',
    replies: ['A ring of ripples spreads out from where you spoke.', 'The koi turned toward the sound, all at once.', 'The water settles. It heard you.'],
  },
  dragon: {
    name: 'the dragon',
    status: 'warm, mostly asleep',
    hello: 'It is circling the pearl. Type softly; it snorts at every key.',
    replies: ['It answered in fire.', 'Smoke from both nostrils. Take that as a yes.', 'It breathed on that one. Twice as long as needed.'],
  },
  'black-hole': {
    name: 'the black hole',
    status: 'takes everything, returns jets',
    hello: 'Anything you send goes past the horizon.',
    replies: ['Your words went in. Two jets came out.', 'Nothing escapes, except this reply.', 'It took the message and glowed a little brighter.'],
  },
  planets: {
    name: 'the planets',
    status: 'replies once per orbit',
    hello: 'Five worlds, one sun. Keep it short; light is slow.',
    replies: ['The sun flared at that.', 'A flare went out across every orbit.', 'Somewhere past the last planet, a comet changed course.'],
  },
  'deep-space': {
    name: 'deep space',
    status: 'a long way off',
    hello: 'Mostly empty. Mostly listening.',
    replies: ['Everything stretched into light for a second.', 'Warp, then quiet.', 'The stars rushed past. Say it again?'],
  },
  'smoke-fire': {
    name: 'the fire',
    status: 'crackling',
    hello: 'Pull up a chair. Every key you press feeds it.',
    replies: ['The flames jumped to read it.', 'Sparks carried that one up.', 'It burned bright for a moment.'],
  },
  murmuration: {
    name: 'the flock',
    status: 'speaks in shapes',
    hello: 'Send a word. Short ones are easier to fly.',
    replies: ['Look up: they spelled it out.', 'The whole flock wrote that for you.', 'They’ll hold the shape for a moment, then scatter.'],
  },
  vines: {
    name: 'the vines',
    status: 'growing, slowly',
    hello: 'They lean toward attention. Say something kind.',
    replies: ['Everything bloomed at once.', 'The vines flowered when you said that.', 'Petals opened all along the stems.'],
  },
};

const fallback = (info: SceneInfo): Persona => ({
  name: info.label,
  status: 'listening',
  hello: 'Say something.',
  replies: ['It heard you.'],
});

const KEEP = 40;

/** A one-to-one chat where the scene is the other person and answers by acting. */
export function thread(host: Host): Widget {
  const id = uid('thread');
  const root = html(`
    <div class="thread">
      <section class="thread-card" data-card aria-labelledby="${id}-h">
        <header class="thread-head">
          <span class="thread-avatar" aria-hidden="true">${icons.glyph}</span>
          <div>
            <h2 id="${id}-h"></h2>
            <p class="thread-status"></p>
          </div>
        </header>
        <div class="thread-log" role="log" aria-live="polite" aria-labelledby="${id}-h"></div>
        <form class="thread-form" autocomplete="off">
          <label class="sr-only" for="${id}-in">Message</label>
          <input id="${id}-in" type="text" />
          <button type="submit" aria-label="Send">${icons.up}</button>
        </form>
      </section>
    </div>`);
  const log = pick(root, '.thread-log');
  const form = pick<HTMLFormElement>(root, 'form');
  const input = pick<HTMLInputElement>(root, 'input');
  const name = pick(root, 'h2');
  const status = pick(root, '.thread-status');

  let persona = fallback(host.scene());
  let pending = 0;
  let typing: HTMLElement | null = null;

  function say(text: string, from: 'me' | 'them' | 'note') {
    const msg = document.createElement('p');
    msg.className = `thread-msg thread-${from}`;
    msg.textContent = text;
    log.append(msg);
    while (log.childElementCount > KEEP) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  function meet(info: SceneInfo) {
    clearTimeout(pending);
    typing?.remove();
    typing = null;
    persona = PERSONAS[info.id] ?? fallback(info);
    name.textContent = persona.name;
    status.textContent = persona.status;
    input.placeholder = `Message ${persona.name}`;
    if (log.childElementCount) say(`now talking to ${persona.name}`, 'note');
    say(persona.hello, 'them');
  }

  input.addEventListener('input', () => host.input());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    say(text, 'me');
    host.submit(text, form);
    clearTimeout(pending);
    if (!typing) {
      typing = say('', 'them');
      typing.classList.add('thread-typing');
      typing.innerHTML = '<i></i><i></i><i></i>';
      typing.setAttribute('aria-label', `${persona.name} is replying`);
    }
    const reply = persona.replies[(rand() * persona.replies.length) | 0];
    pending = window.setTimeout(() => {
      typing?.remove();
      typing = null;
      say(reply, 'them');
    }, 900 + rand() * 600);
  });

  meet(host.scene());
  return {
    root,
    card: pick(root, '.thread-card'),
    sceneChanged: meet,
    focus: () => input.focus(),
    destroy: () => clearTimeout(pending),
  };
}
