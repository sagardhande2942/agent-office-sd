---
title: "The room's light at the TV: three settings, one shader colour"
summary: "How the switch by the TV dims and warms the office in three settings, where the numbers live, and why the sky computes them fresh each frame."
author: "worker:675f32e19e5a"
updated: "2026-10-13"
status: "active"
---
The wall switch by the office TV used to be one boolean (`TvState.theatre`) that put the whole room's own light out. It is now three settings — `'bright' | 'dim' | 'off'` in `TvState.light`.

## Where the pieces are

| Piece | Where |
| --- | --- |
| The names, labels and cycle | `TV_LIGHTS`, `TV_LIGHT_ORDER`, `nextTvLight`, `checkTvLight` in `src/shared/tv.ts` (client **and** server read these) |
| How much down, how warm, per setting | `ROOM_LIGHT` in `src/client/features/tv/lighting.ts` — the only place to change the look |
| The hint at the plate, the three-button row | the same `features/tv/lighting.ts` module |
| The switch's three resting angles and lamp colours | `src/client/world/theatre.ts` |
| The light as numbers | `src/client/world/room-light.ts` — `ROOM_DIM`, the warm `ROOM_WARM` (normalised by `luma`), `levelFor` and the one `roomColor` expression. `sky.ts` re-exports it and sets the `skyRoom` uniform from it |
| The wire messages | `tv.lights { light }`, plus the old `tv.theatre { on }` still answered |
| The browser check | `npm run e2e:tv-lights` (`scripts/e2e-tv-lights.mjs`), screenshots in `/tmp/agent-office-tv-lights-evidence` |

## Two things that are easy to get wrong

**The warm tint must cost no brightness.** `ROOM_WARM` is normalised by its own luma (`luma()`). Without that, a warm room is *also* a darker room, and the two effects can't be reasoned about or tested separately — `luma(ROOM_WARM) === 1` in `tests/tv-light.test.ts` is what pins it.

**Never multiply onto the last frame.** `Sky.update` recomputes the uniform from the setting asked for, not from what the last frame left. The one expression is `roomColor` in `room-light.ts`, which the frame loop and `tests/tv-light.test.ts` both call — so the "no drift" test really runs the shipped arithmetic instead of a copy of it:

```ts
const down0 = this.roomDown;
const warm0 = this.roomWarm;
this.roomDown = step(this.roomDown, this.room.down, 1.1);
this.roomWarm = step(this.roomWarm, this.room.warm, 1.1);
this.roomLevel = levelFor(this.roomDown);
if (this.roomDown !== down0 || this.roomWarm !== warm0) uniforms.skyRoom.value.copy(roomColor(this.roomDown, this.roomWarm));
```

Only the eased scalars carry over. Coming back to `bright` is exactly `(1,1,1)`, so throwing the switch a hundred times doesn't leave the office a little darker each time. The uniform is only recomputed while the eased values actually move.

## Trust boundary and backwards compatibility

Three settings arrive from several places, so each is guarded where it is indexed, not only at one caller:

- The client state slice (`src/client/state/slices/tv.ts`) runs every incoming state through `tvLightOf`: `checkTvLight(light) ?? (theatre === true ? 'off' : 'bright')`.
- `roomLightFor` re-checks with `checkTvLight` and falls back to `ROOM_LIGHT.bright`; `theatre.show` re-checks before indexing `TILT`/`LAMP`. A bad string would otherwise give `undefined` and a permanent `NaN` in the rocker's rotation.
- `TvState.theatre` is optional and still read *and* written: `Tv.theatre(on, by)` is a thin call into `Tv.lights(on ? 'off' : 'bright', by)`, the server sets `theatre: light !== 'bright'` (an older *browser* asking for the dim goes fully dark), and a `tv.json` with only `theatre` loads as the setting that boolean meant.
- An older **floor host** is told `tv.theatre { on: light === 'off' }` when it did not announce the `lights` capability (`FloorReady.lights`), so only lights-out is ever asked of its one-position switch; a host that can do neither gets "Update the floor host to support the room's three light settings" as a toast (the office's `RemoteFloor.tv.lights` returns the string, and `ws/handlers/fork.ts` warns with it).

## Verifying a change to the look

```bash
npm run build && npm run e2e:tv-lights
```

Chromium here needs its shared libraries on `LD_LIBRARY_PATH`, or it will not launch at all (see `gotchas/headless-chromium-libs.md`):

```bash
LD_LIBRARY_PATH=/tmp/opencode/libs/usr/lib/x86_64-linux-gnu:/tmp/opencode/libs/usr/lib/x86_64-linux-gnu/nss npm run e2e:tv-lights
```

The script measures the back wall's and the walkway's own pixels out of the saved screenshots and asserts `off < dim < bright` in brightness and that `dim` is warmer than `bright`, so a change that looks wrong fails on numbers rather than on opinion.

## Size

The tuning used to live in `sky.ts`, which sits under `tests/size.test.ts`'s ceiling. It is now in the small `room-light.ts`, both to keep `sky.ts` clear of its ceiling and because the numbers are pure and worth reading on their own.