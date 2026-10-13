import { TV_LIGHT_ORDER, TV_LIGHTS, checkTvLight, nextTvLight, tvLightOf, type TvLight } from '../../../shared/tv';
import { hintTitle, key } from '../../core/hint';
import { h } from '../../ui/dom';

/**
 * The room's light, in the three settings the switch by the TV walks through (see shared/tv.ts). The
 * switch, the TV window, the hint bar and the sky all read this one table, so what the plate says and
 * what the room does can't disagree.
 *
 * The light itself is the sky's to give — `Sky.setRoomLight` dims and warms every fragment indoors and
 * eases there over about a second (see world/sky.ts). All this decides is how much, and how warm.
 *
 * `down` is a share of ROOM_DIM, the most the lights-out setting takes: 0 leaves the room exactly as
 * it was, and 0.42 leaves it a bit over half — enough that desks, walkways and the people at them are
 * all plainly there, which is the whole point of the middle setting.
 */
export const ROOM_LIGHT: Record<TvLight, { down: number; warm: number }> = {
  bright: { down: 0, warm: 0 },
  dim: { down: 0.42, warm: 1 },
  off: { down: 1, warm: 0 },
};

/**
 * What the sky is asked for: the setting, or the room as usual when you aren't on this floor. Guarded
 * here as well as at the state slice, so a table lookup can never land on `undefined` — `ROOM_LIGHT`
 * is indexed with whatever the floor's state says.
 */
export function roomLightFor(mode: TvLight, inOffice: boolean): { down: number; warm: number } {
  return inOffice ? (ROOM_LIGHT[checkTvLight(mode) ?? 'bright'] ?? ROOM_LIGHT.bright) : ROOM_LIGHT.bright;
}

/** What the setting is called, with its icon, for the window and anything else that names it. */
export const lightName = (mode: TvLight) => `${TV_LIGHTS[mode].icon} ${TV_LIGHTS[mode].label}`;

/**
 * The hint bar at the switch: which setting the room is in, and where **E** takes it next. The mode
 * is in the key too, since it's part of the bar's cache key and the words change with it.
 */
export const lightHint = (mode: TvLight) => ({
  k: `light:${mode}`,
  parts: [hintTitle(lightName(mode)), key('E', `Next: ${lightName(nextTvLight(mode))}`)],
});

/**
 * The three settings as a row of buttons, for the TV window — the same switch as the plate on the
 * wall, for anyone on the couch rather than standing at it. The buttons are built once and `paint`
 * only flips which is checked, so repainting as the floor's setting changes never drops the keyboard
 * focus somebody is arrowing round the group with.
 */
export function lightRow(get: () => TvLight, set: (mode: TvLight) => void): { el: HTMLElement; paint(): void } {
  const buttons = TV_LIGHT_ORDER.map((mode) =>
    h(
      'button.btn',
      {
        type: 'button',
        role: 'radio',
        title: TV_LIGHTS[mode].note,
        // Just the send: the store drives the paint when the floor's setting lands, so there is no
        // rebuild here that would show the old setting a moment longer anyway.
        onclick: () => {
          if (get() !== mode) set(mode);
        },
      },
      lightName(mode),
    ),
  );
  const paint = () =>
    buttons.forEach((b, i) => {
      const on = get() === TV_LIGHT_ORDER[i];
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  const el = h('div.seg', { role: 'radiogroup', 'aria-label': "The room's light" }, ...buttons);
  paint();
  return { el, paint };
}

/** The setting a floor's state says, from a state that may be from an office that had one switch. */
export const lightOf = (state: { light?: unknown; theatre?: unknown } | undefined): TvLight => tvLightOf(state);
