---
title: "Commit the initial knowledge seed before team dispatch"
summary: "A fresh seed changes .gitignore and indexes; team dispatch requires a clean participant checkout"
tags: ["git","knowledge"]
paths: ["src/server/knowledge/**","src/server/master-workers/**"]
sources: ["tests/boss-mode-server.test.ts","tests/master-workers-server.test.ts","tests/remote-master-workers-server.test.ts","commit 50e0997363d0db3ca18c7c366bf91d90665bd2d6"]
author: "worker:c92d84159150"
updated: "2026-10-12"
status: "active"
verified_at: "50e0997363d0db3ca18c7c366bf91d90665bd2d6"
---
# Initial seed and clean team checkouts

On a new project, Knowledge seeds the tree and adds .gitignore exceptions. Commit that initial seed before starting a coordinated team that dispatches from a clean participant checkout. Otherwise the team guard reports `Commit or resolve the participant checkout before dispatch, acceptance or completion`.

Evidence: the three team integration fixtures initially failed at dispatch after introducing Knowledge seeding; committing `.gitignore` and `.agent-office/knowledge` before team creation restored passing dispatch. Knowledge review is independently required before accepting a completion checklist; these fixtures explicitly record a no-change review.
