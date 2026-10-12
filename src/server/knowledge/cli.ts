import { KnowledgeStore } from './store.js';
import { loadKnowledgeConfig } from './settings.js';
import { lintKnowledge } from './lint.js';
import { migrateKnowledge } from './migrate.js';
export function knowledgeCommand(argv: string[]) {
  const [action, ...flags] = argv;
  if (!['lint', 'migrate'].includes(action) || flags.some(f => f !== '--fix' || action !== 'lint')) throw Error('Usage: agent-office knowledge lint [--fix] | migrate (in the project checkout)');
  const store = new KnowledgeStore(process.cwd(), loadKnowledgeConfig(process.cwd()));
  const result = action === 'lint' ? lintKnowledge(store, flags.includes('--fix')) : migrateKnowledge(store);
  console.log(JSON.stringify(result, null, 2)); return result.errors.length ? 1 : 0;
}
