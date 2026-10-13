import fs from 'node:fs';
import path from 'node:path';
import { tokensOf, type Usage, type ProviderSpend } from '../shared/protocol/usage.js';
import { reportedUsage } from './reported-usage.js';
type Counter = ProviderSpend['total'];
const empty = (): Counter => ({ tokens: 0, cost: 0, unknownCost: false, partial: false });
/** Persist cumulative snapshots per session; repeated reports and restarts never double book. */
export class ProviderLedger {
  private file: string;
  private sessions: Record<string, { tokens: number; cost: number }> = {};
  private totals: Record<string, Counter> = {};
  private days: Record<string, Record<string, Counter>> = {};
  constructor(dir: string) {
    this.file = path.join(dir, 'provider-usage.json');
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.sessions = data.sessions ?? {}; this.totals = data.totals ?? {}; this.days = data.days ?? {};
    } catch { /* first run */ }
  }
  observe(provider: string, session: string, value: Usage, day: string): boolean {
    const usage = reportedUsage(value); if (!usage || usage.incomplete) return false;
    const tokens = provider === 'dsh' ? 0 : tokensOf(usage);
    const known = usage.costKnown === true, cost = known ? usage.cost : 0;
    const key = JSON.stringify([provider, session]);
    const before = this.sessions[key] ?? { tokens: 0, cost: 0 };
    const dt = Math.max(0, tokens - before.tokens), dc = Math.max(0, cost - before.cost);
    const total = this.totals[provider] ??= empty();
    const today = (this.days[day] ??= {})[provider] ??= empty();
    if (!dt && !dc && (known || total.unknownCost)) return false;
    for (const counter of [total, today]) { counter.tokens += dt; counter.cost += dc; counter.unknownCost ||= !known; counter.partial ||= provider === 'codex' || provider === 'dsh'; }
    this.sessions[key] = { tokens: Math.max(tokens, before.tokens), cost: Math.max(cost, before.cost) };
    for (const old of Object.keys(this.days).sort().slice(0, -90)) delete this.days[old];
    fs.writeFileSync(this.file, JSON.stringify({ sessions: this.sessions, totals: this.totals, days: this.days }), { mode: 0o600 });
    return true;
  }
  state(day: string): ProviderSpend[] {
    return Object.entries(this.totals).map(([provider, total]) => ({ provider, total: { ...total }, today: { ...(this.days[day]?.[provider] ?? empty()) } }));
  }
  cost(day: string) { return Object.values(this.days[day] ?? {}).reduce((sum, u) => sum + u.cost, 0); }
}
