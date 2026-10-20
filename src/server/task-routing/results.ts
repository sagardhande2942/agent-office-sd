import path from 'node:path';
import { statSync, readFileSync } from 'node:fs';
import { validateCustomResult } from '../meeting-patterns/custom.js';
import type { Meeting } from '../../shared/protocol.js';
import { resolveAttachments } from '../meeting-patterns/attachments.js';
import { workflowProblem, type MeetingWorkflow } from '../../shared/meeting-workflows.js';
import type { Floor } from '../floor.js';
import type { RoutedMeeting } from './router.js';

function result(file: string) {
  if (statSync(file).size > 256*1024) throw Error('Oversized task result');
  return JSON.parse(readFileSync(file, 'utf8'));
}
function completed(id: string, key: string, cwd: string, file: string, workflow: MeetingWorkflow, archived = false): RoutedMeeting {
  try {
    if (workflowProblem(workflow)) throw Error('Missing or invalid archived workflow');
    const output = resolveAttachments(cwd, result(file), workflow.result.attachments ?? [], archived);
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

export function meetingArtifacts(floor: Floor, ids: string[]) {
  const refs: { meeting_id: string; output_path: string; report_path: string }[] = [];
  for (const space of floor.meetings.state().spaces ?? []) {
    if (space.current && ids.includes(space.current.id)) {
      const m=space.current; const cwd=m.worktree?path.resolve(floor.def.dir,m.worktree.path):floor.def.dir;
      const file=path.join(cwd,m.output); refs.push({meeting_id:m.id,output_path:file,report_path:file+'.md'});
    }
    for (const m of space.past.filter(m=>ids.includes(m.id))) {
      const data=space.id==='main'?'.agent-office':`.agent-office/meeting-spaces/${space.id}`;
      const file=path.join(floor.def.dir,data,'meetings',m.id,'output-'+path.basename(m.output));
      refs.push({meeting_id:m.id,output_path:file,report_path:file+'.md'});
    }
  }
  return refs;
}
