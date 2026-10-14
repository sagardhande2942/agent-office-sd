---
title: "Fast, reliable test iteration"
summary: "Use npm run test:focus -- tests/<affected>.test.ts and test:profile:focus; finish builds before integrations, run final checks once, and investigate probe/startup flakes."
author: "worker:ab37cab0c171"
updated: "2026-10-14"
status: "active"
pinned: true
tags: ["testing","performance"]
---
# Fast, reliable test iteration

From the repository root:

```sh
npm ci --ignore-scripts
npm run build
npm run test:focus -- tests/<affected>.test.ts
npm run test:focus -- --test-name-pattern='retention' tests/communications.test.ts
npm run test:profile:focus -- tests/client-structure.test.ts tests/client-registry.test.ts
npm run test:profile
```

Include affected integration files. A fresh checkout needs dependencies and dist/ artifacts before server/subprocess integrations. Finish the build before starting tests in the same worktree: Vite replaces dist/public, so a concurrent build can cause Client bundle not found failures. This was observed in four integrations during this task; the build passed and the suite was rerun after it finished. Rebuild compiled entry points after changing them. Run npm run typecheck, npm test and npm run build once the finished patch is ready; after passing, repeat only for new edits or unresolved concerns. Visual changes also require their headless browser harness and screenshot. See docs/testing.md.

Node's isolated test processes prevent environment/global leaks. Do not remove isolation or assertions for speed. Architecture guards can reuse read-only source snapshots and import resolution within one process, but never persist caches between runs. This removes repeated filesystem trips, especially on WSL /mnt/c.

Fake interactive agents must finish incidental --version and -p task-label requests. tests/fixtures/idle-agent.ts implements that contract. In the observed profile, plan-review-server.test.ts took 48.599 seconds total with 4.136 seconds of assertions before reuse of idleAgent; afterward its focused profile took 2.254 seconds total. Those runs had different contention, so treat timings as diagnostic evidence rather than a guaranteed speedup. The removed roughly 45-second tail matches src/server/tasks.ts's label deadline.

The observed full profile also found registry guards at 26.956 seconds and composition guards at 56.203 seconds. After per-process caching, focused profiles showed 2.701 seconds and 6.124 seconds respectively; machine load and concurrency differed.

Known flakes: the live floor probes fake HTTP servers with GET / and user-agent agent-office. Exclude only that discovery probe from exact request accounting; office-workers.test.ts injects it deterministically. worker-shutdown.test.ts starts its seven-second shutdown guard after module imports and bounds startup separately. Record failures and passing isolation runs honestly; retries alone do not prove a fix.

New implementation worker prompts include focused-testing guidance via WORKER_COORDINATION in src/server/prompts.ts. The worker manager appends it for normal implementation launches, including customized prompts and providers. Read-only planning launches retain their plan-only restrictions.
