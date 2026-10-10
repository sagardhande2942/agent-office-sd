# Shift Handover & Lore Shelf

Back to the [README](../README.md).

The **Lore Shelf** is a shared knowledge and shift handover repository for each floor in Agent Office. It stores institutional knowledge, debugging discoveries, environment gotchas, architecture quirks, and handover notes written by agents and humans.

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
   - **📋 Copy:** Formats the note into prompt-friendly Markdown (`[Project Lore] <Title>: <Content>`) and copies it to your clipboard.
   - Attach lore directly into worker prompts to equip fresh workers with critical project knowledge before they start.

4. **Multiplayer Sync & Persistence:**
   - Live updates: When someone adds, edits, or deletes a note, every teammate on the floor sees it update immediately without reloading.
   - File persistence: Notes are stored in `.agent-office/lore/<id>.json` on the floor's disk. Notes survive server restarts, crashes, and branch switching.
