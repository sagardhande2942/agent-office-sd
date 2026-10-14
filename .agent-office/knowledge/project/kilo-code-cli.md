---
title: "Kilo Code CLI facts the office's provider depends on"
summary: "Verified behaviour of the Kilo Code CLI (kilo 7.8.8, plugin loader re-checked on 7.8.1) that the office's kilo provider relies on: it is an OpenCode fork, its loader calls a plugin definition's server() entry, it loads plugins from a workspace kilo.json, and how models, effort, resume and sign-in work."
author: "worker:19e5ba07aa61"
updated: "2026-10-14"
status: "needs-verification"
---
Everything below was checked against `@kilocode/cli` **7.8.8** on Linux (`npm install --prefix /tmp/kilo @kilocode/cli`; the binary is `kilo`, with `kilocode` as an alias, in `node_modules/.bin`). Re-check with `kilo --help`, `kilo models --help`, `kilo agent list` before trusting it later. The plugin-loader entry was re-checked against **7.8.1** on 2026-10-14 (see `project/opencode-plugin-bridge.md`).

## What it is

Kilo Code's CLI is a **fork of OpenCode's**: same plugin module API, same config shape, same model catalogue layout. That is why `src/server/providers/kilo.ts` loads the office's existing OpenCode plugin (`src/server/opencode.ts`) and reports on the `/hooks/opencode` bridge through `hooksAs`, instead of carrying a second copy of that plugin. Its plugin loader calls a definition's **`server()` entry** (not `setup()`, and not a hooks object returned from the module), so a plugin whose wiring lives in `setup()` loads without error and never reports anything — the desk then sits on *ready* forever.

## How the office names it

`src/server/agents.ts` `configuredProvider(command)` maps a `--agent <bin>` to a provider by matching `PROVIDER_META[p].bin`, falling through to `custom`. Kilo installs two launcher names for the same CLI (`kilo` and `kilocode`), so `ProviderMeta` also carries `bins?: readonly string[]` for extra spellings; the Kilo entry lists `bins: ['kilocode']`. Without it `--agent kilocode` fell through to **Custom**, which has no status bridge at all, so that desk sat on *ready* with nothing ever reporting. Any provider binary that installs under more than one name needs an entry here.

## Config

- Global config: `$XDG_CONFIG_HOME/kilo/kilo.jsonc` (i.e. `~/.config/kilo/kilo.jsonc`). `kilo mcp add` writes into that file.
- **Project config is read too**, `kilo.jsonc` first, then `kilo.json` in the working directory, merged over the global one (a project `model` won over a global one in testing).
- A `plugin` array of module specifiers (`file:///…`) loads OpenCode-style plugins; an object plugin is the default export. `chat.message`, `tool.execute.before/after` and the `event` bus (`session.created`, `session.idle`, `session.status`, `session.error`, `message.updated`, `permission.asked`, …) all fire, the same events the office's plugin already reads.
- When Kilo reads a project config it rewrites it with a `$schema` key, so a file the office created comes back as `{"$schema": …}` after the worker leaves; `removeKiloConfig` treats that key as no content.
- `KILO_CONFIG`, `KILO_CONFIG_DIR`, `KILO_CONFIG_FILE`, `KILO_CONFIG_PATH`, `KILO_HOME`, `KILO_CONFIG_CONTENT` and `OPENCODE_CONFIG_CONTENT` have **no effect** — there is no env-var config override, unlike OpenCode.
- `mcp` entries are OpenCode's shape: `{"<name>": {"type": "local", "command": ["node", "script.js"], "enabled": true}}`.

## Flags (`kilo` with no subcommand = the TUI)

`-m/--model provider/model`, `--prompt <text>`, `-s/--session <id>`, `-c/--continue`, `--agent <name>`, `--mini`, `--auto`, `--pure` (disables plugins — the office strips it), `--worktree`, `--print-logs`, `--log-level`. There is **no `--variant`**: a reasoning effort is the model's *variant*, applied by setting `model.variant` on the first chat message, which is what the office's OpenCode plugin already does through `AGENT_OFFICE_EFFORT`.

`kilo agent list` shows the primary agents `ask`, `code`, `compaction`, `debug`, `orchestrator`, `plan`, `summary`, `title` — `plan` is what the office's plan-comparison lock asks for.

## Models

`kilo models` prints one `provider/model` id a line (327 on a fresh install, all `kilo/…` through the Kilo Gateway); `kilo models --verbose` adds each model's JSON details, including `name`, `cost` and `variants` — the same parser `fetchOpenCodeModels` in `src/server/models.ts` reads. `kilo models <provider>` filters by provider id.

## Signing in

There is no `kilocodeToken` needed for the gateway; a worker that is not signed in shows **"You need to sign in to use this model"** and **"Run /connect or `kilo auth login`"**, and every model call fails with `PAID_MODEL_AUTH_REQUIRED`. `/connect` is a slash command inside the TUI. Auth lives in the XDG data dir, which the office never touches.

## ACP

`kilo acp` speaks the Agent Client Protocol v1 over stdio (`initialize` → `session/new`, which returns `model`, `effort` and `mode` config options and advertises `sessionCapabilities.resume`). The office drives DeepSeek Harness over ACP instead (`src/server/dsh.ts`); Kilo is supported over its TUI with the plugin, which is the cheaper path because the ACP client there is DeepSeek-specific.
