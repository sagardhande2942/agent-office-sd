import type { Net } from '../net';
import type { SettingsPane } from './settings';
interface SettingsExtension { pane: SettingsPane; create(net: Net): { element: HTMLElement; dispose(): void } }
const extensions: SettingsExtension[] = [];
export function registerSettingsExtension(extension: SettingsExtension) { extensions.push(extension); }
export function createSettingsExtensions(net: Net) { return extensions.map(e => ({ pane: e.pane, ...e.create(net) })); }
