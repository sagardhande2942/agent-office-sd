import { TV_OFF, tvLightOf, type TvState } from '../../../shared/tv';
import type { Slice } from '../store';
declare module '../store' { interface Store { tv: TvState; } interface Topics { tv: true; } }
/** An office from before the three settings sends only the boolean switch, so read that into a mode. */
const lit = (state: TvState): TvState => ({ ...state, light: tvLightOf(state) });
export const tv: Slice = { init(s) { s.tv=TV_OFF; }, enter(s,v) { s.tv=lit(v.tv??TV_OFF); return ['tv']; }, on: { tv(s,m) { s.tv=lit(m.state); return ['tv']; } } };
