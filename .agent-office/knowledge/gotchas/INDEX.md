---
kind: "index"
summary: "Knowledge about gotchas."
---
# gotchas

## Entries
- [shared-checkout-and-pr-target.md](shared-checkout-and-pr-target.md) — The main checkout is shared and rarely clean: branch in a worktree, never commit others' changes there, and target pull requests at the project's real remote.
- [size-guard.md](size-guard.md) — tests/size.test.ts caps every src/.ts and .css file at 600 lines, with a CEILINGS list that may only shrink; split files instead of raising ceilings.
- [worktree-node-modules.md](worktree-node-modules.md) — A fresh worktree has no node_modules and no dist: symlink the main checkout's node_modules and run npm run build before typecheck, tests or browser checks. [status: needs-verification]
