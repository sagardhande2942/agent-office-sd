import type { HelperState } from '../../../shared/helper';
import type { Slice } from '../store';
declare module '../store' {
 interface Store { helpers: HelperState[]; helperStart: number; }
 interface Topics { helpers: true; }
}
export const helpers: Slice = {
 init(s) { s.helpers=[]; s.helperStart=0; },
 enter(s,v) { s.helpers=v.helpers??[]; s.helperStart=performance.now(); return ['helpers']; },
 on: { helper(s,m) { s.helpers=m.helpers; s.helperStart=performance.now(); return ['helpers']; } }
};
