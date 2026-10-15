import type { Ctx } from '../../core/context';
import { registerSettingsExtension } from '../../ui/settings-extensions';
import { codingAgentsSetting } from './ui';

export function installCodingAgents(_ctx: Ctx) {
  registerSettingsExtension({ pane: 'workers', create: codingAgentsSetting });
}
