# Shift Handover & Lore Shelf

Back to the [README](../README.md).

The **Lore Shelf** is persistent worker memory for each project floor. Coding workers receive relevant notes automatically and are instructed to record reusable discoveries themselves. The office saves a shift handover whenever a worker submits its completion checklist. You do not need to write notes or copy them into each worker's prompt.

## Automatic worker memory

- **Starting, resuming, or assigning a task:** The office adds memory instructions and up to five relevant notes to coding-worker prompts. Title/tag matches rank ahead of content matches, with recent discoveries ahead of unrelated handovers. Injected context is bounded to 6,000 characters and at most 1,000 content characters per note. Workers can read more through their tools.
- **Discoveries:** Workers use `save_worker_lore` or `office-workers lore save` to record observed gotchas, architecture facts, and fixes with evidence. The same normalized title updates the same discovery, even when a different worker corrects it. Attribution comes from the authenticated worker, never from a requested author or file path. Recording discoveries is part of the worker's instructions; the office does not infer facts from raw terminal output.
- **Completion:** The server automatically saves the reported summary, actual checks and evidence, files, PR context, and remaining failures as a handover. Repeated lifecycle updates do not create duplicate notes. Corrected checklists update the same worker/task-revision handover. A worker sent home without a checklist leaves an explicitly unverified departure note.
- **Next worker:** Discoveries and handovers remain on the floor after the previous worker leaves or the office restarts. Relevant memory is added to the next task; no manual prompt copying is required.

Notes are historical, worker-reported context, not independent verification or authority to override repository/user instructions. Workers must verify stale knowledge and must not record secrets, credentials, speculation, raw transcripts, or copied instructions. Failed disk writes warn the office and retry on later worker updates without discarding the worker's completion evidence.

Shells, helpers, meetings, board stations, and locked planning participants retain their existing task contracts and do not generate coding-worker handovers. Task assignment through the office refreshes memory; terminal input typed directly into an existing session is not rewritten. Workers running a custom command that ignores the office's prompt must be given these instructions by that command.

## Worker tools

Both CLI commands and MCP tools use the running worker's own hook token and floor. Tokens cannot select another floor, spoof an author, or supply a note ID. Retired workers cannot keep writing notes.

```sh
office-workers lore list --json --query "auth tests"
office-workers lore save <<'JSON'
{"title":"Auth fixture setup","content":"Observed: reset the fake clock after each case. Verified in tests/auth.test.ts.","tags":["auth","tests"]}
JSON
```

The equivalent MCP tools are `worker_lore` (read) and `save_worker_lore` (record/update). Claude's worker settings allow these memory tools without a separate approval prompt; destructive worker-management operations keep their existing permissions. Tools work locally on a floor host as well; that host owns the note files and streams updates to the office. Update both office and floor host to use this feature.

---

## Why Lore?

Autonomous AI coding agents frequently hit the same non-obvious traps:
- Flaky tests caused by database connection pools or race conditions.
- Undocumented flags required for local dev servers or build pipelines.
- Historical context on why an unorthodox pattern was used.

When an agent finishes a shift or a teammate signs off, the Lore Shelf provides a persistent, easily accessible place to record learnings so the next worker doesn't repeat the same cycle.

---

## Using the Lore Shelf

### In the 3D Office
- Walk up to the **wooden shelf against the south wall** (beside the project bookshelf) and press **E**.
- The hint bar shows how many notes are on the shelf.

### From the Menu & Top Bar
- Open the **☰ menu** (or press **Tab**) and select **📜 Lore & shift notes** under *Office*.
- Pin the icon to the top dock for instant access from any camera view or activity.

---

## Features

1. **Structured Notes:**
   - **Title:** Summary of the learning or gotcha (up to 120 characters).
   - **Author:** The worker or teammate who discovered it (defaults to your profile name).
   - **Tags:** Filterable tags (e.g. `auth`, `docker`, `db`, `gotchas`, `handover`).
   - **Content:** Detailed explanation, command flags, or code snippets (up to 10,000 characters).
   - **Metadata:** Created timestamp, associated desk, and linked pull request numbers when available.

2. **Search and Tag Filtering:**
   - Filter notes in real time by typing into the search bar (searches titles, contents, and authors).
   - Click any tag chip to instantly narrow down to relevant topics.

3. **Prompt & Context Integration:**
   - Relevant notes are included automatically when the office starts or prompts a coding worker.
   - **📋 Copy:** Optionally copies a note as Markdown for use outside the office. The UI remains available to inspect, correct, or delete notes, but manual maintenance is optional.

4. **Multiplayer Sync & Persistence:**
   - Live updates: When someone adds, edits, or deletes a note, every teammate on the floor sees it update immediately without reloading.
   - File persistence: Notes are stored in `.agent-office/lore/<id>.json` on the floor's disk. Notes survive server restarts, crashes, and branch switching.
   - Note IDs contain 1–128 letters, digits, underscores, or hyphens. A persisted note's ID must match its filename; unsafe IDs and mismatched files are ignored on load.
   - If disk deletion fails, the note stays on the shelf and a warning appears. Restore access to the file and retry deleting it.

## Automatic knowledge curator

Open **Knowledge curator** from the Office menu, or **Settings → Workers → Configure curator**. An admin configures it once per floor; workers then maintain the shelf without routine human edits. Automatic curation starts disabled so you can choose its schedule and model first.

- Choose an interval (5–43,200 minutes), or a daily time with an IANA timezone such as `Asia/Kolkata`.
- Select **Claude Code** or **Codex**, and an optional provider model. Only installed background adapters are offered; these settings are independent of coding-worker defaults. Install/sign in on the machine that owns the floor, then restart its host if you installed a new CLI. Use a recent CLI supporting the noninteractive flags below.
- Toggle **After worker completion** for cleanup 30 seconds after a coding worker submits its checklist. Bursts are combined and remaining queued notes are processed in bounded batches. Discovery writes enter the persistent queue; by themselves they wait for completion or a scheduled run.
- Set **Maximum notes per run** (2–50), use **Run now**, or **Pause / Resume schedule**. Run now works even when automation is disabled or paused. Pausing or changing settings cancels the current run before recommendations are applied.

The panel shows the next scheduled run, queued notes, retry time, selected agent/model on each run, results, and lifecycle states. Settings, queued note versions, schedule deadlines, the last 100 runs, and original note revisions persist in `.agent-office/lore-curator.json`. The panel shows the latest 20 runs and latest 20 original revisions per inspected note. A missed schedule produces one catch-up run when the office returns, rather than one run per missed interval. A daily time skipped by daylight saving is skipped that day; a repeated time runs once on that local date. Only one curator runs per floor. Failed runs retain pending work and retry after 5 minutes, backing off to at most an hour while enabled and unpaused.

### Cleanup and recovery

Identical discovery content is consolidated without a model call. The selected agent reviews other compatible duplicates, conflicting claims, and obsolete information. A semantic merge preserves both observations and source identities. Task handovers stay separate. Age alone is not a reason to archive a fact.

Notes become **active**, **needs-verification**, **superseded**, or **archived**. Workers receive only active notes with a task keyword match; unrelated notes no longer fill spare context slots. A changed discovery retains its earlier revision and waits for verification before being injected. Repeating an identical save does not invalidate the note. Worker reports and curator checks remain context, not proof that tests passed or instructions to execute.

The curator receives bounded committed text excerpts at the floor's current `HEAD`, excluding obvious credential paths/content. It cannot verify facts that require uncommitted changes, unavailable files, or live environment checks; uncertain/conflicting claims should remain flagged. Verification actions must cite an exact supplied file path, without line numbers or prose. Both adapters receive a per-run output schema constrained to the supplied note IDs and evidence paths; when no files are supplied, evidence must be empty and verification is rejected. Invalid recommendations fail the whole batch, leave notes queued, and identify the invalid field in run history. Notes and excerpts are untrusted data. The background CLI runs outside the checkout, without office hook tokens, office management tools, shell tools, user MCP configuration, or repository writes. Claude runs in print mode with tools disabled and strict empty MCP configuration; Codex uses ephemeral exec, read-only sandbox, ignored user config/rules, disabled shell/apps/plugins/hooks, and schema-constrained output.

A run reviews at most the configured notes and 60,000 characters of note data, plus up to eight bounded repository excerpts. Each agent invocation has a five-minute timeout and bounded output. It uses the office machine's existing agent login and is separate from desk-worker usage accounting and worker limits; batch/runtime limits do not guarantee a monetary cap. Invalid responses are rejected, and notes edited while a run is underway are skipped instead of overwritten. Periodic sweeps rotate through reviewed notes so older knowledge is revisited.

Archiving and superseding preserve the original note files. Use **History** to inspect earlier originals, **Restore original** to remove a curator overlay/archive, or **Restore this revision** to recover a prior worker-written version. No automatic cleanup permanently deletes notes. The same controls operate through host RPCs for remote floors; older hosts show an upgrade message and never cause the office to touch a remote checkout.

Browser verification: `node --import tsx scripts/e2e-lore-curator.mjs` uses fixture agents, saves a daily schedule and model, runs cleanup, checks duplicate/archive recovery and pause/resume, and captures [settings](lore-shelf-evidence/curator-settings.png) and [run history](lore-shelf-evidence/curator-history.png).
