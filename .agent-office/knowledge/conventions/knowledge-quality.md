---
title: "Keep knowledge focused, sourced and honest about verification"
summary: "Write reusable facts with applicability, evidence, failure cases and verification; maintain indexes and lifecycle instead of accumulating speculative notes."
tags: ["knowledge","documentation","review"]
paths: [".agent-office/knowledge/**"]
sources: ["docs/knowledge.md","docs/knowledge-architecture.md","src/server/knowledge/store.ts","src/shared/knowledge-index.ts"]
status: "needs-verification"
verified_at: "3679129"
author: "curator"
updated: "2026-10-19"
---
# Durable knowledge earns its place

Add a note when it answers a repeated question, records a non-obvious invariant, explains a real failure, or saves future investigation. Prefer updating an existing topic over another overlapping overview. Put unresolved questions in _open-questions.md; do not turn assumptions or a worker's journal into verified facts.

A useful note contains:

- The concrete rule or outcome, stated first.
- When it applies, including local versus hosted ownership and version/environment limits where material.
- Exact repository paths and commands, with placeholders identified.
- Sources and the distinction between inspected implementation, observed execution and unverified provider behavior.
- One realistic failure example, recovery action or reason the rule exists.
- A verification path when someone changes the behavior.

One topic per file. Split around 200 lines or directories around 40 entries. Write title and summary so a worker can choose the note from bootstrap without reading its whole body. Tags and paths help task hints; pin only broadly useful guidance to avoid exhausting the bounded bootstrap budget.

## Safe updates

Use knowledge_read and retain version; knowledge_write/move/archive require expectedVersion. Use null for a new note. Identities/dates are server-owned in worker APIs. Do not write INDEX.md through worker tools: indexes regenerate from child frontmatter and preserve index prose.

Frontmatter is a constrained YAML subset: single-line scalars and inline string arrays. Title and summary are required. Do not add nested objects, multiline YAML or lifecycle markers inside summary. Keep note bodies as free-form Markdown. Notes cannot contain credentials.

Use sources for specific repository files and known evidence. verified_at identifies the revision checked; it does not make unrelated facts verified. Mark uncertain behavior needs-verification and exclude historical/retired instructions from active guidance through archive. Human-verified active notes must not be downgraded merely because excerpts are missing or a referenced file changed; a curator downgrade needs cited contradictory evidence and a concrete contradiction.

## Keep the tree reviewable

```sh
node --import tsx src/server/cli.ts knowledge lint
node --import tsx src/server/cli.ts knowledge lint --fix
```

Fix regenerates index entries; invalid notes are reported and not rewritten. Preserve both branches' notes when resolving an index conflict, then regenerate. Review what fix changed before publishing.

Shared discoveries are immediately live but require separate Publish review for durable delivery. Curator proposals remain isolated until approved/synchronized. Handovers and local state are gitignored; Git history does not back up unpublished edits. On completion, record changed paths with knowledge_review_done or a specific none_reason for the current revision.
