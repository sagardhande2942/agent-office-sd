import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import type { Meeting } from '../../shared/protocol.js';
import { matches, workflowProblem, workflowValue } from '../../shared/meeting-workflows.js';
import type { PatternPart } from './types.js';
import { resolveAttachments } from './attachments.js';

export function customBrief(m: Meeting): string | undefined {
  if (m.pattern !== 'custom' || !m.workflow) return;
  return `${m.workflow.brief}\nWorkflow ${m.workflow.id} version ${m.workflow.version}. Stages: ${m.workflow.stages.map(s => s.label).join(' → ')}. Participants share a checkout; independent assessments are an instruction, not an isolation boundary.`;
}
export function customPlan(m: Meeting, round: number, step: number, cwd: string): PatternPart[] | null {
  const w = m.workflow; const stage = w?.stages[round - 1];
  if (!w || !stage || step !== 1) return null;
  const note = (r: number, i: number) => `${m.notes}/r${r}-seat${i + 1}.md`;
  const vars: Record<string,string> = { cwd, notes: path.join(cwd,m.notes), output: path.join(cwd,m.output), report: path.join(cwd,m.output+'.md'), meeting_id: m.id, workflow_id: w.id, workflow_version: String(w.version), round: String(round) };
  for (let r=1;r<=w.stages.length;r++) {
    vars['notes_'+r] = m.seats.map((_,i) => path.join(cwd,note(r,i))).join(', ');
    for (let i=0;i<m.seats.length;i++) vars[`note_${r}_${i+1}`] = path.join(cwd,note(r,i));
  }
  return stage.turns.flatMap(t => (t.seats === 'all' ? m.seats.map((_,i)=>i) : t.seats).map(seat => {
    const file = t.output ? m.output : note(round,seat);
    let ask = t.prompt.replace(/\{\{([^{}]+)\}\}/g, (_,key:string) => key === 'role' ? m.seats[seat].role : vars[key]);
    if (t.output) ask += `\nWrite a JSON object to ${vars.output} and a nonempty readable report to ${vars.report}. Result rules (dot paths; equals {{meeting_id}} means this session ID ${m.id}): ${JSON.stringify(w.result.rules)}. File attachment contract: ${JSON.stringify(w.result.attachments ?? [])}. Both outputs are capped at 256 KiB; do not invent missing inputs.`;
    else ask += `\nWrite your assigned note to ${path.join(cwd,file)}.`;
    return { seat, doing: stage.label, file, ask };
  }));
}
export function validateCustomResult(m: Meeting, value: unknown): string | undefined {
  if (m.pattern !== 'custom') return;
  const fail = (s:string) => 'Invalid workflow result: '+s;
  if (!m.workflow || workflowProblem(m.workflow) || m.patternVersion !== m.workflow.version) return fail('unsupported definition or version');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('expected an object');
  for (const r of m.workflow.result.rules) {
    if (!matches(value,r.when)) continue;
    const v=workflowValue(value,r.path);
    const valid = r.type === 'string' ? typeof v === 'string' && !!v.trim()
      : r.type === 'strings' ? Array.isArray(v) && v.every(x=>typeof x==='string'&&!!x.trim()) && new Set(v).size===v.length && v.length >= (r.minItems??0)
      : r.type === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v)
      : r.type === 'integer' ? Number.isInteger(v) : v!==undefined && v!==null && (typeof v!=='string'||!!v.trim());
    const expected = r.equals === '{{meeting_id}}' ? m.id : r.equals;
    if (!valid || r.equals !== undefined && v!==expected || r.enum && !r.enum.includes(String(v))) return fail(r.path);
  }
}
export function validateCustomOutput(m: Meeting, cwd: string): string | undefined {
  if (m.pattern !== 'custom') return;
  try {
    const file=path.join(cwd,m.output), report=file+'.md';
    if (statSync(file).size > 256*1024 || statSync(report).size > 256*1024 || !readFileSync(report,'utf8').trim()) throw Error('missing or oversized output/report');
    const output=resolveAttachments(cwd,JSON.parse(readFileSync(file,'utf8')),m.workflow!.result.attachments??[]);
    return validateCustomResult(m,output);
  } catch(error) { return 'Invalid workflow result: '+(error as Error).message; }
}
