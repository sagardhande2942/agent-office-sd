import { StringDecoder } from 'node:string_decoder';
import { deflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ResearchBrief, ResearchExperiment } from '../../../shared/trading-research.js';
import type { ResearchStore } from './store.js';

export interface AdapterOptions { tradeai: string; python: string; script: string; orcatrex?: string; remotePython?: string; remoteDirectory?: string; }
const WORKER_START = '===WORKER_RESULT_JSON===', WORKER_END = '===END_WORKER_RESULT_JSON===';
const START = '===DISCOVERY_RESULT_JSON===', END = '===END_DISCOVERY_RESULT_JSON===';
export function parseEvaluation(output: string): Record<string, unknown> {
  const packedAt = output.lastIndexOf(WORKER_START);
  if (packedAt >= 0) {
    const end = output.indexOf(WORKER_END, packedAt); if (end < 0) throw Error('Incomplete research result');
    const value = JSON.parse(output.slice(packedAt + WORKER_START.length, end));
    if (!value || !Array.isArray(value.phases) || !value.phases.length || value.phases.some((p: unknown) => !p || typeof p !== 'object' || Array.isArray(p))) throw Error('Invalid research evidence');
    return { ...value, promotionStatus: 'RESEARCH' };
  }
  const results: Record<string, unknown>[] = [];
  let at = 0;
  while ((at = output.indexOf(START, at)) >= 0) {
    const end = output.indexOf(END, at); if (end < 0) throw Error('Incomplete Discovery result');
    const value = JSON.parse(output.slice(at + START.length, end));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Discovery result');
    results.push(value); at = end + END.length;
  }
  if (!results.length) throw Error('Evaluator returned no result markers; inspect execution.log');
  const dataset = output.match(/===OFFICE_DATASET_JSON===\s*([^]*?)\s*===END_OFFICE_DATASET_JSON===/);
  return { phases: results, datasetFingerprints: dataset ? JSON.parse(dataset[1]) : {}, promotionStatus: 'RESEARCH',
    note: 'Development evaluation only. Final holdout, promotion and paper trading are not performed.' };
}
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export class DiscoveryAdapter {
  constructor(readonly options: AdapterOptions, private store: ResearchStore) {}
  private payload(e: ResearchExperiment, brief: ResearchBrief) {
    const code = readFileSync(this.store.artifact(e.id, 'strategy.py'), 'utf8'), config = readFileSync(this.store.artifact(e.id, 'strategy.cfg'), 'utf8');
    return Buffer.from(JSON.stringify({ strategy: e.strategy, code, config, brief })).toString('base64');
  }
  async local(e: ResearchExperiment, brief: ResearchBrief, signal: AbortSignal, log: (chunk: string) => void, started?: (pid: number) => void) {
    const payload = this.payload(e, brief);
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONPATH: this.options.tradeai };
    for (const key of Object.keys(env)) if (/(API_KEY|ACCESS_TOKEN|HOOK_TOKEN|SECRET|PASSWORD)/i.test(key)) delete env[key as keyof typeof env];
    // No shell: code and config travel over stdin, avoiding Windows command-line limits.
    const bootstrap = 'import sys; sys.argv=[sys.argv[1],sys.stdin.read()]; exec(compile(open(sys.argv[0],encoding="utf-8").read(),sys.argv[0],"exec"))';
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(this.options.python, ['-c', bootstrap, this.options.script], { cwd: this.options.tradeai, env, signal, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      if (child.pid) started?.(child.pid);
      const stdout = new StringDecoder('utf8'), stderr = new StringDecoder('utf8');
      let bytes = 0, output = '', oversized = false, processError: Error | undefined;
      child.stdin.on('error', () => {}); child.stdin.end(payload);
      const collect = (data: Buffer, decoder: StringDecoder, result: boolean) => { const chunk = decoder.write(data); log(chunk); if (result) output += chunk;
        bytes += data.length; if (bytes > 8_000_000) { oversized = true; child.kill(); } };
      child.stdout.on('data', data => collect(data, stdout, true)); child.stderr.on('data', data => collect(data, stderr, false));
      child.on('error', error => { processError = error; }); child.on('close', code => {
        output += stdout.end(); log(stderr.end());
        if (processError) return reject(processError);
        if (oversized) return reject(Error('Evaluator exceeded output limit'));
        if (code !== 0) return reject(Error(`Evaluator exited with code ${code}; inspect execution.log`));
        try { resolve(parseEvaluation(output)); } catch (error) { reject(error); }
      });
    });
  }
  private async request(endpoint: string, body?: Record<string, string>) {
    const r = await fetch(`${this.options.orcatrex}${endpoint}`, { method: body ? 'POST' : 'GET', body: body ? new URLSearchParams(body) : undefined, signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!r.ok) throw Error(`OrcaTrex returned ${r.status}`); return await r.json() as Record<string, unknown>;
  }
  async submitRemote(e: ResearchExperiment, brief: ResearchBrief) {
    // Package the adapter and immutable artifacts into the job. Slaves need only
    // an existing Tradeai checkout and Python environment, not a shared filesystem.
    const script = Buffer.from(readFileSync(this.options.script)).toString('base64');
    const bootstrap = `import base64,sys;sys.argv=['office-research',${JSON.stringify(this.payload(e, brief))}];exec(compile(base64.b64decode(${JSON.stringify(script)}),'office-research','exec'))`;
    const packed = deflateSync(Buffer.from(bootstrap)).toString('base64');
    const launcher = `import base64,zlib;exec(zlib.decompress(base64.b64decode(${JSON.stringify(packed)})))`;
    const command = `${quote(this.options.remotePython ?? 'python3')} -c ${quote(launcher)}`;
    if (Buffer.byteLength(command) > 120_000) throw Error('Remote strategy package exceeds the operating system command limit');
    const result = await this.request('/orcatrex/send_job', { dir: this.options.remoteDirectory ?? 'git', command, batch_id: e.batch! });
    if (!Number.isInteger(result.job_id)) throw Error('OrcaTrex did not acknowledge a job ID; reconcile the batch before retrying');
    return result.job_id as number;
  }
  async remote(e: ResearchExperiment) {
    const result = await this.request(`/orcatrex/jobs?batch_id=${encodeURIComponent(e.batch!)}`);
    if (!Array.isArray(result.jobs)) throw Error('OrcaTrex returned an invalid job list');
    const jobs = result.jobs as { id: number; status: string; results?: { summary_json?: unknown }[] }[];
    const matches = jobs.filter(j => e.jobId ? j.id === e.jobId : true);
    if (matches.length > 1) throw Error('Multiple jobs in one experiment batch; inspect OrcaTrex before continuing');
    const job = matches[0]; if (!job) return { pending: true };
    if (job.status === 'Completed') {
      const text = (job.results ?? []).map(r => typeof r.summary_json === 'string' ? r.summary_json : JSON.stringify(r.summary_json)).join('\n');
      let metrics: Record<string, unknown>;
      if (text.includes(START) || text.includes(WORKER_START)) metrics = parseEvaluation(text);
      else {
        const phases = (job.results ?? []).map(r => typeof r.summary_json === 'string' ? JSON.parse(r.summary_json) : r.summary_json);
        if (!phases.length || phases.some(p => !p || typeof p !== 'object' || Array.isArray(p))) throw Error('Completed remote job has no valid result evidence');
        metrics = { phases, promotionStatus: 'RESEARCH', note: 'Development evaluation only; no final promotion.' };
      }
      return { metrics, jobId: job.id };
    }
    if (['Failed', 'Cancelled', 'TimedOut'].includes(job.status)) return { terminal: true, error: `OrcaTrex job ${job.id}: ${job.status}`, jobId: job.id };
    return { pending: true, jobId: job.id };
  }
  async cancelRemote(e: ResearchExperiment) { await this.request('/orcatrex/cancel_batch', { batch_id: e.batch!, reason: 'Research campaign execution timeout' }); }
}
