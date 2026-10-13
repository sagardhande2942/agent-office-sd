import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { roleAssignment, roleInstructions, ROLE_PATTERN, WORKER_ROLES, type WorkerRole } from '../../shared/worker-roles.js';
import type { WorkerFeature } from '../workers/features.js';

/** Persist role assignments independently of worker-manager internals. */
export function workerRoles(dir: string): WorkerFeature {
  const file = path.join(dir, '.agent-office', 'worker-roles.json');
  const roles = new Map<string, WorkerRole>();
  if (existsSync(file)) {
    const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid worker role assignments');
    for (const [id, role] of Object.entries(saved)) {
      if (typeof role === 'string' && Object.hasOwn(WORKER_ROLES, role)) roles.set(id, role as WorkerRole);
    }
  }
  const save = () => {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file + '.tmp', JSON.stringify(Object.fromEntries(roles)), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  };
  return {
    prompt(worker, text) {
      if (worker.kind !== 'agent' || text === undefined) return text;
      const assigned = roleAssignment(text);
      if (assigned) {
        if (assigned === 'none') roles.delete(worker.id);
        else roles.set(worker.id, assigned);
        save();
        text = text.replace(ROLE_PATTERN, '');
      }
      const role = roles.get(worker.id);
      return role ? `${text}\n\n${roleInstructions(role)}` : text;
    },
    remove(worker) { if (roles.delete(worker.id)) save(); },
  };
}
