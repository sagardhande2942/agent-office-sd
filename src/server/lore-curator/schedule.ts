import type { CuratorSettings } from '../../shared/lore-curator.js';
/** A nonexistent DST time is skipped; a repeated time runs once on that local date. */
export function nextCuratorRun(settings: CuratorSettings, after: number): number {
  if (settings.schedule === 'interval') return after + settings.intervalMinutes * 60000;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const local = (at: number) => {
    const p = Object.fromEntries(format.formatToParts(at).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const start = local(after);
  for (let at = Math.floor(after / 60000) * 60000 + 60000; at <= after + 3 * 86400000; at += 60000) {
    const p = local(at);
    if (p.time === settings.dailyTime && (p.date !== start.date || start.time < settings.dailyTime)) return at;
  }
  throw Error('Cannot calculate next curator run');
}
