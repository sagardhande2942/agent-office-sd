import { h, openModal } from '../../ui/dom';
import { ACTIVITY_PHASES, aggregateActivity, type ActivityCell, type ActivityPhase, type ActivitySnapshot } from '../../../shared/activity-heatmap';
import './style.css';

export const PHASE_LABELS: Record<ActivityPhase, string> = {
  implementation: 'Implementation', waiting: 'Waiting for input', checks: 'Checks', retries: 'Retry attempt work', review: 'Review', unknown: 'Unknown / unobserved phase',
};
const COLORS: Record<ActivityPhase, string> = { implementation: '#7dd3fc', waiting: '#fcd34d', checks: '#86efac', retries: '#fdba74', review: '#c4b5fd', unknown: '#cbd5e1' };
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60000).toFixed(1)} min`;
const stamp = (ms: number) => new Date(ms).toLocaleString();

/** Read-only observed history; all views use the ordinary modal close/control lifecycle. */
export function openActivityHeatmap(floorId: string) {
  let snapshot: ActivitySnapshot | undefined, workerId = '', activityId = '', windowMs = 3600000, bucketMs = 60000;
  let closed = false, pending = false, selected: string | undefined;
  const controller = new AbortController();
  const status = h('p', { role: 'status', 'aria-live': 'polite' }, 'Loading recorded activity…');
  const content = h('div.heatmap-content');
  const body = h('div.body', {}, status, content);
  const el = h('div.modal.activity-heatmap', { role: 'dialog', 'aria-label': 'Office activity heatmap', 'aria-modal': 'true' },
    h('header', {}, h('h2', {}, 'Office activity heatmap')), body);
  const select = (label: string, value: string, options: [string, string][], change: (v: string) => void) => {
    const input = h('select', { 'aria-label': label }, ...options.map(([v, text]) => h('option', { value: v }, text)));
    input.value = value;
    input.addEventListener('change', () => { change(input.value); selected = undefined; render(); content.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)?.focus(); });
    return h('label', {}, label, input);
  };
  const details = h('section.heatmap-details', { 'aria-label': 'Time bucket details', 'aria-live': 'polite' });
  const describe = (cell?: ActivityCell, worker?: string, start?: number, end?: number) => {
    details.replaceChildren(h('h3', {}, cell || worker ? `${cell?.workerId ?? worker} · ${stamp(cell?.start ?? start!)} – ${stamp(cell?.end ?? end!)}` : 'Time bucket details'));
    if (!cell) { details.append(h('p', {}, worker ? 'No recorded interval in this bucket. This does not establish that the worker was idle.' : 'Focus or select a cell to read its recorded phases, activity, task and attempt.')); return; }
    details.append(h('p', {}, cell.live ? 'Live interval; duration extends on refresh.' : 'Closed recorded intervals.'),
      h('p', {}, ACTIVITY_PHASES.filter(p => cell.durations[p] > 0).map(p => `${PHASE_LABELS[p]}: ${duration(cell.durations[p])}`).join(' · ')),
      h('ul', {}, ...cell.intervals.map(i => h('li', {}, `${PHASE_LABELS[i.phase]} · Activity ${i.activityId ?? 'not recorded'} · Task ${i.taskId ?? 'not recorded'} · Attempt ${i.attempt ?? 'not recorded'} · ${stamp(i.start)} – ${i.end === undefined ? 'live' : stamp(i.end)}`))));
  };
  const render = () => {
    if (!snapshot) return;
    const focus = document.activeElement?.getAttribute('aria-label'), focusKey = document.activeElement?.getAttribute('data-key');
    const scroll = content.querySelector('.heatmap-scroll')?.scrollLeft ?? 0;
    const displayBucket = Math.max(bucketMs, Math.ceil(windowMs / 120 / 60000) * 60000);
    const start = Math.max(snapshot.coverage.since, Math.floor((snapshot.now - windowMs) / displayBucket) * displayBucket);
    const data = aggregateActivity(snapshot, { start, bucketMs: displayBucket, workerId, activityId });
    const workers = [...new Set(snapshot.intervals.map(i => i.workerId))].sort();
    const activities = [...new Set(snapshot.intervals.flatMap(i => i.activityId ? [i.activityId] : []))].sort();
    const refresh = h('button.btn', { type: 'button', onclick: () => { void load(); } }, 'Refresh');
    content.replaceChildren(h('p', {}, 'Recorded elapsed time only. Summed worker-time counts concurrent workers separately; observed wall time counts overlapping intervals once. Blank cells mean no recorded evidence.'),
      h('div.heatmap-controls', {},
        select('Worker', workerId, [['', 'All workers'], ...workers.map(id => [id, id] as [string, string])], v => workerId = v),
        select('Activity', activityId, [['', 'All activities'], ...activities.map(id => [id, id] as [string, string])], v => activityId = v),
        select('Time window', String(windowMs), [['3600000', 'Last hour'], ['21600000', 'Last 6 hours'], ['86400000', 'Last 24 hours']], v => windowMs = Number(v)),
        select('Bucket size', String(bucketMs), [['60000', '1 minute'], ['300000', '5 minutes'], ['900000', '15 minutes']], v => bucketMs = Number(v)), refresh),
      h('div.heatmap-legend', { 'aria-label': 'Phase legend' }, ...ACTIVITY_PHASES.map(p => h('span', {}, h('i.heatmap-swatch', { style: `background:${COLORS[p]}`, 'aria-hidden': 'true' }), PHASE_LABELS[p]))));
    const coverage = snapshot.coverage;
    content.append(h('p.heatmap-notice', {}, `Observation begins ${stamp(coverage.since)}. Retention: up to 2,000 intervals and seven days; at most 100 restart gaps. Review is submitted-result time awaiting review; retry time is retry-attempt work.`));
    if (coverage.historical) content.append(h('p.heatmap-notice', {}, 'Partial historical coverage: earlier phase boundaries were not recorded and have not been reconstructed.'));
    if (coverage.dropped) content.append(h('p.heatmap-notice', {}, `Truncated history: ${coverage.dropped} older intervals were removed by bounded retention.`));
    if (coverage.gaps.length) content.append(h('p.heatmap-notice', {}, `Unobserved restart gaps (${coverage.gaps.length}) are excluded from elapsed totals: ${coverage.gaps.map(g => `${stamp(g.start)} – ${stamp(g.end)}`).join('; ')}.`));
    content.append(h('div.heatmap-totals', {}, h('strong', {}, `Summed worker-time: ${duration(data.workerTime)}`), h('strong', {}, `Observed wall time: ${duration(data.wallTime)}`)),
      h('div.heatmap-totals', {}, ...ACTIVITY_PHASES.map(p => h('span', {}, `${PHASE_LABELS[p]}: ${data.totals[p] > 0 ? duration(data.totals[p]) : coverage.unavailable[p] ? 'unavailable' : 'no recorded time'}`))));
    for (const p of ACTIVITY_PHASES) if (coverage.unavailable[p]) content.append(h('p.heatmap-notice', {}, `${PHASE_LABELS[p]} signal unavailable: ${coverage.unavailable[p]}`));
    if (!data.cells.length) { content.append(h('p.empty', {}, snapshot.intervals.length ? 'No recorded intervals match this window and these filters.' : 'No recorded activity intervals yet. Live observations will appear here when available.')); return; }
    const allWorkers = [...new Set(data.cells.map(c => c.workerId))], visibleWorkers = allWorkers.slice(0, 40);
    if (displayBucket !== bucketMs) content.append(h('p.heatmap-notice', {}, `Displaying ${duration(displayBucket)} buckets to keep this time window readable. Select a shorter window for finer detail.`));
    if (allWorkers.length > visibleWorkers.length) content.append(h('p.heatmap-notice', {}, `Showing the first ${visibleWorkers.length} of ${allWorkers.length} workers. Totals include all matches; select a worker to inspect additional rows.`));
    const columns: number[] = [];
    for (let t = data.start; t < data.end; t += displayBucket) columns.push(t);
    const lookup = new Map(data.cells.map(c => [`${c.workerId}:${c.start}`, c]));
    const table = h('table.heatmap-table', {}, h('caption', {}, `${stamp(data.start)} – ${stamp(data.end)} · color shows longest recorded phase; ◉ marks live time`),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Worker'), ...columns.map(t => h('th', { scope: 'col' }, new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))))));
    const rows = h('tbody');
    for (const id of visibleWorkers) rows.append(h('tr', {}, h('th', { scope: 'row', title: id }, id), ...columns.map(t => {
      const key = `${id}:${t}`, cell = lookup.get(key), end = Math.min(t + displayBucket, data.end);
      const phase = cell ? ACTIVITY_PHASES.reduce((best, p) => cell.durations[p] > cell.durations[best] ? p : best, 'unknown' as ActivityPhase) : undefined;
      const label = `${id}, ${stamp(t)} – ${stamp(end)}: ${cell ? ACTIVITY_PHASES.filter(p => cell.durations[p] > 0).map(p => `${PHASE_LABELS[p]} ${duration(cell.durations[p])}`).join(', ') + (cell.live ? ', live' : '') : 'no recorded evidence'}`;
      const button = h('button.heatmap-cell', { type: 'button', 'aria-label': label, title: label, 'data-key': key, 'data-live': cell?.live, style: phase ? `background:${COLORS[phase]};opacity:${.35 + .65 * Math.min(1, Object.values(cell!.durations).reduce((a, b) => a + b, 0) / (end - t))}` : 'background:transparent' }, cell?.live ? '◉' : '');
      const inspect = () => { selected = key; describe(cell, id, t, end); };
      button.addEventListener('focus', inspect); button.addEventListener('click', inspect);
      return h('td', {}, button);
    })));
    table.append(rows); content.append(h('div.heatmap-scroll', {}, table), details);
    const selectedCell = selected ? lookup.get(selected) : undefined;
    if (selected && !selectedCell) {
      const split = selected.lastIndexOf(':'), id = selected.slice(0, split), t = Number(selected.slice(split + 1));
      describe(undefined, id, t, Math.min(t + displayBucket, data.end));
    } else describe(selectedCell);
    const scroller = content.querySelector('.heatmap-scroll'); if (scroller) scroller.scrollLeft = scroll;
    if (focusKey) content.querySelectorAll<HTMLElement>('[data-key]').forEach(node => { if (node.getAttribute('data-key') === focusKey) node.focus({ preventScroll: true }); });
    else if (focus) content.querySelectorAll<HTMLElement>('[aria-label]').forEach(node => { if (node.getAttribute('aria-label') === focus) node.focus({ preventScroll: true }); });
  };
  const load = async () => {
    if (closed || pending) return;
    pending = true;
    try {
      const response = await fetch(`/api/activity-heatmap?floor=${encodeURIComponent(floorId)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value: ActivitySnapshot = await response.json();
      if (closed) return;
      snapshot = value; render();
      status.textContent = `Live refresh every 5 seconds · Last observed ${stamp(value.coverage.lastObservedAt)}`;
    } catch (error) { if (!closed) status.textContent = `Activity history unavailable: ${error instanceof Error ? error.message : String(error)}. Use Refresh to retry.${snapshot ? ' Showing last successful snapshot.' : ''}`; }
    finally { pending = false; }
  };
  const timer = setInterval(() => { void load(); }, 5000);
  const modal = openModal(el, { doing: 'inspecting activity heatmap', reading: true, onClose: () => { closed = true; clearInterval(timer); controller.abort(); } });
  el.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), a[href]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  // Refresh remains available when the first request fails.
  content.append(h('button.btn', { type: 'button', onclick: () => { void load(); } }, 'Refresh'));
  el.querySelector<HTMLButtonElement>('.close')?.focus();
  void load();
  return modal;
}
