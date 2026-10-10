import { h } from '../../ui/dom';
import { briefError, formatBrief, TASK_BRIEF_MAX, type TaskBrief } from '../../../shared/task-brief';
import './ui.css';

/** Inline editor: applying a brief updates the prompt, and never starts or messages a worker. */
export function taskBriefTool(prompt: HTMLTextAreaElement, maxLength = TASK_BRIEF_MAX) {
  const build = h('button.btn', { type: 'button' }, 'Build task brief');
  const root = h('div.task-brief-tool', {}, build);
  let editor: HTMLElement | undefined;
  let pendingStatus: HTMLElement | undefined;
  build.addEventListener('click', () => {
    if (editor) return;
    const original = prompt.value;
    if (!original.trim()) { prompt.setCustomValidity('Enter a rough request first.'); prompt.reportValidity(); prompt.focus(); return; }
    prompt.setCustomValidity('');
    build.disabled = true;
    const fields = {} as Record<Exclude<keyof TaskBrief, 'original'>, HTMLTextAreaElement>;
    const definitions: [Exclude<keyof TaskBrief, 'original'>, string, string][] = [
      ['goal', 'Goal', 'What should be different when this task is done?'],
      ['examples', 'Examples', 'For example: entering an invalid email shows an error beside the field.'],
      ['constraints', 'Constraints', 'Required behavior, boundaries, compatibility, or things to preserve.'],
      ['acceptance', 'Acceptance criteria', 'One observable check per line. Example: an offline floor disappears after Delete.'],
      ['assumptions', 'Assumptions', 'Unverified details you want the worker to confirm.'],
      ['questions', 'Open questions', 'Missing details that materially affect the task.'],
    ];
    const rows = definitions.map(([key, title, placeholder]) => {
      const field = h('textarea', { rows: key === 'goal' ? 3 : 2, placeholder, 'aria-label': title, maxlength: TASK_BRIEF_MAX });
      fields[key] = field;
      if (key === 'goal') field.value = original.trim();
      return h('label.task-brief-field', {}, title, key === 'acceptance' ? ' (required)' : '', field);
    });
    const status = h('p.task-brief-status', { role: 'status', 'aria-live': 'polite' });
    pendingStatus = status;
    const preview = h('textarea', { rows: 12, 'aria-label': 'Brief preview', maxlength: maxLength });
    const review = h('div.task-brief-review.hidden', {}, h('label.task-brief-field', {}, 'Review and edit the brief', preview));
    const generate = h('button.btn', { type: 'button' }, 'Preview brief');
    const use = h('button.btn.primary', { type: 'button' }, 'Use brief');
    use.disabled = true;
    const cancel = h('button.btn', { type: 'button' }, 'Discard brief');
    const close = () => { editor?.remove(); editor = undefined; build.disabled = false; prompt.focus(); };
    const read = (): TaskBrief => ({ original, ...Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])) } as TaskBrief);
    generate.addEventListener('click', () => {
      const brief = read(), error = briefError(brief, maxLength);
      status.textContent = error ?? 'Review the draft below. Use brief returns it to the prompt; starting the worker is a separate step.';
      if (error) { if (!fields.acceptance.value.trim()) fields.acceptance.focus(); return; }
      preview.value = formatBrief(brief);
      review.classList.remove('hidden'); use.disabled = false;
      preview.focus();
    });
    // Field edits invalidate the preview, so a worker never receives a silently outdated draft.
    for (const field of Object.values(fields)) field.addEventListener('input', () => {
      use.disabled = true;
      status.textContent = 'Details changed. Preview brief again before using it.';
    });
    use.addEventListener('click', () => {
      if (prompt.value !== original) { status.textContent = 'The original prompt changed. Discard this draft and build from the updated request.'; return; }
      if (!preview.value.trim() || preview.value.length > maxLength) { status.textContent = `The brief must contain text and fit within ${maxLength.toLocaleString('en-US')} characters.`; return; }
      prompt.value = preview.value.trim(); prompt.dispatchEvent(new Event('input', { bubbles: true })); close();
    });
    cancel.addEventListener('click', close);
    editor = h('section.task-brief-editor', { 'aria-label': 'Task brief builder' },
      h('h3', {}, 'Task brief builder'),
      h('p', {}, 'Organize your request before starting. This guided builder does not use AI or invent requirements. Examples and constraints are optional; label uncertainty as assumptions or questions.'),
      h('details', {}, h('summary', {}, 'Original request'), h('pre', {}, original)),
      ...rows, status, generate, review, h('div.task-brief-buttons', {}, cancel, use));
    root.append(editor); fields.goal.focus();
  });
  prompt.addEventListener('input', () => prompt.setCustomValidity(''));
  return { element: root, valid: () => {
    if (!editor) return true;
    if (pendingStatus) pendingStatus.textContent = 'Use or discard the draft before sending the prompt.';
    return false;
  } };
}
