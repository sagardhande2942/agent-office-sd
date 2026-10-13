---
summary: "How to read, write, move and finish reviewing notes on the floor knowledge shelf under .agent-office/knowledge."
title: "The knowledge shelf: tools, versioning and house rules"
author: "curator"
updated: "2026-10-13"
status: "needs-verification"
tags: []
---
The floor knowledge shelf lives in `.agent-office/knowledge/` in the repository and is edited through the knowledge tools, not by hand:

- `knowledge_index` lists a directory, `knowledge_search` finds a fact, `knowledge_read` returns a note plus the `version` hash to pass back.
- `knowledge_write` creates or updates a note; pass the version from `knowledge_read` as `expectedVersion` (or `null` to create). Only `title` and `summary` are yours in the frontmatter; author, updated date and status are set by the server.
- `knowledge_move` renames, `knowledge_archive` retires, `knowledge_review_done` ends a review with the paths you changed (or a `none_reason`).
- Local shift handovers are separate and stay uncommitted: `.agent-office/handovers`.

House rules: one topic per file, split files past about 200 lines and directories past about 40 entries, write for a stranger, include commands verbatim, never paste secrets. `.gitignore` keeps `/.agent-office/knowledge/**` tracked while ignoring journals, telemetry and handovers.