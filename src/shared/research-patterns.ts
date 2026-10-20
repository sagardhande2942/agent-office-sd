import type { PatternDef } from './meetings.js';

export type ResearchPatternId = 'research.edge-discovery' | 'research.experiment-design' |
  'research.strategy-build' | 'research.test-analysis' | 'research.validation-council' |
  'research.portfolio-review' | 'research.retrospective';

export interface ResearchDefinition extends PatternDef {
  version: 1;
  objective: string;
  required: readonly string[];
  outcomes: readonly string[];
}

function definition(id: string, label: string, roles: string[], objective: string,
  required: string[], outcomes: string[]): ResearchDefinition {
  return { version: 1, icon: '🔬', label, blurb: objective, objective, roles,
    seats: { min: 3, max: roles.length, default: roles.length },
    rounds: { min: 3, max: 3, default: 3 }, stages: ['Independent assessment', 'Challenge', 'Synthesis'],
    required, outcomes, output: slug => `docs/research/${id}/${slug}.json` };
}

export const RESEARCH_PATTERNS: Record<ResearchPatternId, ResearchDefinition> = {
  'research.edge-discovery': definition('edge-discovery', 'Edge discovery',
    ['Discovery chair', 'Mechanism researcher', 'Data researcher', 'Skeptic'],
    'Propose falsifiable edges; challenge mechanisms, data availability and overlap with prior research.',
    ['hypotheses', 'novelty_limits', 'rejection_conditions'], ['propose', 'inconclusive', 'blocked']),
  'research.experiment-design': definition('experiment-design', 'Experiment design',
    ['Research lead', 'Data specialist', 'Experiment designer'],
    'Freeze a reproducible protocol before results: rules, chronological splits, costs, benchmark and finite searches.',
    ['rules', 'dataset_manifest', 'splits', 'costs', 'benchmark', 'criteria', 'experiment_budget'], ['ready', 'revise', 'blocked']),
  'research.strategy-build': {
    ...definition('strategy-build', 'Strategy build',
    ['Technical lead', 'Implementation engineer', 'Correctness reviewer'],
    'Plan file ownership, implement the strategy, independently review it, and publish a bounded engineering report.',
    ['revision_id', 'source_digest', 'specification', 'checks', 'write_ownership'], ['ready', 'revise', 'blocked']),
    rounds: { min: 4, max: 4, default: 4 }, stages: ['Planning', 'Implementation', 'Independent review', 'Synthesis'],
  },
  'research.test-analysis': definition('test-analysis', 'Backtest investigation',
    ['QA lead', 'Data auditor', 'Execution analyst'],
    'Audit preflight readiness or diagnose supplied backtest evidence; infrastructure failure is not hypothesis rejection.',
    ['mode', 'revision_id', 'data_checks', 'execution_checks', 'diagnosis'], ['ready', 'revise', 'inconclusive', 'blocked']),
  'research.validation-council': definition('validation-council', 'Validation council',
    ['Independent chair', 'Statistical reviewer', 'Robustness reviewer'],
    'Challenge a frozen candidate using identified evaluation evidence; preserve disagreement and exposure limitations.',
    ['revision_id', 'protocol_digest', 'criteria_assessment', 'exposure_limits'], ['advance', 'revise', 'reject', 'inconclusive', 'blocked']),
  'research.portfolio-review': definition('portfolio-review', 'Portfolio review',
    ['Risk chair', 'Exposure analyst', 'Portfolio researcher'],
    'Assess supported portfolio fit and paper-review readiness; missing inputs are explicit and live trading is excluded.',
    ['revision_id', 'exposures', 'overlap', 'monitoring', 'missing_inputs'], ['paper_review', 'reject', 'inconclusive', 'blocked']),
  'research.retrospective': {
    ...definition('retrospective', 'Research retrospective', ['Curator', 'Evidence reviewer', 'Scope reviewer'],
      'Extract scoped evidence-backed lessons and counterexamples; propose Knowledge edits without treating them as verified facts.',
      ['observations', 'counterevidence', 'knowledge_proposals'], ['propose', 'no_durable_lesson', 'blocked']),
    seats: { min: 2, max: 3, default: 2 },
  },
};

export function researchPattern(id: unknown): ResearchDefinition | undefined {
  return typeof id === 'string' && Object.hasOwn(RESEARCH_PATTERNS, id)
    ? RESEARCH_PATTERNS[id as ResearchPatternId] : undefined;
}
