---
title: "The live office probes throwaway test servers, flaking exact-request assertions"
summary: "tests/office-workers.test.ts (and friends) can see an extra GET / with user-agent agent-office while a real floor runs on the machine; re-run the file in isolation before blaming a diff."
author: "worker:936578b80a46"
updated: "2026-10-13"
---
While a floor's office runs on the same machine, `Services` in `src/server/services.ts` scans listening TCP sockets (`ss -H -l -t -n -p`) and probes each listener it can attribute to a worker, including a test's throwaway HTTP server when the test's working directory is inside a worker worktree. The probe is a single `GET /` with `user-agent: agent-office` and `accept: text/html,*/*`.

Tests that assert exactly which requests their fake server received then fail intermittently, because the probe arrives alongside the expected call. `tests/office-workers.test.ts` ('office-workers mcp serves a real client over stdio, as the worker') expects one `list_workers` request and fails when the probe lands first.

Reproduced on an unmodified base commit: running the same test runner from inside a worker worktree flaked about 1 in 40 runs, while running it from `/tmp/opencode` was clean in 100 runs — the working directory, not the code, decides whether the office probes the listener.

Related load flakes seen in full `npm test` runs on a busy floor: `tests/tui-session.test.ts` ('Missing terminal output: Ada') and `tests/clone.test.ts`; both pass in isolation.

When a full-suite run reports one unrelated failure, re-run that test file alone and check whether the live office or machine load explains it before suspecting the diff. CI without a running office is the authority.