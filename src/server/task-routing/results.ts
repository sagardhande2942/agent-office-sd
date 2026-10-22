import path from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { validateCustomResult } from '../meeting-patterns/custom.js';
import type { Meeting } from '../../shared/protocol.js';
import { resolveAttachments } from '../meeting-patterns/attachments.js';
import { workflowProblem, type MeetingWorkflow } from '../../shared/meeting-workflows.js';
import type { Floor } from '../floor.js';
import { artifactHash, archivedResult, readArtifact, INPUT_LIMIT, type MeetingInput } from '../meeting-patterns/artifacts.js';
import type { RoutedMeeting } from './router.js';

function result(file: string) {
  if (statSync(file).size > 256*1024) throw Error('Oversized task result');
  return JSON.parse(readFileSync(file, 'utf8'));
}
function completed(id: string, key: string, cwd: string, file: string, workflow: MeetingWorkflow, archived = false): RoutedMeeting {
  try {
    if (workflowProblem(workflow)) throw Error('Missing or invalid archived workflow');
    const output = archived ? archivedResult(cwd, file, workflow) : resolveAttachments(cwd, result(file), workflow.result.attachments ?? []);
    const error=validateCustomResult({id,pattern:'custom',workflow,patternVersion:workflow.version} as Meeting,output);
    if(error)throw Error(error);
    return { id, key, state: 'done', result: output };
  } catch (error) { return { id, key, state: 'done', error: 'Completed meeting artifact unavailable: ' + (error as Error).message.slice(0, 700) }; }
}
/** Completed records remain recoverable after an operator clears the room. */
export function findRoutedMeeting(floor: Floor, key: string): RoutedMeeting | undefined {
  for (const space of floor.meetings.state().spaces ?? []) {
    const m = space.current;
    if (m?.routingKey === key) {
      const cwd = m.worktree ? path.resolve(floor.def.dir, m.worktree.path) : floor.def.dir;
      return m.status === 'done' ? completed(m.id, key, cwd, path.join(cwd, m.output), m.workflow!) : { id: m.id, key, state: m.status };
    }
    const past = space.past.find(r => r.routingKey === key);
    if (past) {
      const data = space.id === 'main' ? '.agent-office' : `.agent-office/meeting-spaces/${space.id}`;
      const folder = path.join(floor.def.dir, data, 'meetings', past.id);
      if (past.status !== 'done') return { id: past.id, key, state: 'stopped' };
      try { return completed(past.id, key, folder, path.join(folder, 'output-' + path.basename(past.output)), result(path.join(folder,'workflow.json')), true); }
      catch { return { id: past.id, key, state: 'done', error: 'Archived workflow unavailable; preserve artifacts and reconcile' }; }
    }
  }
}

/** Desk executions use private controller records, not physical meeting spaces. */
export function workerTaskArchive(floor: Floor, id: string): string | undefined {
  if (!/^[a-f0-9]{16}$/.test(id)) return;
  const dir=path.join(floor.def.dir,'.agent-office/worker-tasks',id),file=path.join(dir,'meetings.json');
  if(!existsSync(file))return;
  const state=result(file),m=[state.current,...(state.past??[])].find(m=>m?.id===id&&m.status==='done');
  if(m)return path.join(dir,'meetings',id,'output-'+path.basename(m.output));
}
export function findWorkerTask(floor: Floor, key: string): RoutedMeeting | undefined {
  const index=path.join(floor.def.dir,'.agent-office/worker-tasks/index.json');if(!existsSync(index))return;
  const id=result(index)[key];if(typeof id!=='string'||!/^[a-f0-9]{16}$/.test(id))return;
  const dir=path.join(floor.def.dir,'.agent-office/worker-tasks',id),file=path.join(dir,'meetings.json');if(!existsSync(file))return;
  const state=result(file),m=[state.current,...(state.past??[])].find(m=>m?.id===id&&m.routingKey===key);if(!m)return;
  if(m.status!=='done')return {id,key,state:m.status};
  const output=workerTaskArchive(floor,id);if(!output)return {id,key,state:'done',error:'Worker task archive unavailable'};
  return completed(id,key,path.dirname(output),output,result(path.join(path.dirname(output),'workflow.json')),true);
}

/** Copy selected predecessor artifacts into the next checkout, never send external paths to workers. */
export function meetingArtifacts(floor: Floor, ids: string[]) {
  const references: { meeting_id: string; output_path: string; report_path: string; output_sha256: string; report_sha256: string; resolved_output_path?: string; resolved_output_sha256?: string }[] = [];
  const files: MeetingInput[] = [];
  for (const id of [...new Set(ids)]) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw Error('Invalid predecessor meeting identity');
    let output: string | undefined, archived = false;
    for (const space of floor.meetings.state().spaces ?? []) {
      if (space.current?.id === id && space.current.status === 'done') {
        const m = space.current, cwd = m.worktree ? path.resolve(floor.def.dir, m.worktree.path) : floor.def.dir;
        output = path.join(cwd, m.output); break;
      }
      const m = space.past.find(m => m.id === id && m.status === 'done');
      if (m) {
        const data = space.id === 'main' ? '.agent-office' : `.agent-office/meeting-spaces/${space.id}`;
        output = path.join(floor.def.dir, data, 'meetings', id, 'output-' + path.basename(m.output)); archived = true; break;
      }
    }
    if (!output) { output=workerTaskArchive(floor,id);archived=!!output; }
    if (!output) throw Error('Completed predecessor meeting unavailable: ' + id);
    if (archived) archivedResult(path.dirname(output), output, result(path.join(path.dirname(output), 'workflow.json')));
    const add = (source: string, name: string) => {
      const content = readArtifact(floor.def.dir, source), sha256 = artifactHash(content);
      const destination = `.meeting/inputs/${id}/${name}`;
      files.push({ path: destination, content, sha256 }); return { path: destination, sha256 };
    };
    const body = add(output, 'output.json'), report = add(output + '.md', 'report.json.md');
    const ref = { meeting_id: id, output_path: body.path, report_path: report.path, output_sha256: body.sha256, report_sha256: report.sha256 };
    const resolved = path.join(path.dirname(output), 'resolved-' + path.basename(output));
    if (archived && existsSync(resolved)) {
      const expanded = add(resolved, 'resolved-output.json');
      Object.assign(ref, { resolved_output_path: expanded.path, resolved_output_sha256: expanded.sha256 });
    }
    references.push(ref);
    if (files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > INPUT_LIMIT) throw Error('Predecessor artifacts exceed meeting input budget');
  }
  return { references, files };
}
