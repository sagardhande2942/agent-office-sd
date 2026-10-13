import './ui.css';
import type { HandoffPacket } from '../../../shared/handoff';
import { store } from '../../state';
import { h, openModal, timeAgo, toast, type Modal } from '../../ui/dom';
import { fetchHandoffs } from './api';
import {
  HANDOFF_ACCEPTANCE_NOTE,
  HANDOFF_EVIDENCE_NOTE,
  checksSummary,
  contextLine,
  filesLine,
  packetActors,
  packetHeadline,
  questionsLine,
  receiptLine,
  stateLabel,
  taskLabel,
} from './format';

// The Handoff station window, shared by the 3D office and the Lite dashboard: a floor's task packets,
// as their source workers left them and their recipients answered them. Opening it reads the station
// and nothing else — creating, accepting and cancelling are the workers' own authenticated actions.

/** The open station, so the office menu's action focuses it rather than stacking another one. */
let current: Modal | undefined;

/**
 * Opens the Handoff station on the floor you are on: it fetches the packets as it opens and on every
 * refresh, surfacing what the office says when it cannot read them. It never accepts anything as a
 * human (see HANDOFF_ACCEPTANCE_NOTE).
 */
export function openHandoffStation(openWorker: (workerId: string) => void) {
  if (current?.el.isConnected) return current;

  let packets: HandoffPacket[] = [];
  let seq = 0;
  const openedOn = store.floor;
  const floorId = () => store.floor ?? '';
  const filter = h(
    'select',
    { 'aria-label': 'Filter handoff packets' },
    h('option', { value: 'all' }, 'Every state'),
    h('option', { value: 'offered' }, 'Offered'),
    h('option', { value: 'accepted' }, 'Accepted'),
    h('option', { value: 'cancelled' }, 'Cancelled'),
  ) as HTMLSelectElement;
  const floorName = h('span.handoff-floor');
  const refresh = h('button.btn', { type: 'button', title: 'Fetch the packets again', onclick: () => void load() }, '↻ Refresh');
  const close = h('button.btn.close.corner', { type: 'button', 'aria-label': 'Close Handoff station', title: 'Close (Esc)' }, '✕');
  const status = h('p.handoff-status', { role: 'status', 'aria-live': 'polite' });
  const acceptance = h('details.handoff-acceptance', { open: true }, h('summary', {}, 'What accepting means here'), h('p', {}, HANDOFF_ACCEPTANCE_NOTE));
  const list = h('div.handoff-list');
  const el = h(
    'div.modal.handoff-station',
    { role: 'dialog', 'aria-label': 'Handoff station' },
    h('header', {}, h('h2', {}, '🤝 Handoff station'), floorName, filter, refresh, close),
    h('div.body', {}, acceptance, status, list),
    h('footer', {}, h('span.grow', {}, HANDOFF_EVIDENCE_NOTE)),
  );
  const unsubs = [store.on('workers', () => render()), store.on('floor', () => { if (store.floor !== openedOn) modal.close(); })];
  const modal = openModal(el, { reading: true, doing: 'reading a task handoff', onClose: () => unsubs.forEach((off) => off()) });

  /** Fetches the floor's packets; a failure replaces the list so a stale view is never mistaken for fresh. */
  async function load() {
    const floor = floorId();
    floorName.textContent = store.currentFloor()?.name ?? floor;
    if (!floor) {
      packets = [];
      status.textContent = 'No floor is open, so there is nothing to read.';
      list.replaceChildren();
      return;
    }
    const run = ++seq;
    refresh.disabled = true;
    status.textContent = 'Loading handoff packets…';
    try {
      const handoffs = await fetchHandoffs(floor);
      if (run !== seq || !el.isConnected) return;
      packets = handoffs;
      render();
      status.textContent = handoffs.length
        ? `${handoffs.length} packet${handoffs.length === 1 ? '' : 's'} on this floor.`
        : 'No handoff packets on this floor yet. A worker offers one with office-workers handoff create.';
    } catch (error) {
      if (run !== seq || !el.isConnected) return;
      packets = [];
      const message = error instanceof Error ? error.message : 'The handoff station could not be read.';
      status.textContent = 'Could not read the handoff station.';
      list.replaceChildren(h('p.handoff-error', { role: 'alert' }, message), h('p.muted', {}, 'Nothing changed here; fixing the cause and refreshing again is safe.'));
      toast(`Handoff station: ${message}`, 'error');
    } finally {
      if (run === seq) refresh.disabled = false;
    }
  }

  function render() {
    const shown = filter.value === 'all' ? packets : packets.filter((p) => p.state === filter.value);
    list.replaceChildren(
      ...(shown.length
        ? shown.map((packet) => packetCard(packet))
        : [h('p.muted', {}, packets.length ? 'No packets in that state.' : 'No packets to show.')]),
    );
  }

  function section(title: string, ...children: (Node | string | null)[]) {
    return h('section.handoff-section', {}, h('h4', {}, title), ...children);
  }

  /** One packet, expanded: its goal, its evidence and its receipts, with the participants reachable. */
  function packetCard(packet: HandoffPacket): HTMLElement {
    const at = [
      `offered ${timeAgo(packet.offeredAt)}`,
      packet.acceptedAt ? `accepted ${timeAgo(packet.acceptedAt)}` : '',
      packet.cancelledAt ? `cancelled ${timeAgo(packet.cancelledAt)}` : '',
    ].filter(Boolean).join(' · ');
    const files = section(
      `Files (${packet.files.length})`,
      packet.files.length ? h('ul.handoff-files', {}, ...packet.files.map((file) => h('li', {}, h('code', {}, file)))) : h('p', {}, filesLine(packet.files, packet.filesNote)),
    );
    const checks = section(
      'Checks',
      h('p.muted', {}, checksSummary(packet.checks)),
      packet.checks.length
        ? h('ul.handoff-checks', {}, ...packet.checks.map((check) => h('li', {},
          h('span.handoff-check', { 'data-status': check.status }, check.status),
          h('strong', {}, check.name),
          h('p', {}, check.evidence))))
        : h('p', {}, 'No checks were recorded.'),
    );
    const questions = section(
      'Unresolved questions',
      h('p.muted', {}, questionsLine(packet.questions, packet.questionsNote)),
      packet.questions.length
        ? h('ul', {}, ...packet.questions.map((question) => h('li', {}, question)))
        : h('p', {}, packet.questionsNote ?? 'None recorded.'),
    );
    const pr = packet.context.pr;
    const context = section(
      'Where the work is',
      h('p.handoff-context', {}, contextLine(packet.context)),
      pr ? h('p', {}, h('a', { href: pr, target: '_blank', rel: 'noopener noreferrer' }, 'Open the recorded pull request')) : null,
    );
    const receipt = section(
      'Tracked inbox receipt',
      h('p', {}, packet.messageId ? `message ${packet.messageId}` : 'No tracked message ID.'),
      h('p', {}, receiptLine(packet.receipt)),
      packet.receipt ? h('p.muted', {}, `thread ${packet.receipt.threadId}${packet.receipt.deliveredAt ? ` · read ${timeAgo(packet.receipt.deliveredAt)}` : ' · not read yet'}${packet.receipt.acknowledgedAt ? ` · acknowledged ${timeAgo(packet.receipt.acknowledgedAt)}` : ''}`) : null,
      h('p.muted', {}, 'Acknowledging a message is not acceptance, and neither is reading it here.'),
    );
    const continuation = section(
      'State',
      h('p', {}, `${stateLabel(packet.state)} · ${at}`),
      packet.continuationOwner ? h('p', {}, `Continuation owner: ${packet.continuationOwner.name}.`) : null,
      packet.state === 'offered' ? h('p.muted', {}, `Waiting on ${packet.recipient.name} to accept it.`) : null,
      packet.state === 'cancelled' ? h('p.muted', {}, 'The source worker cancelled this offer; its work stays where it was.') : null,
      h('p.muted', {}, 'Accepting here is not possible: the recipient does it from its own terminal, and it does not move this work.'),
    );
    const terminals = packetActors(packet)
      .filter((actor) => store.workers.has(actor.id))
      .map((actor) => h('button.btn', { type: 'button', onclick: () => { modal.close(); openWorker(actor.id); } }, `🖥 Open ${actor.name}'s terminal`));
    const details = h(
      'details.handoff-packet',
      { class: packet.state },
      h('summary', {},
        h('span.handoff-state', { 'data-state': packet.state }, stateLabel(packet.state)),
        h('strong', {}, packetHeadline(packet)),
        h('span.muted', {}, ` · ${taskLabel(packet)}`)),
      section('Goal', h('p', {}, packet.task.goal)),
      section('Completed work', h('p.pre', {}, packet.completedWork)),
      section('Next steps', h('p.pre', {}, packet.nextSteps)),
      files,
      checks,
      questions,
      context,
      receipt,
      continuation,
      h('footer.handoff-packet-foot', {},
        h('code', {}, `${packet.key} · ${packet.id}`),
        terminals.length ? h('div.handoff-actions', {}, ...terminals) : h('span.muted', {}, 'No participant has a terminal open on this floor.')),
    );
    return details;
  }

  close.addEventListener('click', () => modal.close());
  filter.addEventListener('change', render);
  current = modal;
  void load();
  return modal;
}
