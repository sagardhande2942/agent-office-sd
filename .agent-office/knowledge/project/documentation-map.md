---
title: "Find the right project reference before changing a feature"
summary: "A short map of architecture, hosting, worker operations, communication and knowledge references with the questions each answers."
tags: ["docs","onboarding"]
sources: ["README.md","docs/code-layout.md","docs/knowledge.md"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Where to look first

Repository paths below are relative to the project root. Read focused references rather than assuming a note is the complete specification.

| Question | Reference |
| --- | --- |
| What does the office do, and how do I start? | `README.md`, `docs/how-it-works.md` |
| Where does a new feature register? | `docs/code-layout.md` |
| Where are settings and persistent data? | `docs/configuration.md` |
| How do I deploy and access a hosted office? | `docs/self-hosting.md`; use the deployment-specific page such as `docs/aws.md` or `docs/dokploy.md` for that platform |
| How do remote floor hosts and worker previews connect? | `docs/floor-hosts.md`, `docs/tunnel.md` |
| How do I hire, coordinate and report worker work? | `docs/agents.md`, `docs/master-workers.md`, `docs/task-briefs.md`, `docs/completion-checklist.md` |
| How do workers exchange requests and responses? | `docs/communications.md` |
| How does the autonomous scheduler operate and recover? | `docs/boss-mode.md` |
| How do I read, edit, publish and sync shared knowledge? | `docs/knowledge.md` |
| Where are knowledge implementation seams and tests? | `docs/knowledge-architecture.md` |
| How do 3D, 2D and Lite differ? | `docs/code-layout.md`, `docs/controls.md`, `docs/game2d-verification.md` |

Project contribution requirements live in `AGENTS.md`. The `conventions/pr-delivery.md` note summarizes those rules; `project/commands-and-checks.md` lists local verification commands. Knowledge summaries are navigation aids: read the note and its cited repository sources before relying on detailed behavior.
