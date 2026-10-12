---
title: "Run repository checks"
summary: "Typecheck, build, unit tests and fixture Knowledge E2Es"
tags: ["testing","ci"]
pinned: true
paths: ["tests/**","scripts/e2e-*.mjs"]
sources: ["package.json scripts","scripts/e2e-knowledge-tree.mjs","scripts/e2e-knowledge-shelf.mjs","scripts/e2e-knowledge-curator.mjs","commit 50e0997363d0db3ca18c7c366bf91d90665bd2d6"]
author: "worker:c92d84159150"
updated: "2026-10-12"
status: "active"
verified_at: "50e0997363d0db3ca18c7c366bf91d90665bd2d6"
---
# Repository checks

From the repository root:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
node --import tsx scripts/e2e-knowledge-tree.mjs
node --import tsx scripts/e2e-knowledge-shelf.mjs
node --import tsx scripts/e2e-knowledge-curator.mjs
```

Build before server integration tests: the server needs `dist/public`. The Knowledge E2Es use fixture agents and isolated Git repositories; the curator fixture uses a mocked MR publisher. The shelf fixture accepts `CHROMIUM_PATH` and writes its screenshot/checks to `/tmp/agent-office-knowledge-evidence`.

Evidence: package.json scripts and a successful local build, Knowledge unit suite and all three fixture E2Es during the Knowledge Tree implementation.
