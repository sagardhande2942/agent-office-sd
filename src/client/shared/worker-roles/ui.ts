import { h } from '../../ui/dom';
import { assignRole, roleAssignment, WORKER_ROLES, type WorkerRole } from '../../../shared/worker-roles';

export function workerRoleTool(prompt: HTMLTextAreaElement, maxLength = 20_000) {
  const select = h('select', { 'aria-label': 'Worker role' },
    h('option', { value: '' }, 'Keep current role'),
    h('option', { value: 'none' }, 'General worker (clear role)'),
    ...Object.entries(WORKER_ROLES).map(([id, role]) => h('option', { value: id }, role.name)));
  const description = h('p', { role: 'status' });
  let pending = false;
  const sync = () => {
    select.value = roleAssignment(prompt.value) ?? '';
    description.textContent = !select.value ? 'Keep the assigned role, or choose a specialization for this task.' : select.value === 'none' ? 'Follow the task without a specialized role.' : WORKER_ROLES[select.value as WorkerRole].responsibilities;
  };
  select.addEventListener('change', () => {
    if (!select.value) { sync(); return; }
    const text = assignRole(prompt.value, select.value as WorkerRole | 'none');
    pending = text.length > maxLength;
    if (pending) { description.textContent = 'Shorten the prompt before assigning this role.'; return; }
    prompt.value = text;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  });
  prompt.addEventListener('input', () => { pending = false; sync(); });
  sync();
  return { element: h('div.worker-role-tool', {}, h('label', {}, 'Worker role ', select), description), valid: () => !pending };
}
