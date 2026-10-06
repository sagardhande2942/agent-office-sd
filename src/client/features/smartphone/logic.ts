// The smartphone's pure helpers: what a contact row says, and what the SMS view may promise.
// Nothing here touches the DOM or the network, so tests cover it without a browser.

import type { WorkerInfo } from '../../../shared/protocol';

/** The icon before a contact's name: a shell is a shared login shell, the rest are agents. */
export function kindIcon(w: Pick<WorkerInfo, 'kind'>): string {
  return w.kind === 'shell' ? '🐚' : '🤖';
}

/** A plain hex color only: worker colors come from the avatar palette, but nothing at the call
 * sites constrains them, so anything else falls back instead of becoming raw CSS. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export function dotColor(w: Pick<WorkerInfo, 'color'>): string {
  return HEX_COLOR.test(w.color) ? w.color : '#888888';
}

/** The line under a contact's name: what it's doing now. Work standing (a PR) is the badge's job, so it never doubles up here. */
export function contactSub(w: Pick<WorkerInfo, 'activity' | 'lost' | 'helper'>): string | undefined {
  if (w.lost) return '🌿 worktree deleted — tap to fix it';
  if (w.helper) return `Helping ${w.helper.hostName}${w.activity ? ` · ${w.activity}` : ''}`;
  if (w.activity) return w.activity;
  return undefined;
}

/** Status is not a delivery acknowledgement. Replies and approvals live in the terminal. */
export function statusNote(w: Pick<WorkerInfo, 'name' | 'status'>): string {
  switch (w.status) {
    case 'needs_input': return `${w.name} needs your input — open its terminal to respond`;
    case 'working': case 'starting': return 'Working — messages may queue. Read replies in the terminal.';
    case 'done': case 'idle': return 'Ready — read replies in the terminal. Delivery is not confirmed here.';
    case 'offline': case 'exited': return `${w.name} is asleep — open its terminal to resume`;
    default: return `${w.name} · ${w.status}`;
  }
}

/** Never paste a chat prompt into an approval menu or a shell command line. */
export function messageBlockReason(w: Pick<WorkerInfo, 'kind' | 'status' | 'lost'>): string | undefined {
  if (w.lost) return 'Restore the worktree before messaging';
  if (w.kind === 'shell') return 'Shell commands belong in the terminal';
  if (w.status === 'needs_input') return 'Open the terminal to answer its question or approval';
  if (w.status === 'offline' || w.status === 'exited') return 'Open the terminal to resume this worker';
  if (w.status === 'starting') return 'Wait for the session to start';
  return undefined;
}
