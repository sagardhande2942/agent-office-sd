import { OverlappingKnowledgeActions, parseKnowledgeActions, type CurationInput } from './curation.js';

/** Validate the entire plan before any edit; conflicting plans get one correction attempt. */
export async function requestKnowledgePlan(request: (instructions: string) => Promise<unknown>, batch: CurationInput[], destinations: string[], evidencePaths: string[], signal: AbortSignal) {
  const rules = 'Each path may participate in only one action, including merge targets and split destinations. Do not merge and archive the same source separately, or combine summary and status actions for one note. Choose one action per note and defer other changes to a later run. Empty actions are valid.';
  signal.throwIfAborted();
  const value = await request(rules);
  try { return parseKnowledgeActions(value, batch, destinations, evidencePaths); }
  catch (error) {
    if (!(error instanceof OverlappingKnowledgeActions)) throw error;
    signal.throwIfAborted();
    const corrected = await request(`${rules} Your previous plan was rejected before any edits: ${error.message} Return a complete replacement plan with no overlapping paths.`);
    return parseKnowledgeActions(corrected, batch, destinations, evidencePaths);
  }
}
