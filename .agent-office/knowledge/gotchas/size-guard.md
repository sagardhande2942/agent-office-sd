---
title: "The 600-line file size guard and its CEILINGS list"
summary: "tests/size.test.ts caps every src/.ts and .css file at 600 lines, with a CEILINGS list that may only shrink; split files instead of raising ceilings."
author: "human:inferno"
updated: "2026-10-13"
status: "active"
tags: []
---
`tests/size.test.ts` fails if any `.ts` or `.css` file tracked under `src/` is longer than 600 lines. It lists files with `git ls-files` instead of walking the folder, so a worktree checked out inside the repository does not trip it.

Older files that were already too long are listed in `CEILINGS` in that test with the length they had when the guard arrived. They may shrink, but must never grow; once one drops to 600 lines or fewer (or is deleted), the test fails until it is removed from the list, so the list only ever gets shorter. When you shrink a listed file, lower its ceiling in the same change.

The fix is to split the file along the registries (feature code into `src/client/features/<name>/`, a message handler into its domain's handler file, a tick or key into the feature it belongs to, remembered state into its own `state/slices/` module). Raising a ceiling or adding a new entry only passes the problem on.