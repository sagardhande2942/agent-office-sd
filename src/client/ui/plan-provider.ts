import type { AgentChoice } from '../../shared/protocol';
import { planProviders } from '../../shared/plan-providers';
import { store } from '../state';
import { agentFields } from './provider';
import { h } from './dom';

let nextChoice = 0;
/** Reuse hiring's provider/model catalogues and provider-specific reasoning effort controls. */
export function planProviderChoice(initial: AgentChoice, reviewer: boolean) {
  const label = reviewer ? 'Reviewer provider' : 'Candidate provider';
  const project = store.project && {...store.project, agentProviders: planProviders(store.project.agentProviders)};
  const fields = agentFields(project, `plan-model-${nextChoice++}`, initial, label);
  fields.element.querySelector('select')!.setAttribute('aria-label', label);
  const el = h('div.plan-model-row', {}, fields.element);
  return {
    el,
    read: fields.choice,
    valid: fields.valid,
  };
}
