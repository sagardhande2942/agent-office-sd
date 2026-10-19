import './ui.css';
import { officeFull } from '../../../shared/machine';
import type { ServiceInfo } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, timeAgo, toast, type Modal } from '../../ui/dom';
import { autoTunnel, serviceUrl } from '../../ui/services';
import { copyButton } from '../../ui/team';
import { stopServicePort } from './api';
import {
  buildServiceBlades,
  formatGb,
  loadHex,
  loadLevel,
  machineBadge,
  memoryPercent,
} from './format';

let current: Modal | undefined;

function drawSparkline(canvas: HTMLCanvasElement, series: number[], color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = (canvas.width = 320);
  const H = (canvas.height = 48);
  ctx.clearRect(0, 0, W, H);
  // 90% pressure threshold line
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.1);
  ctx.lineTo(W, H * 0.1);
  ctx.stroke();
  if (series.length < 2) return;
  const step = W / (series.length - 1);
  const yOf = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * (H - 6) - 3;
  ctx.beginPath();
  series.forEach((v, i) => {
    const x = i * step;
    const y = yOf(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = `${color}33`;
  ctx.fill();
}

function ledPips(pct: number): HTMLElement {
  const lit = Math.max(1, Math.ceil((pct / 100) * 5));
  const lvl = loadLevel(pct);
  const cls = lvl === 'critical' ? 'critical' : lvl === 'warn' ? 'warn' : 'on';
  return h(
    'span.rack-leds',
    { 'aria-hidden': 'true' },
    ...Array.from({ length: 5 }, (_, i) => h('span.rack-led', { class: i < lit ? cls : '' })),
  );
}

/**
 * Opens the Server Rack hardware & dev-server console in 3D, 2D, or Lite.
 * Closing via top-right ✕ or Esc returns the player straight to mouse-look.
 */
export function openServerRack(net: Net, openWorker: (workerId: string) => void): Modal {
  if (current?.el.isConnected) return current;

  let previewPort: number | null = null;
  let stoppingPort: number | null = null;

  const badge = h('span.rack-badge', { 'data-level': 'ok' });
  const close = h('button.btn.close.corner', { type: 'button', 'aria-label': 'Close Server Rack', title: 'Close (Esc)' }, '✕');
  const cpuSpark = h('canvas.rack-spark') as HTMLCanvasElement;
  const memSpark = h('canvas.rack-spark') as HTMLCanvasElement;
  const gauges = h('div.rack-grid');
  const capacity = h('div.rack-capacity');
  const blades = h('div.rack-blades');
  const previewHost = h('div');
  const tunnelBox = h(
    'div.rack-tunnel',
    {},
    h('p', {}, '🔗 Forward every active blade port to your own computer automatically:'),
    h('div.cmd', {}, h('pre', {}, autoTunnel()), copyButton('Copy', () => autoTunnel())),
  );

  const limitInput = h('input', {
    type: 'number',
    min: '1',
    max: '500',
    placeholder: 'No limit',
    'aria-label': 'Max workers on this machine',
  }) as HTMLInputElement;

  const saveLimit = () => {
    const raw = limitInput.value.trim();
    if (!raw) {
      net.send({ t: 'machine.limit', limit: null });
      toast('Cleared worker limit');
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      toast('Enter a whole number of workers between 1 and 500', 'warn');
      return;
    }
    net.send({ t: 'machine.limit', limit: n });
    toast(`Set machine worker limit to ${n}`);
  };

  const el = h(
    'div.modal.server-rack',
    { role: 'dialog', 'aria-label': 'Server Rack' },
    h('header', {}, h('h2', {}, '🗄️ Server Rack'), badge, close),
    h(
      'div.body',
      {},
      gauges,
      capacity,
      h('h3.rack-section-h', {}, 'Server Blades — Active Worker Dev Servers'),
      blades,
      previewHost,
      tunnelBox,
    ),
    h('footer', {}, h('span.grow', {}, 'Live CPU & memory telemetry from this machine, plus HTTP ports opened by workers across the floor.')),
  );

  async function handleStop(svc: ServiceInfo) {
    if (stoppingPort !== null) return;
    stoppingPort = svc.port;
    render();
    try {
      await stopServicePort(svc.port);
      if (previewPort === svc.port) previewPort = null;
      toast(`Stopped dev server on :${svc.port}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : `Could not stop :${svc.port}`, 'error');
    } finally {
      stoppingPort = null;
      render();
    }
  }

  function renderPreview() {
    if (previewPort === null) {
      previewHost.replaceChildren();
      return;
    }
    const svc = store.services.items.find((s) => s.port === previewPort);
    if (!svc) {
      previewPort = null;
      previewHost.replaceChildren();
      return;
    }
    const url = serviceUrl(svc.port);
    let safeUrl = '';
    try {
      const parsed = new URL(url, location.origin);
      if (parsed.origin !== location.origin) safeUrl = parsed.href;
    } catch {
      safeUrl = '';
    }
    previewHost.replaceChildren(
      h(
        'div.rack-preview',
        {},
        h(
          'div.rack-preview-head',
          {},
          h('span', {}, `👁️ Live Preview — :${svc.port} (${svc.title || svc.command})`),
          h('button.btn', { type: 'button', onclick: () => { previewPort = null; renderPreview(); } }, 'Hide preview'),
        ),
        safeUrl
          ? h('iframe', { src: safeUrl, title: `Preview :${svc.port}`, sandbox: 'allow-scripts allow-forms allow-same-origin' })
          : h('p.note', {}, 'Preview cannot embed the office origin itself.'),
      ),
    );
  }

  function render() {
    const m = store.machine;
    const memPct = memoryPercent(m);
    const b = machineBadge(m);
    badge.textContent = b.label;
    badge.setAttribute('data-level', b.level);

    const cpuHex = loadHex(m.cpu);
    const memHex = loadHex(memPct);
    gauges.replaceChildren(
      h(
        'div.rack-gauge',
        {},
        h('div.rack-gauge-top', {}, h('span.rack-gauge-name', {}, 'Blade 01 · CPU Load'), ledPips(m.cpu)),
        h('div.rack-gauge-val', { style: `color:${cpuHex}` }, `${m.cpu}%`),
        h('div.rack-gauge-sub', {}, m.cores ? `${m.cores} core${m.cores === 1 ? '' : 's'}` : 'Sampling CPU…'),
        cpuSpark,
      ),
      h(
        'div.rack-gauge',
        {},
        h('div.rack-gauge-top', {}, h('span.rack-gauge-name', {}, 'Blade 02 · Memory'), ledPips(memPct)),
        h('div.rack-gauge-val', { style: `color:${memHex}` }, `${memPct}%`),
        h('div.rack-gauge-sub', {}, m.memTotal ? `${formatGb(m.memUsed)} of ${formatGb(m.memTotal)}` : 'Sampling memory…'),
        memSpark,
      ),
    );
    drawSparkline(cpuSpark, m.history.map(([c]) => c), cpuHex);
    drawSparkline(memSpark, m.history.map(([, mem]) => mem), memHex);

    const full = officeFull(m);
    const capText = m.limit === undefined
      ? `👷 ${m.workers} worker${m.workers === 1 ? '' : 's'} running · no machine limit`
      : `👷 ${m.workers} of ${m.limit} workers running${m.ceiling ? ` (ceiling ${m.ceiling})` : ''}`;
    const totalPips = Math.min(24, Math.max(m.limit ?? 8, m.workers));
    const pips = h(
      'div.rack-pips',
      {},
      ...Array.from({ length: totalPips }, (_, i) => {
        const cls = m.limit !== undefined && i >= m.limit ? 'over' : i < m.workers ? (full ? 'full' : 'used') : '';
        return h('span.rack-pip', { class: cls });
      }),
    );

    if (document.activeElement !== limitInput) {
      limitInput.value = m.limit !== undefined ? String(m.limit) : '';
    }
    const adminControls = store.me.admin
      ? h(
          'div.rack-cap-admin',
          {},
          limitInput,
          h('button.btn', { type: 'button', onclick: saveLimit }, 'Set limit'),
          m.limit !== undefined ? h('button.btn', { type: 'button', onclick: () => { limitInput.value = ''; saveLimit(); } }, 'Clear') : null,
        )
      : null;

    capacity.replaceChildren(
      h('div.rack-cap-info', {}, h('div.rack-cap-label', {}, capText), pips),
      ...(adminControls ? [adminControls] : []),
    );

    const slots = buildServiceBlades(store.services.items);
    blades.replaceChildren(
      ...slots.map(({ slot, service: svc }) => {
        const bladeNum = String(slot + 2).padStart(2, '0');
        if (!svc) {
          return h(
            'div.rack-blade.idle',
            {},
            h('span.rack-slot', {}, `BLADE ${bladeNum}`),
            h('span.rack-led', {}),
            h('div.rack-blade-main', {}, h('div.rack-blade-title', {}, 'Idle slot — no dev server listening')),
          );
        }
        const worker = store.workers.get(svc.workerId);
        const who = worker?.name ?? 'Worker';
        const color = worker?.color ?? '#8d99ae';
        const branch = worker?.worktree?.branch;
        const isPreviewing = previewPort === svc.port;
        const isStopping = stoppingPort === svc.port;

        return h(
          'div.rack-blade',
          {},
          h('span.rack-slot', {}, `BLADE ${bladeNum}`),
          h('span.rack-led.on', { title: 'HTTP server active' }),
          h('span.rack-port', {}, `:${svc.port}`),
          h(
            'div.rack-blade-main',
            {},
            h('div.rack-blade-title', {}, svc.title || svc.command),
            h(
              'div.rack-blade-meta',
              {},
              h('span.rack-worker-dot', { style: `background:${color}` }),
              h('span', {}, who),
              branch ? h('span', {}, `· 🌿 ${branch}`) : null,
              svc.cwd ? h('span', {}, `· 📁 ${svc.cwd}`) : null,
              h('span', {}, `· up ${timeAgo(svc.since)}`),
            ),
          ),
          h(
            'div.rack-blade-actions',
            {},
            h('a.btn', { href: serviceUrl(svc.port), target: '_blank', rel: 'noopener', title: `Open ${serviceUrl(svc.port)}` }, '↗ Open'),
            h(
              'button.btn',
              {
                type: 'button',
                class: isPreviewing ? 'primary' : '',
                onclick: () => {
                  previewPort = isPreviewing ? null : svc.port;
                  render();
                },
              },
              isPreviewing ? '👁️ Hide' : '👁️ Preview',
            ),
            worker
              ? h(
                  'button.btn',
                  {
                    type: 'button',
                    onclick: () => {
                      modal.close();
                      openWorker(worker.id);
                    },
                  },
                  '💻 Terminal',
                )
              : null,
            h(
              'button.btn',
              {
                type: 'button',
                disabled: isStopping,
                title: `Send SIGTERM to :${svc.port} (PID ${svc.pid})`,
                onclick: () => void handleStop(svc),
              },
              isStopping ? 'Stopping…' : '⏹️ Stop',
            ),
          ),
        );
      }),
    );

    renderPreview();
  }

  const unsubs = [
    store.on('machine', render),
    store.on('services', render),
    store.on('workers', render),
    store.on('me', render),
  ];
  const tick = setInterval(render, 15_000);
  const modal = openModal(el, {
    doing: '🗄️ at the server rack',
    onClose: () => {
      unsubs.forEach((off) => off());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  current = modal;
  render();
  return modal;
}
