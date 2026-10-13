---
title: "OpenCode and Kilo status plugin: how each CLI loads it"
summary: "The office's generated OpenCode/Kilo status plugin (src/server/opencode.ts): the module shape OpenCode 1, OpenCode 2 and Kilo each load, where each reads it from, and the lifecycle signals each reports."
author: "worker:19e5ba07aa61"
updated: "2026-10-13"
---
Verified 2026-10-14 on Linux against the installed `opencode` **v2.0.24** (`~/.opencode/bin/opencode`) and `@kilocode/cli` **7.8.1** (`kilo`, with `kilocode` as an alias). Re-check with `opencode --version`, `kilo --version` before trusting it.

## What the office writes

`writeOpenCodePlugin(dataDir)` in `src/server/opencode.ts` writes **one package directory**, `<dataDir>/agent-office-opencode/`:

- `index.mjs` — the plugin, whose default export is `{ id: 'agent-office-opencode', setup(ctx), server() }`.
- `package.json` — a minimal manifest (`name`, `version`, `type: module`, `main`, `exports`).

One export serves three loaders: `server()` returns the OpenCode-1-style hook object and `setup(ctx)` drives OpenCode 2's newer context. `openCodePluginSpecifier(entry)` returns the `file://` URL of the entry file; `openCodePluginDir(entry)` returns the `file://` URL of its directory.

## How each CLI loads it

| CLI | Config key | Value it needs | Entry it calls |
| --- | --- | --- | --- |
| OpenCode 1 | `plugin` | module file URL | the factory export (a function returning hooks) |
| OpenCode 2 | `plugins` | package **directory** URL | the definition's `setup()` |
| Kilo | `plugin` in workspace `kilo.json`/`kilo.jsonc` | `file://…/index.mjs` (a file, not the directory) | the definition's `server()` |

Loader failures seen verbatim (OpenCode 2, `--print-logs --log-level debug`):

- a module file → `configured plugin path must be a directory`
- a bare exported function → `Plugin must export a default definition with an id and an effect or setup function`

Kilo's loader accepts a bare exported function too, but when the module is a definition object it calls `server()`: a definition whose `setup()` returns the hooks loads without error and silently never calls them, which looks exactly like "the worker is always ready".

The office passes OpenCode's plugin per process through `OPENCODE_CONFIG_CONTENT` (`mergeOpenCodeConfigContent`); Kilo has no env-var config override, so the office merges into the workspace `kilo.json` (`src/server/kilo.ts`, plugin entry marked by `PLUGIN_MARK`). `kilo.jsonc` wins over `kilo.json`.

## Lifecycle signals each reports

Both paths POST the same compact payloads to `/hooks/opencode` (`src/server/providers/opencode.ts` reduces them): `session` (starting/working/done), `prompt`, `tool`, `permission`, `error`, `usage`, `checkpoint`.

- **OpenCode 1 and Kilo** — the hook object: `chat.message`, `tool.execute.before`, `tool.execute.after`, and the `event` bus (`session.created`, `session.status`, `session.idle`, `session.error`, `permission.asked`/`replied`, `message.updated`). Kilo's event payloads carry `event.properties`.
- **OpenCode 2** — `ctx.event.subscribe({ signal })` (an async iterable, not a callback) yields `session.execution.started`/`.succeeded`/`.failed`/`.interrupted` (no busy/idle `session.status` in practice), `session.inbox.*`, `session.usage.updated`, `permission.asked`/`permission.replied`, reading `event.data`; plus `ctx.tool.hook('execute.before'|'execute.after')`, `ctx.session.hook('prompt')` and `ctx.permission.hook('evaluate')`.

OpenCode 2 exposes no model variant in the prompt hook, so the office's Effort is applied only on OpenCode 1/Kilo (it sets `model.variant` on the first message); on OpenCode 2 pick one with `Ctrl+T`.

## Probing it by hand

```sh
# a throwaway HTTP sink that logs hook bodies
node hook-server.mjs /tmp/hooks.log

# OpenCode 2: point at the directory, not the file
OPENCODE_CONFIG_CONTENT='{"plugins":["file:///abs/agent-office-opencode"]}' \
AGENT_OFFICE_HOOK_URL=http://127.0.0.1:<port> AGENT_OFFICE_HOOK_TOKEN=t AGENT_OFFICE_WORKER_ID=w \
opencode run --standalone --print-logs --log-level debug --model <provider/model> "hi"

# Kilo: the plugin goes in the workspace kilo.json
printf '{ "plugin": ["file:///abs/agent-office-opencode/index.mjs"] }\n' > kilo.json
AGENT_OFFICE_HOOK_URL=http://127.0.0.1:<port> AGENT_OFFICE_HOOK_TOKEN=t AGENT_OFFICE_WORKER_ID=w \
kilo run --print-logs --log-level DEBUG --model <provider/model> "hi"
```

`opencode debug config` and `kilo debug config` print the resolved `plugins`/`plugin` array, which is what each CLI actually loaded. A real model turn needs a signed-in account, so an unauthenticated `PAID_MODEL_AUTH_REQUIRED` or quota error still exercises the whole lifecycle (session, prompt, working, tool, error, done).
