import { TV_OFF, type TvState } from '../../../shared/tv';
import type { Slice } from '../store';
declare module '../store' { interface Store { tv: TvState; } interface Topics { tv: true; } }
export const tv: Slice = { init(s) { s.tv=TV_OFF; }, enter(s,v) { s.tv=v.tv??TV_OFF; return ['tv']; }, on: { tv(s,m) { s.tv=m.state; return ['tv']; } } };
