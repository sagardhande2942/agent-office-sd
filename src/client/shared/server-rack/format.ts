import { officeFull } from '../../../shared/machine';
import type { MachineState, ServiceInfo } from '../../../shared/protocol';

export const RACK_BLADE_SLOTS = 4;

export type LoadLevel = 'ok' | 'warn' | 'critical';

export function loadLevel(pct: number): LoadLevel {
  return pct >= 90 ? 'critical' : pct >= 70 ? 'warn' : 'ok';
}

export function loadHex(pct: number): string {
  return pct >= 90 ? '#ef476f' : pct >= 70 ? '#ffd166' : '#06d6a0';
}

export function formatGb(bytes: number): string {
  const gb = bytes / 2 ** 30;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

export function memoryPercent(m: MachineState): number {
  return m.memTotal > 0 ? Math.max(0, Math.min(100, Math.round((m.memUsed / m.memTotal) * 100))) : 0;
}

export function machineBadge(m: MachineState): { label: string; level: LoadLevel } {
  if (!m.memTotal) return { label: 'Sampling telemetry…', level: 'ok' };
  if (m.pressure) return { label: `⚠️ Under pressure (${m.pressure})`, level: 'critical' };
  if (officeFull(m)) return { label: `🚫 Office full (${m.workers}/${m.limit})`, level: 'warn' };
  return {
    label: m.limit !== undefined ? `✅ Room to hire (${m.workers}/${m.limit})` : `✅ Room to hire (${m.workers} active)`,
    level: 'ok',
  };
}

export function rackHintSummary(m: MachineState, servicesCount: number): string {
  const memPct = memoryPercent(m);
  const srv = servicesCount === 1 ? '1 dev server' : `${servicesCount} dev servers`;
  if (!m.memTotal) return srv;
  return `${m.cpu}% CPU · ${memPct}% RAM · ${srv}`;
}

export interface ServiceBladeSlot {
  slot: number;
  service?: ServiceInfo;
}

/**
 * Maps active worker web servers onto the rack's server blades (at least RACK_BLADE_SLOTS slots so
 * empty bays stay visible like a physical rack).
 */
export function buildServiceBlades(items: readonly ServiceInfo[], minSlots = RACK_BLADE_SLOTS): ServiceBladeSlot[] {
  const count = Math.max(minSlots, items.length);
  return Array.from({ length: count }, (_, i) => ({
    slot: i + 1,
    service: items[i],
  }));
}
