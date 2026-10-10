import { h } from './dom';
import { taskBriefTool } from '../shared/task-brief/ui';

/** Optional prompt editors shared by desk hiring, board tasks, and the Lite view. */
export interface PromptTool { element: HTMLElement; valid(): boolean; }
export const PROMPT_TOOLS: ((prompt: HTMLTextAreaElement, maxLength?: number) => PromptTool)[] = [taskBriefTool];

export function promptTools(prompt: HTMLTextAreaElement, maxLength?: number): PromptTool {
  const tools = PROMPT_TOOLS.map(tool => tool(prompt, maxLength));
  return { element: h('div.prompt-tools', {}, ...tools.map(tool => tool.element)), valid: () => tools.every(tool => tool.valid()) };
}
