import type { Ctx } from '../../core/context';
import { HUD_ACTIONS } from '../../ui/menu';
import { registerSettingsExtension } from '../../ui/settings-extensions';
import { codingAgentsSetting, openCodingAgents } from './ui';

export function installCodingAgents(ctx: Ctx) {
  HUD_ACTIONS.push({
    id: 'coding-agents',
    icon: '🤖',
    label: 'Coding Agents',
    section: 'Office',
    title: () => 'Configure access, permissions, models and launch settings for coding agents',
    run: () => openCodingAgents(ctx.net),
  });

  registerSettingsExtension({ pane: 'workers', create: codingAgentsSetting });
}
