---
kind: "index"
summary: "Knowledge about project."
---
# project

## Entries
- [commands-and-checks.md](commands-and-checks.md) — Verbatim npm commands for install, dev, typecheck, tests, build, and how the headless-browser e2e harnesses find Chromium.
- [kilo-code-cli.md](kilo-code-cli.md) — Verified behaviour of the Kilo Code CLI (kilo 7.8.8, plugin loader re-checked on 7.8.1) that the office's kilo provider relies on: it is an OpenCode fork, its loader calls a plugin definition's server() entry, it loads plugins from a workspace kilo.json, and how models, effort, resume and sign-in work. [status: needs-verification]
- [opencode-plugin-bridge.md](opencode-plugin-bridge.md) — The office's generated OpenCode/Kilo status plugin (src/server/opencode.ts): the module shape OpenCode 1, OpenCode 2 and Kilo each load, where each reads it from, and the lifecycle signals each reports.
- [overview.md](overview.md) — agent-office: a 3D multiplayer office where agent CLIs work at desks, with a server, a Lite dashboard and many floor features.
- [test.md](test.md) — Typecheck, build, unit tests and fixture Knowledge E2Es [tags: testing, ci] [status: needs-verification] [pinned]
