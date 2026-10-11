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
