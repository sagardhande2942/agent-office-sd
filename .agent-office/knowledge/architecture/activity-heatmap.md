---
title: "Activity heatmap"
summary: "Bounded observed phase intervals, signal limitations, registries and validation."
author: "worker:50b74fd788b0"
updated: "2026-10-14"
status: "active"
---
# Activity heatmap

Feature modules: src/shared/activity-heatmap.ts aggregates worker-time and union wall time; src/server/activity-heatmap/ persists bounded phase intervals; src/server/activity-heatmap-signals/ consumes accepted root provider tool boundaries; src/client/shared/activity-heatmap/ serves Lite and game views. Entry points join existing registries. See docs/activity-heatmap.md for phase precedence and coverage.

Claude paired tools measure edit and check durations; Codex compact hooks omit command arguments, so shell check time remains unknown. General working status is never assumed to be implementation. Retry is running retry-attempt work; review is submitted-result elapsed time awaiting review, not human review effort. Restart closes live intervals at last heartbeat and excludes downtime. Retention is 2,000 intervals/seven days; earlier history is explicitly partial.

Verify with `npm run typecheck`, `npm test`, `npm run build` and `node --import tsx scripts/e2e-activity-heatmap.mjs`. Browser artifacts: `/tmp/agent-office-activity-heatmap-evidence`. Harness uses real temporary floors and a fake local lifecycle process, no model calls.
