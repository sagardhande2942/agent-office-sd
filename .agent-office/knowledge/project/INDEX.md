---
kind: "index"
summary: "Knowledge about project."
---
# project

## Entries
- [commands-and-checks.md](commands-and-checks.md) — Verbatim npm commands for install, focused tests/profiling, final checks, and headless-browser Chromium discovery.
- [data-and-recovery.md](data-and-recovery.md) — Distinguish building data, project checkouts, shared knowledge and local review state before moving folders or recovering publication. [tags: configuration, recovery, knowledge]
- [documentation-map.md](documentation-map.md) — A short map of architecture, hosting, worker operations, communication and knowledge references with the questions each answers. [tags: docs, onboarding]
- [kilo-code-cli.md](kilo-code-cli.md) — Verified behaviour of the Kilo Code CLI (kilo 7.8.8, plugin loader re-checked on 7.8.1) that the office's kilo provider relies on: it is an OpenCode fork, its loader calls a plugin definition's server() entry, it loads plugins from a workspace kilo.json, and how models, effort, resume and sign-in work. [status: needs-verification]
- [opencode-plugin-bridge.md](opencode-plugin-bridge.md) — The office's generated OpenCode/Kilo status plugin (src/server/opencode.ts): the module shape OpenCode 1, OpenCode 2 and Kilo each load, where each reads it from, and the lifecycle signals each reports.
- [overview.md](overview.md) — agent-office: a 3D multiplayer office where agent CLIs work at desks, with a server, a Lite dashboard and many floor features.
- [test-selection.md](test-selection.md) — Build before integration tests, use focused test files for diagnosis, and choose the feature-specific E2E without claiming fixtures prove live providers. [tags: testing, ci, browser]
- [test.md](test.md) — Typecheck, build, unit tests and fixture Knowledge E2Es [tags: testing, ci] [status: needs-verification] [pinned]
- [testing-efficiently.md](testing-efficiently.md) — Use npm run test:focus -- tests/<affected>.test.ts and test:profile:focus; finish builds before integrations, run final checks once, and investigate probe/startup flakes. [tags: testing, performance] [pinned]
