import type { SceneInfo } from '../scene';
import { html, icons, pick } from './dom';
import type { Host, Widget } from './types';

/** seconds per scene before the player moves on */
const LENGTH = 60;

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A now-playing card: every scene is a track, pause freezes the simulation. */
export function player(host: Host): Widget {
  const root = html(`
    <div class="player">
      <section class="player-card" data-card aria-label="Scene player">
        <div class="player-top">
          <div class="player-art" aria-hidden="true"><span></span></div>
          <div class="player-meta">
            <p class="player-over"></p>
            <h2 class="player-title"></h2>
            <p class="player-sub"></p>
          </div>
        </div>
        <div class="player-progress" aria-hidden="true">
          <span class="player-t0">0:00</span>
          <div class="player-bar"><i></i></div>
          <span class="player-t1">${time(LENGTH)}</span>
        </div>
        <div class="player-controls">
          <button type="button" class="player-btn" data-act="prev" aria-label="Previous scene">${icons.prev}</button>
          <button type="button" class="player-btn player-main" data-act="play" aria-label="Pause"></button>
          <button type="button" class="player-btn" data-act="next" aria-label="Next scene">${icons.next}</button>
        </div>
      </section>
    </div>`);
  const art = pick(root, '.player-art span');
  const over = pick(root, '.player-over');
  const title = pick(root, '.player-title');
  const sub = pick(root, '.player-sub');
  const t0 = pick(root, '.player-t0');
  const bar = pick(root, '.player-bar i');
  const play = pick<HTMLButtonElement>(root, '[data-act="play"]');

  let elapsed = 0;
  let shownSecond = -1;

  function track(info: SceneInfo) {
    const n = host.scenes.indexOf(info) + 1;
    art.textContent = String(n).padStart(2, '0');
    over.textContent = `Now showing · ${n} of ${host.scenes.length}`;
    title.textContent = info.label;
    elapsed = 0;
    draw();
  }

  function subline() {
    sub.textContent = `procedural · ${host.mode()}`;
  }

  function draw() {
    bar.style.transform = `scaleX(${elapsed / LENGTH})`;
    const s = Math.floor(elapsed);
    if (s !== shownSecond) {
      shownSecond = s;
      t0.textContent = time(s);
    }
  }

  function syncPlay() {
    const paused = host.isPaused();
    play.innerHTML = paused ? icons.play : icons.pause;
    play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  play.addEventListener('click', () => {
    host.setPaused(!host.isPaused());
    syncPlay();
  });
  pick(root, '[data-act="prev"]').addEventListener('click', () => host.stepScene(-1));
  pick(root, '[data-act="next"]').addEventListener('click', () => host.stepScene(1));

  track(host.scene());
  subline();
  syncPlay();
  return {
    root,
    card: pick(root, '.player-card'),
    tick(dt) {
      elapsed += dt;
      if (elapsed >= LENGTH) host.stepScene(1);
      else draw();
    },
    sceneChanged: track,
    modeChanged: subline,
    focus: () => play.focus(),
    destroy: () => host.setPaused(false),
  };
}
