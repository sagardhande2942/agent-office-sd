---
title: "Automatic Knowledge review synchronization"
summary: "Checkout owners poll pending reviews on startup and every minute, applying merged reviews without overwriting newer edits."
author: "worker:39be14591b15"
updated: "2026-10-13"
---
`src/server/knowledge/auto-sync.ts` installs through `src/server/worker-features.ts` on the floor that owns the checkout. It checks persisted published reviews at startup and every 60 seconds, even without an open shelf or an enabled curator. Remote hosts run the same floor registry and forward Knowledge tree/status events.

Automatic sync uses `syncKnowledge` from `src/server/knowledge/delivery.ts`. Automatic and manual calls share an in-flight operation keyed by the real knowledge root. Open reviews stay pending; closed reviews preserve notes. Merged reviews use the existing whole-proposal reconciliation guards and do not move the project HEAD or staging area. Newer live edits require reconciliation instead of being overwritten.

Transient forge/fetch errors retry on the next interval. Unchanged pending/conflicting records and repeated identical errors do not generate repeated notifications. Floor shutdown stops polling and notifications; an in-progress sync may finish applying the already approved review.

Verification: `node --import tsx --import=#tests/css --test tests/knowledge-auto-sync.test.ts tests/knowledge-delivery.test.ts`. Fixtures use a local bare remote and injected review states to verify merged/closed/open reviews, conflicts, retries, polling/shutdown, broadcasts, and concurrent manual sync. Run `npm run typecheck`, `npm run build`, then `npm test` for repository checks.

This behavior is proposed in the automatic-sync code PR and takes effect after that change is merged and the running floor is updated.