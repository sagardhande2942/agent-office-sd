import { h } from '../../ui/dom';
import { BRIEF_FIELDS, type BriefAiOption, type BriefAiProvider } from '../../../shared/task-brief-ai';
import { briefError, type TaskBrief } from '../../../shared/task-brief';

export function aiDraftControls(options: {
  read(): TaskBrief; apply(brief: TaskBrief): void; busy(value: boolean): void; status(text: string): void;
  maxLength: number; context?: string;
}) {
  const manual = h('button.btn.on', { type: 'button', 'aria-pressed': 'true' }, 'Manual');
  const ai = h('button.btn', { type: 'button', 'aria-pressed': 'false' }, 'Draft with AI');
  const provider = h('select', { 'aria-label': 'AI provider' });
  const generate = h('button.btn', { type: 'button' }, 'Generate AI draft'); generate.disabled = true;
  const cancel = h('button.btn.hidden', { type: 'button' }, 'Cancel AI draft');
  const availability = h('p.task-brief-status', { role: 'status' });
  const panel = h('div.task-brief-ai.hidden', {}, h('label', {}, 'AI provider', provider), availability,
    h('p', {}, 'Uses the selected AI on the office server and may consume its plan or API usage. Review suggested examples and assumptions before using the draft.'), generate, cancel);
  const element = h('div', {}, h('div.task-brief-modes', { role: 'group', 'aria-label': 'Brief drafting mode' }, manual, ai), panel);
  let providers: BriefAiOption[] | undefined, request: AbortController | undefined, discovery: AbortController | undefined;
  let generation = 0, disposed = false;
  const selected = () => providers?.find(p => p.id === provider.value);
  const ready = () => { generate.disabled = !selected()?.available || !!request || options.maxLength < 500; };
  const stop = () => {
    generation++; request?.abort(); request = undefined; options.busy(false);
    cancel.classList.add('hidden'); ready();
  };
  const mode = (useAi: boolean) => {
    for (const [button, on] of [[manual, !useAi], [ai, useAi]] as const) { button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); }
    panel.classList.toggle('hidden', !useAi);
    if (!useAi) { stop(); options.status('Continue editing the brief manually.'); }
  };
  manual.addEventListener('click', () => mode(false));
  ai.addEventListener('click', async () => {
    mode(true);
    if (providers || discovery) return;
    discovery = new AbortController(); availability.textContent = 'Checking AI providers…';
    try {
      const response = await fetch('/api/task-brief/options', { signal: discovery.signal });
      if (!response.ok) throw new Error('Could not check AI providers. Sign in again or continue manually.');
      const data = await response.json() as { providers: BriefAiOption[] };
      if (disposed || !element.isConnected) return;
      providers = data.providers;
      provider.replaceChildren(...providers.map(p => h('option', { value: p.id, disabled: !p.available }, p.name)));
      provider.value = providers.find(p => p.available)?.id ?? providers[0]?.id ?? '';
      availability.textContent = providers.filter(p => !p.available).map(p => p.reason).join(' ');
      if (options.maxLength < 500) availability.textContent = 'The attached context leaves too little room for an AI brief. Continue manually.';
      ready();
    } catch (error) { if (!disposed && !discovery.signal.aborted) availability.textContent = error instanceof Error ? error.message : 'Could not check AI providers.'; }
    finally { discovery = undefined; }
  });
  provider.addEventListener('change', ready);
  cancel.addEventListener('click', () => { stop(); options.status('AI draft cancelled. Your existing details are unchanged.'); });
  generate.addEventListener('click', async () => {
    const chosen = selected(); if (!chosen?.available || request) return;
    const draft = options.read(), id = ++generation;
    const controller = new AbortController(); request = controller;
    options.busy(true); ready(); cancel.classList.remove('hidden'); options.status('Drafting with AI…');
    try {
      const response = await fetch('/api/task-brief/draft', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: chosen.id as BriefAiProvider, brief: draft, maxLength: options.maxLength, context: options.context }) });
      const result = await response.json() as { brief?: TaskBrief; error?: string };
      if (disposed || controller.signal.aborted || id !== generation || !element.isConnected) return;
      if (!response.ok) throw new Error(result.error ?? 'AI drafting failed. Continue manually.');
      const brief = result.brief;
      if (!brief || !BRIEF_FIELDS.every(k => typeof brief[k] === 'string') || brief.original !== draft.original) throw new Error('AI returned an invalid brief. Your details are unchanged.');
      const error = briefError(brief, options.maxLength); if (error) throw new Error(error);
      options.busy(false);
      options.apply(brief);
    } catch (error) {
      if (!disposed && !controller.signal.aborted && id === generation) options.status(error instanceof Error ? error.message : 'AI drafting failed. Your details are unchanged.');
    } finally {
      if (!disposed && id === generation) { request = undefined; options.busy(false); cancel.classList.add('hidden'); ready(); }
    }
  });
  const observer = new MutationObserver(() => { if (!element.isConnected) dispose(); });
  const dispose = () => { if (disposed) return; disposed = true; stop(); discovery?.abort(); observer.disconnect(); };
  observer.observe(document.getElementById('modal-root')!, { childList: true });
  return { element, dispose };
}
