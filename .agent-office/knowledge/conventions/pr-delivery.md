---
title: "Deliver changes safely through the project PR workflow"
summary: "Use a fresh origin/main worktree, preserve shared changes, verify the destination and publish a PR to sagardhande2942/agent-office-sd."
tags: ["git","pr","workflow"]
pinned: true
paths: ["AGENTS.md"]
sources: ["AGENTS.md"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Project delivery rules

The main checkout is shared with live sessions and board agents. Do branch work in a separate worktree; never stash, reset or commit another session's changes in the shared checkout.

From the project checkout, inspect the remote before fetching:

```sh
git remote -v
git fetch origin main
git worktree add -b <feature-branch> <new-worktree-path> origin/main
```

Run changes and checks inside the new worktree. The required checks are `npm run typecheck`, `npm test` and `npm run build`. Visual changes also need a headless-browser screenshot. Record actual results, and update `README.md` plus the matching `docs/*.md` page when changing how people run, deploy or use the office.

Before publishing, verify the push remote again. With push access to the project:

```sh
git remote get-url --push origin
git push -u origin <feature-branch>
gh pr create --repo sagardhande2942/agent-office-sd --base main --head <feature-branch> --title '<title>' --body-file <description-file>
```

Without project push access, push to your own verified fork remote and explicitly use `--head <your-github-user>:<feature-branch>` with the same `--repo` and `--base`. Never rely on forge fork-parent defaults. Finish delivery with the PR URL; a local commit alone does not complete delivery.

When asked to merge, the project allows webdevcody's PRs, or other authors' explicitly linked PRs after security review. Preserve both sides when resolving conflicts and squash-merge. This rule is not authorization to merge an unrequested PR.
