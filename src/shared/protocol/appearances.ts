import type { AppearanceConfig, AppearanceState } from '../appearances.js';
export type AppearanceClientMsg = { t: 'appearance.set'; config: AppearanceConfig };
export type AppearanceServerMsg = { t: 'appearance'; state: AppearanceState };
