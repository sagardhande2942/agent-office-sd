import { Mover } from '../../moving';
import { trackTitle } from '../../../shared/jukebox';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { clip } from '../../ui/dom';
import { openJukebox } from './ui';
import type { SettingsPane } from '../../ui/settings';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    jukebox: true;
  }
}

export interface JukeboxDeps {
  /** Settings, open at `pane` (the music's volume is under Sound). */
  showSettings(pane?: SettingsPane): void;
}

/** The jukebox on your floor, the office's own: what's on, and E to put a song on. */
export function installJukebox(ctx: Ctx, deps: JukeboxDeps) {
  const mover = new Mover(ctx.net, ctx.camera, ctx.canvas, ctx.player, ctx.office);
  ctx.scene.add(mover.ghost.group);
  ctx.ticks.add('world', () => mover.update());
  ctx.activities.add({ id:'jukebox-move', active:()=>mover.active, stop:()=>mover.cancel(), key:e=> {
    if(e.code==='Escape') { mover.cancel(); return true; }
    if(e.code==='KeyE'||e.code==='Enter') { mover.place(); return true; }
    return false;
  }, hint:el=>ctx.hint.draw(el,'jukebox-move',()=>[hintTitle('Move jukebox'),key('E','Place'),key('Esc','Cancel')]) });
  ctx.canvas.addEventListener('click',()=> { if(mover.active) mover.place(); });
  // The jukebox on your floor: everyone there hears it from the same bar, and its lights say what's on.
  // It's the office's: on a map of its own there's none to hear.
  function playJukebox() {
    const j = store.jukebox;
    ctx.sound.setJukebox(j.on && ctx.inOffice() ? { track: j.track, url: j.url, startedAt: j.startedAt, since: j.since } : null);
    if (j.spot) { ctx.office.jukebox.at(j.spot); ctx.sound.setJukeboxSpot(j.spot); }
    ctx.office.jukebox.show(j.on, trackTitle(j));
  }
  store.on('jukebox', playJukebox);
  ctx.interactions.define('jukebox', {
    reach: 4,
    hint: () => {
      const j = store.jukebox;
      const what = j.on ? trackTitle(j) : '';
      return { k: `${j.on}|${what}`, parts: [hintTitle('🎵 Jukebox'), aside(j.on ? `♪ ${clip(what, 40)}` : 'off'), key('E', j.on ? 'Change the song' : 'Put on a song')] };
    },
    use: onE(() => showJukebox()),
  });

  function showJukebox() {
    openJukebox(ctx.net, () => deps.showSettings('sound'), () => mover.start());
  }

  return { playJukebox };
}
