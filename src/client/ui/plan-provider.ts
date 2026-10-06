import type { AgentChoice } from '../../shared/protocol';
import { planProviders } from '../../shared/plan-providers';
import { takesModel } from '../../shared/providers';
import { store } from '../state';
import { agentFields } from './provider';
import { h, toast } from './dom';

let nextChoice = 0;
/** Reuse hiring's provider/model catalogues and provider-specific reasoning effort controls. */
export function planProviderChoice(initial: AgentChoice, reviewer: boolean) {
  const label = reviewer ? 'Reviewer provider' : 'Candidate provider';
  const project = store.project && {...store.project, agentProviders: planProviders(store.project.agentProviders)};
  const fields = agentFields(project, `plan-model-${nextChoice++}`, initial, label, true);
  fields.element.querySelector('select')!.setAttribute('aria-label', label);
  const el = h('div.plan-model-row', {}, fields.element);
  return {
    el,
    read: fields.choice,
    valid: () => {
      if (!fields.valid()) return false;
      if (takesModel(fields.value()) && !fields.model()) {
        toast('Choose an explicit model for every candidate and reviewer', 'error');
        return false;
      }
      return true;
    },
  };
}
