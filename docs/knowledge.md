# Knowledge Tree

Back to the [README](../README.md). Engineering details: [Knowledge architecture](knowledge-architecture.md).

The Knowledge shelf is a hierarchical Markdown knowledge base committed with the project. Workers start with the root index, pinned note summaries and task hints. They read the notes they need; note bodies are never automatically injected or sliced. Agents maintain the tree themselves.

## Browse and edit

Press **E** at the shelf on the west wall beside the basketball hoop, or choose **📜 Knowledge base** in **☰**. The left pane lists directories and notes; the right pane renders Markdown. Every row shows its lifecycle status, including archived and needs-verification notes. Search returns matched lines and adjacent context. Tags are displayed with the selected note.

![Knowledge shelf with lifecycle badges](knowledge-evidence/knowledge-shelf.png)

The branch label identifies the **floor checkout**. Workers' tools instead use **their own worktrees**. A worker's unmerged knowledge changes will appear on the shelf after merging and updating the floor checkout. Hosted floors read and write on the host through the same RPC surface.

Edit preserves sources, pinned state, paths and verification metadata; status changes only when you select a different status. The uncommitted label and **Commit** button expose working-tree changes. Commit stages the knowledge directory and creates `knowledge: edit <title>` on the floor branch; it refuses unrelated staged changes. It does not push. **Use in prompt** copies a relative path and a `knowledge_read` instruction.

**Handovers** lists local shift journals. Journals are read-only, full-length evidence from workers, not independently verified facts. **Promote to knowledge** opens an editor prefilled with the journal; write a durable, focused note with evidence before saving. **History** uses Git, and **Restore** reverts a knowledge-only commit on a clean checkout.

Closing the window with its top-right ✕ or Esc uses the office's normal modal/pointer-lock lifecycle.

## Worker tools

MCP and CLI share `/office/workers/knowledge`, authenticated with the worker's own hook token. Paths are relative to the configured knowledge root, not the repository root.

```sh
office-workers knowledge index
office-workers knowledge index architecture/server
office-workers knowledge read project/test.md
office-workers knowledge read project/test.md --offset 20 --limit 40
office-workers knowledge search "npm test" --scope project
office-workers knowledge write <<'JSON'
{"path":"project/test.md","frontmatter":{"title":"Run tests","summary":"Run npm test and the fixture E2Es","tags":["testing","ci"],"pinned":true,"paths":["tests/**"]},"body":"Run `npm test`. Record the actual result before opening a PR.\n"}
JSON
office-workers knowledge mv project/test.md project/testing.md
office-workers knowledge archive project/testing.md "Replaced by new test runner"
office-workers knowledge review <<'JSON'
{"changed":["project/testing.md"]}
JSON
```

The corresponding MCP names are `knowledge_index`, `knowledge_read`, `knowledge_search`, `knowledge_write`, `knowledge_move`, `knowledge_archive`, and `knowledge_review_done`. Write supports `howto`, `gotcha`, `decision`, and `module` templates. Worker identity, author and updated date are assigned by the server. Workers cannot write indexes or `_meta`, follow symlinks, access parent paths, or delete notes.

A read returns the complete file by default. Optional paging uses zero-based line offsets and returns total lines and the next offset. Search is a case-insensitive literal search of frontmatter and bodies; each hit includes the matched line and one line of context on each side. It reports the number of omitted hits. Search never returns entire notes automatically.

## Writing and indexes

The office seeds `INDEX.md`, `_meta/config.json`, empty indexes in `project`, `architecture`, `conventions`, `gotchas`, and `decisions`, and `_open-questions.md`. It does not invent build/run/test facts. Write operational notes after observing commands and their results.

Write for a stranger. Include commands verbatim. Keep one topic per file; rationale and detailed operational steps are welcome. Split files beyond about 200 lines, or directories beyond about 40 entries. Never paste secrets.

```markdown
---
title: Run the test suite
summary: npm test and the fixture browser checks
tags: [testing, ci]
status: active
pinned: true
paths: [tests/**]
sources: [PR 123, commit abcdef123]
author: worker:ada
updated: 2026-10-13
verified_at: abcdef123
---
Run `npm test` from the repository root.
```

Only title and summary are required. Frontmatter supports single-line scalars and inline arrays; quoted strings and JSON-style arrays are supported. Multiline YAML, aliases, nesting and arbitrary YAML objects are rejected. Bodies are free-form Markdown. Indexes contain sorted, single-line child links under `## Entries`; archived notes go under `## Archived`. Writes create intermediate directory indexes and update the immediate parent automatically. Index prose is retained when entries are regenerated.

## Completion review

The default required policy holds the first completion submission when that worker/task revision lacks a review. The tool returns a follow-up instruction to inspect `git diff <base>...HEAD`, update durable knowledge, record the review and resubmit the checklist. A no-change review is valid and needs `none_reason`.

The office prompts only once per revision. A second submission without review is accepted with **Knowledge review missing** in the local journal. Prompt policy is advisory and returns its review instruction with the accepted report and in the journal; off skips review. The separate knowledge commit is normally made by the worker. Office commit mode stages only the knowledge root and refuses an already occupied staging area. None leaves changes uncommitted.

The follow-up tells the worker to rebase, push and append/replace `## Knowledge base updates` in its existing PR/MR description using `gh` or `glab`. When a review exists, the journal includes the formatted section, listing paths and summaries; a human can paste it if the forge CLI is unavailable. The office does not edit worker MR descriptions itself.

## Configuration and limits

Put per-floor settings in `<project>/.agent-office/knowledge.json`. Omitted fields use these defaults:

| Setting | Default |
| --- | --- |
| `dir` | `.agent-office/knowledge` |
| `bootstrapBudgetChars` | `4000` |
| `hintCount` | `8` |
| `reviewPolicy` | `required` (`prompt`, `off` supported) |
| `commitMode` | `worker` (`office`, `none` supported) |
| `mrSection` | `true` |
| `maxNoteBytes` | `65536` |
| `searchMaxHits` | `40` |
| `handoversDir` | `.agent-office/handovers` |
| `legacyLore` | `false` |

Knowledge is committed except `_meta/state/`, which contains local usage counts, review records, prompt guards and curator schedule/run state. Journals are also local and gitignored. Seeding adds explicit `.gitignore` exceptions for the knowledge tree; review and commit that ignore change alongside the first knowledge commit. A fresh checkout therefore has seed changes until its first knowledge commit.

Writes reject files over 64 KiB and warn beyond 16 KiB. Directory indexes warn beyond 40 entries. Bootstrap drops whole lines/entries and explicitly says to call `knowledge_index` when entries were omitted. There is no note-body slicing. Hints use title, summary, tags, paths, update recency and local read counts; short technical tokens (`ci`, `js`, `ts`, `db`, `ui`, `pr`, `mr`) participate. Needs-verification hints are labelled; archived or invalid notes are excluded.

## Lint and migration

Run in the project checkout:

```sh
agent-office knowledge lint
agent-office knowledge lint --fix
agent-office knowledge migrate
```

From source, use `node --import tsx src/server/cli.ts knowledge lint`. Lint checks directory indexes, child membership, sort order, valid frontmatter, byte limits, symlinks and credential patterns. Fix regenerates entry blocks from children's frontmatter; invalid notes are reported and never rewritten. Resolve an index merge conflict by keeping both branches' notes, then regenerating the index.

Migration imports legacy `.agent-office/lore/*.json` into `_imported/`, puts archived/superseded discoveries in `_imported/_archive/`, and moves handover **copies** to the local journal. It maps provenance and historical update dates, generates indexes, and leaves all original JSON untouched. Re-running skips already imported files. Credential-bearing or malformed notes are reported rather than committed.

The floor checkout is the live central knowledge store: every worker and worktree reads and writes the same tree, so shelf edits and worker discoveries are immediately shared across the office. Curator results are copied into that live tree as `needs-verification` proposals after their tagged review PR is published. They remain visible in the shelf but are excluded from automatic worker prompt hints until a human changes their status to `active`. The Git PR is the durable audit and synchronization path, not the runtime visibility gate.

The old worker Lore endpoint is disabled by default and directs callers to the Knowledge tools. `legacyLore: true` retains the old worker-memory injection and curator during the transition release. Compatibility modules remain available for this rollout; the Knowledge shelf uses the new tree. Run migration before switching a populated floor to the tree. Removal of the old modules is a subsequent compatibility-breaking step.

## Curator

The existing Knowledge curator settings control the tree by default: completion debounce (30 seconds), interval or daily IANA scheduling, pause/resume, one catch-up and exponential 5–60 minute retry. Models still run noninteractively in empty temporary directories with tools, hooks and MCP disabled, five-minute timeouts and a 1 MiB output cap.

A run fetches `origin/main`, creates `agent-office/knowledge-curation/<date>-<id>` in a separate worktree, and reviews bounded batches plus committed repository evidence. Its review request title starts with `[Knowledge]`. Exact duplicates and changes since `verified_at` are handled without asking the model for those notes. Models may merge, split, move, archive, flag, verify, rewrite summaries, fix indexes and promote read-only journals. All action paths and new destinations are supplied in advance; the whole response is validated before applying it. Concurrent changes are guarded by the full note snapshot, including its `updated` field.

After lint, changes are committed, pushed to the verified origin, and published with the matching GitHub/GitLab CLI. The floor branch is never switched. Failures retain the curation branch/worktree for inspection and report it in the run summary. Git history replaces the old overlay journal for the new tree; legacy originals remain untouched.

Verification scripts use fixture agents and isolated Git repositories:

```sh
node --import tsx scripts/e2e-knowledge-tree.mjs
node --import tsx scripts/e2e-knowledge-shelf.mjs
node --import tsx scripts/e2e-knowledge-curator.mjs
```

The browser script finds installed Playwright Chromium or accepts `CHROMIUM_PATH`; screenshots and checks go to `/tmp/agent-office-knowledge-evidence` (override `KNOWLEDGE_ARTIFACTS`). The curator fixture mocks MR publishing rather than creating an external review request.
