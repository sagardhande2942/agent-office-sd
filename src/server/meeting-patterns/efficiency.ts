/** Caller-defined conditional stages and bounded final-output repair; no domain policy. */
import path from 'node:path';
import { workflowValue } from '../../shared/meeting-workflows.js';
import type { Meeting } from '../../shared/protocol.js';
import { readArtifact, artifactHash } from './artifacts.js';

export function stageEnabled(m: Meeting, round: number, cwd: string): boolean {
  const condition = m.workflow?.stages[round - 1]?.when;
  if (!condition) return true;
  const file = path.join(cwd, m.notes, `r${condition.round}-seat${condition.seat + 1}.md`);
  const value = workflowValue(JSON.parse(readArtifact(cwd, file)), condition.field);
  if (value === undefined || value === null || typeof value !== typeof condition.equals) throw Error('Missing or mistyped condition field');
  return value === condition.equals;
}

function outputFingerprint(m: Meeting, cwd: string): string {
  return artifactHash(JSON.stringify([m.output, m.output+'.md'].map(file => {
    try { return readArtifact(cwd, path.join(cwd, file)); } catch { return null; }
  })));
}

export function repairOutputChanged(m: Meeting, cwd: string): boolean {
  return outputFingerprint(m, cwd) !== m.outputRepairBaseline;
}

export function repairCustomOutput(m: Meeting, error: string, cwd: string): boolean {
  if (m.pattern !== 'custom' || (m.outputRepairAttempts ?? 0) >= 2) return false;
  m.outputRepairAttempts = (m.outputRepairAttempts ?? 0) + 1;
  m.outputRepairError = error.slice(0, 1000);
  m.outputRepairBaseline = outputFingerprint(m, cwd);
  m.knowledgeReviewPending = false; m.knowledgeReviewPrompted = false;
  m.waitingForCommunications = false; delete m.coordinationError;
  m.turns = [{ seat: 0, doing: 'Correct final output', file: m.output, state: 'waiting' }];
  return true;
}
