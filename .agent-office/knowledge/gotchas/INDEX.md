---
kind: "index"
summary: "Knowledge about gotchas."
---
# gotchas

## Entries
- [headless-chromium-libs.md](headless-chromium-libs.md) — On a machine whose system is missing libnspr4/libnss3 etc., the e2e browser checks fail to launch Chrome until LD_LIBRARY_PATH points at a copy of the libs.
- [knowledge-delivery.md](knowledge-delivery.md) — Review worktrees run asynchronously; Git diagnostics and retained proposals support safe retries.
- [knowledge-seed-checkout.md](knowledge-seed-checkout.md) — A fresh seed changes .gitignore and indexes; team dispatch requires a clean participant checkout [tags: git, knowledge]
- [live-office-probes-test-servers.md](live-office-probes-test-servers.md) — tests/office-workers.test.ts (and friends) can see an extra GET / with user-agent agent-office while a real floor runs on the machine; re-run the file in isolation before blaming a diff.
- [shared-checkout-and-pr-target.md](shared-checkout-and-pr-target.md) — The main checkout is shared and rarely clean: branch in a worktree, never commit others' changes there, and target pull requests at the project's real remote.
- [size-guard.md](size-guard.md) — tests/size.test.ts caps every src/.ts and .css file at 600 lines, with a CEILINGS list that may only shrink; split files instead of raising ceilings.
- [worker-mcp-tool-allow-list.md](worker-mcp-tool-allow-list.md) — Adding a worker MCP tool breaks tests/workers.test.ts as well as tests/office-workers.test.ts: both assert the exact claude-hooks permissions allow-list.
- [worktree-node-modules.md](worktree-node-modules.md) — A fresh worktree has no node_modules and no dist: symlink the main checkout's node_modules and run npm run build before typecheck, tests or browser checks. [status: needs-verification]
