---
title: "Worker role assignments"
summary: "Specialized worker responsibilities use the prompt-tools and worker lifecycle registries."
author: "curator"
updated: "2026-10-13"
status: "needs-verification"
---
Developer, Reviewer, Tester and Researcher responsibilities are defined in `src/shared/worker-roles.ts`. Start an office prompt with `[Office worker role: reviewer]` followed by a newline and task to assign a role. `none` clears it; prompts without a directive retain the current role.

The shared editor `src/client/shared/worker-roles/ui.ts` registers in `src/client/ui/prompt-tools.ts` for Lite and game hiring/task dialogs. `src/server/worker-roles/service.ts` registers in `src/server/worker-features.ts`, persists assignments atomically with owner-only permissions in each floor's `.agent-office/worker-roles.json`, appends role responsibilities to office-delivered agent tasks, and removes assignments on worker departure. Shells and permission answers bypass decoration. Direct terminal typing bypasses it too. Roles guide model behavior rather than enforcing a sandbox.

Verify with `npm run typecheck`, `npm run build`, `npm test`, and `CHROMIUM_PATH=/path/to/chrome node --import tsx scripts/e2e-worker-roles.mjs`. Build before tests: server integration tests need `dist/public`. The browser harness uses a fake agent and writes screenshots to `/tmp/agent-office-worker-roles-evidence`.