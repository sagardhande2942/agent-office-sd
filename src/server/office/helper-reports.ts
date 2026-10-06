import { Floor } from '../floor.js';
import type { FloorActions } from '../floor-actions.js';
import type { Communications } from '../communications.js';
import type { CommunicationsState } from '../../shared/communications.js';
/** A receipt clears only its matching delivery card. */
export function syncHelperReports(floor: FloorActions, state: CommunicationsState) {
  if (floor instanceof Floor) for (const message of state.messages) if (message.helperReport && message.status === 'completed') floor.workers.clearHelperReport(message.to.id, message.id);
}
/** Recover submitted reports without typing their findings into a terminal again. */
export function reconcileHelperReports(floor: FloorActions, ledger: Communications) {
  if (!(floor instanceof Floor)) return;
  for (const worker of floor.workers.list()) {
    const report = worker.helperReport;
    if (report?.state !== 'submitted' || !report.messageId) continue;
    const message = ledger.get(report.messageId);
    if (!message?.helperReport) continue;
    if (message.completedAt !== undefined) { floor.workers.clearHelperReport(worker.id, message.id); continue; }
    if (!message.helperReport.terminalClaimed) ledger.terminalReport(worker, message.id, 'claim');
    ledger.terminalReport(worker, message.id, 'complete');
  }
}
