---
summary: "The main checkout is shared and rarely clean: branch in a worktree, never commit others' changes there, and target pull requests at the project's real remote."
title: "Shared checkout, worktrees and pull request targets"
author: "curator"
updated: "2026-10-13"
status: "needs-verification"
---
The repository checkout at `/home/tradeai/agent-office/vishal2942/agent-office-sd` is shared with other live sessions and board agents. It is rarely clean: expect an unrelated modified `.gitignore` and an untracked `.agent-office/` directory. Never stash, reset, commit or clean those.

Do feature work in a git worktree on a branch cut from freshly fetched `origin/main`:

```
git fetch origin
git worktree add ../wt-<slug> -b feat/<slug> origin/main
```

Agents hired by the office already get their own worktree under `.agent-office/worktrees/<name>-<slug>`; a shell session or a plain agent launch in the shared checkout does not. Check `git worktree list` before assuming which checkout you are in.

Remotes in this checkout are deliberately three: `origin` = `sagardhande2942/agent-office-sd` (the project's real remote, and the base every pull request targets), `upstream` = the same URL over SSH, `fork` = `vishal2942/agent-office-sd` (your own fork). Open pull requests with

```
gh pr create --repo sagardhande2942/agent-office-sd --base main
```

and, from a fork, add `--head <your-github-user>:<branch>`; never rely on the GitHub CLI's fork-parent default, which picks the wrong repository.