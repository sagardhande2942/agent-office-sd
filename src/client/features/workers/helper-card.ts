import type { HelperPhase } from '../../../shared/helper';
import type { WorkerInfo, WorkerTask } from '../../../shared/protocol';
import { modelBadge } from '../../ui/provider';
import { store } from '../../state';
  const HELPER_DOING: Record<HelperPhase, string> = {
    walking: 'walking over to their desk',
    reading: 'reading over their shoulder',
    reporting: 'telling them what it found',
    leaving: 'heading home',
  };

  /**
   * The card over a helper's head, so it is never mistaken for a colleague: it says whose desk it is at
   * and what it is doing there, and it keeps the provider badge like any other worker.
   */
export function helperCard(w: WorkerInfo): WorkerTask | undefined {
    if (!w.helper) return undefined;
    const h = store.helpers.find((x) => x.workerId === w.id);
    const badge = modelBadge(w.provider, w.model, w.effort);
    const name = `🆘 Helping ${w.helper.hostName}${badge ? ` · ${badge}` : ''}`;
    const doing = w.status === 'needs_input' ? 'waiting for your input — open its terminal' : w.status === 'offline' || w.status === 'exited' ? 'agent is not running — open its terminal' : h ? HELPER_DOING[h.phase] : 'waiting for its walking path';
    return { name, summary: h?.phase === 'leaving' ? '✅ Findings ready; open the host terminal' : `${doing} · press E to read its terminal` };
  }
