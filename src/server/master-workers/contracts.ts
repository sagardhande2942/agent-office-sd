import type { TaskSpecification } from '../../shared/team-coordination.js';
import type { TeamTask, TeamTaskDefinition } from '../../shared/master-workers.js';
import { text } from './storage.js';
export function paths(raw: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(raw) || raw.length > 100 || (!allowEmpty && !raw.length)) throw Error('Provide allowed repository-relative paths');
  return raw.map(v => {
    const p = text(v, 'path', 500);
    if (p.startsWith('/') || p.includes('\\') || /[:*?\x00-\x1f]/.test(p) || p.split('/').some(s => s === '..' || s === '.') || p.replace(/\/$/, '').split('/').some(s => !s)) throw Error('Use exact repository-relative files or directory prefixes ending in /');
    return p;
  });
}
function list(v: unknown, label: string) {
  if (!Array.isArray(v) || !v.length || v.length > 30) throw Error('Provide 1–30 ' + label);
  return v.map(s => text(s, label, 2000));
}
export function specification(raw: unknown): TaskSpecification {
  const s = raw as TaskSpecification;
  if(s&&JSON.stringify(s).length>20000)throw Error('Keep task specification within 20000 characters');
  if (!s || !['implementation', 'research'].includes(s.kind)) throw Error('Provide an implementation or research specification');
  if (s.expectedMinutes !== undefined && (!Number.isFinite(s.expectedMinutes) || s.expectedMinutes <= 0 || s.expectedMinutes > 1440)) throw Error('Expected minutes must be positive and at most 1440');
  return { kind:s.kind, steps:list(s.steps,'implementation steps'), references:paths(s.references), decisions:text(s.decisions,'interface/behavior decisions',4000), exclusions:text(s.exclusions,'exclusions',2000), verification:list(s.verification,'verification commands or research evidence deliverables'), ...(s.expectedMinutes === undefined ? {} : {expectedMinutes:s.expectedMinutes}) };
}
export function definition(t: TeamTaskDefinition): TeamTask {
  const id = text(t.id,'task ID',80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('Task IDs use letters, digits, underscores or hyphens');
  if (!Array.isArray(t.dependencies) || t.dependencies.length > 100) throw Error('Provide dependency arrays');
  return {id,title:text(t.title,'title',240),instructions:text(t.instructions,'instructions'),acceptance:text(t.acceptance,'acceptance'),files:paths(t.files,true),dependencies:t.dependencies.map(d=>text(d,'dependency',80)),...(t.specification ? {specification:specification(t.specification)} : {}),status:'pending',attempts:[]};
}
export function validateGraph(tasks: TeamTask[]) {
  if (!tasks.length || tasks.length > 100 || new Set(tasks.map(t=>t.id)).size !== tasks.length) throw Error('Provide 1–100 unique tasks');
  const visited=new Set<string>(), visiting=new Set<string>();
  const walk=(id:string)=>{ if(visiting.has(id))throw Error('Cyclic dependencies');if(visited.has(id))return;const t=tasks.find(t=>t.id===id);if(!t)throw Error('Unknown dependency');visiting.add(id);t.dependencies.forEach(walk);visiting.delete(id);visited.add(id); };
  tasks.forEach(t=>walk(t.id));
  for(const t of tasks){
    if(t.recoveryRoot&&!tasks.some(v=>v.id===t.recoveryRoot))throw Error('Keep recovery lineage roots');
    if(t.replacedBy?.some(id=>!tasks.some(v=>v.id===id)))throw Error('Keep replacement tasks and history');
    if(t.status!=='superseded'&&t.dependencies.some(id=>tasks.find(v=>v.id===id)?.status==='superseded'))throw Error('Depend on replacement tasks instead of superseded tasks');
  }
}
export const owns = (allowed: string[], file: string) => allowed.some(p => p.endsWith('/') ? file.startsWith(p) : p === file);
export const overlaps = (a: string[], b: string[]) => a.some(p => b.some(q => p === q || (p.endsWith('/') && q.startsWith(p)) || (q.endsWith('/') && p.startsWith(q))));
export function dispatchContract(tasks: TeamTask[], t: TeamTask) {
  const s=specification(t.specification);
  if(s.kind==='implementation'&&!t.files.length)throw Error('Implementation tasks need allowed write paths');
  if(tasks.some(other=>other.id!==t.id&&['running','review'].includes(other.status)&&overlaps(other.files,t.files))) throw Error('Concurrent write ownership overlaps; sequence tasks or split shared interfaces');
}
