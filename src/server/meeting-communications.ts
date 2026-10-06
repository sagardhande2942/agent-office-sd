import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { meetingMessages, unresolvedRequests, contextLabel, type CommunicationsState } from '../shared/communications.js';
import type { Meeting } from '../shared/protocol.js';

/** Hold finished output until linked requests resolve, without fabricating agent receipts. */
export function communicationGate(m: Meeting, state: CommunicationsState, allowUnresolved: boolean) {
  const outstanding = unresolvedRequests(meetingMessages(state.messages, m.id));
  if (!allowUnresolved && (state.error || outstanding.length)) {
    const changed = !m.waitingForCommunications || m.coordinationError !== state.error;
    m.waitingForCommunications = true;
    m.coordinationError = state.error;
    return { blocked: true, changed, notice: changed ? state.error ?? `Meeting output is ready; ${outstanding.length} request(s) still need resolution. Read Messages or finish anyway.` : undefined };
  }
  m.waitingForCommunications = false;
  m.coordinationError = undefined;
  return { blocked: false, changed: true, notice: undefined };
}

export function keepMeetingCommunications(to: string, m: Meeting, state: CommunicationsState) {
  const messages = meetingMessages(state.messages, m.id);
  const unresolved = unresolvedRequests(messages);
  writeFileSync(path.join(to, 'communications.json'), JSON.stringify({ meetingId: m.id, savedAt: Date.now(), override: m.communicationOverride, error: state.error, unresolved: unresolved.map(r => r.id), messages }, null, 2), { mode: 0o600 });
  const lines = [`# Communication record: ${m.title}`, '', `Meeting: ${m.id}`, `Unresolved requests at save: ${unresolved.length}`, ...(m.communicationOverride ? [`Finished anyway by ${m.communicationOverride.by} at ${new Date(m.communicationOverride.at).toISOString()}`] : []), ...(state.error ? [state.error] : []), '', 'Decisions remain in the meeting output; this record preserves requests and replies, not inferred decisions.', ''];
  for (const message of messages) lines.push(`## ${message.kind} · round ${message.meeting?.round} · ${message.status}`, `${message.from.name} → ${message.to.name}`, `ID: ${message.id} · thread: ${message.threadId}`, '', message.text, '', contextLabel(message.context), '');
  writeFileSync(path.join(to, 'communications.md'), lines.join('\n'), { mode: 0o600 });
}
