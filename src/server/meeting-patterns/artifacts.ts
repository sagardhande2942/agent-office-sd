/** Generic, bounded meeting artifacts. Reviewed bytes and derived attachments stay separate. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { matches, workflowValue, type MeetingWorkflow } from '../../shared/meeting-workflows.js';
import type { Meeting } from '../../shared/protocol.js';
import { resolveAttachments } from './attachments.js';

export const ARTIFACT_LIMIT = 256 * 1024;
export const INPUT_LIMIT = 2 * 1024 * 1024;
export interface MeetingInput { path: string; content: string; sha256: string }
export interface MeetingExecution { key: string; id: string; inputs?: MeetingInput[] }
export const artifactHash = (content: string) => createHash('sha256').update(content).digest('hex');

export function readArtifact(root: string, file: string): string {
  const real = realpathSync(file), base = realpathSync(root);
  if (!real.startsWith(base + path.sep) || !statSync(real).isFile() || statSync(real).size > ARTIFACT_LIMIT) throw Error('Meeting artifact outside floor or size limit');
  const bytes = readFileSync(real), text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw Error('Meeting artifact must be UTF-8');
  return text;
}

/** Called before any participant is seated. Never grant access outside the new checkout. */
export function stageMeetingInputs(cwd: string, files: MeetingInput[] = []) {
  if (files.length > 60 || files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > INPUT_LIMIT) throw Error('Meeting input bundle exceeds limit');
  const root = realpathSync(cwd), seen = new Set<string>();
  for (const file of files) {
    if (!/^\.meeting\/inputs\/[A-Za-z0-9_-]{1,80}\/[a-z-]+\.json(?:\.md)?$/.test(file.path) || seen.has(file.path)
      || Buffer.byteLength(file.content) > ARTIFACT_LIMIT || artifactHash(file.content) !== file.sha256) throw Error('Invalid meeting input path, duplicate or digest');
    seen.add(file.path);
    let parent = root;
    for (const part of file.path.split('/').slice(0, -1)) {
      parent = path.join(parent, part);
      if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
      if (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory()) throw Error('Meeting input directory must not be a symlink');
    }
    writeFileSync(path.join(root, file.path), file.content, { flag: 'wx', mode: 0o400 });
  }
}

/** Exact originals are retained for Knowledge review; expanded attachments are a derived view. */
export function archiveCustomArtifacts(cwd: string, folder: string, m: Meeting) {
  if (m.pattern !== 'custom' || !m.workflow) return;
  const out = path.join(cwd, m.output), name = path.basename(m.output);
  if (existsSync(out + '.md')) cpSync(out + '.md', path.join(folder, 'output-' + name + '.md'));
  writeFileSync(path.join(folder, 'workflow.json'), JSON.stringify(m.workflow));
  if (m.status === 'done') {
    const result = resolveAttachments(cwd, JSON.parse(readArtifact(cwd, out)), m.workflow.result.attachments ?? []);
    writeFileSync(path.join(folder, 'resolved-output-' + name), JSON.stringify(result));
  }
}

/** Legacy archives without a review remain readable; a present review must match exact bytes. */
export function verifyArchivedReview(folder: string, output: string) {
  const receipt = path.join(folder, 'knowledge-review.json');
  if (!existsSync(receipt)) return;
  const review = JSON.parse(readArtifact(folder, receipt));
  const contents = [readArtifact(folder, output), readArtifact(folder, output + '.md')];
  if (review.output !== artifactHash(JSON.stringify(contents))) throw Error('Archived meeting review digest mismatch; preserve originals');
}

/** Derived attachment expansion cannot change any reviewed decision or other original field. */
export function archivedResult(folder: string, file: string, workflow: MeetingWorkflow) {
  verifyArchivedReview(folder, file);
  const original = JSON.parse(readArtifact(folder, file));
  const sidecar = path.join(folder, 'resolved-' + path.basename(file));
  if (!existsSync(sidecar)) return resolveAttachments(folder, original, workflow.result.attachments ?? [], true);
  const derived = JSON.parse(readArtifact(folder, sidecar)), candidate = structuredClone(original);
  for (const a of workflow.result.attachments ?? []) {
    if (!matches(original, a.when) || typeof workflowValue(original, a.content) === 'string') continue;
    const keys = a.content.split('.'); let parent = candidate;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    parent[keys.at(-1)!] = workflowValue(derived, a.content);
  }
  const checked = resolveAttachments(folder, candidate, workflow.result.attachments ?? [], true);
  if (!isDeepStrictEqual(checked, derived)) throw Error('Derived artifact differs from reviewed output');
  return checked;
}
