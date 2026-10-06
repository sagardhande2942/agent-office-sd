# agent-office

- Ship every code change as a PR branched from freshly fetched `origin/main`, and end with the PR URL instead of stopping at a local commit or asking first.
- The main checkout is shared with other live sessions and board agents, so do branch work in a worktree and never stash, reset or commit anyone else's changes there.
- Verify with `npm run typecheck`, `npm test` and `npm run build`, plus a headless-browser screenshot for visual changes, rather than slow manual playthroughs.
- When a change affects how people run, deploy or use the office, update `README.md` and the matching `docs/*.md` page in the same PR.
- Every modal needs a top-right ✕, and closing it by ✕ or Esc must put the player straight back into mouse-look with no extra click.
- When asked to merge PRs, merge only webdevcody's (anyone else's only when linked, after a security review), resolve conflicts so both sides survive, and squash-merge.

## Pull request destination (required)

- This checkout belongs to `sagardhande2942/agent-office-sd`. All routine pull requests, issue writes, comments, reviews and merges must target that repository.
- Never create a pull request in `AgentSystemLabs/agent-office`, or any other upstream repository, unless the user explicitly requests that exact destination in the current task. Instructions to "create a PR", "ship", "push" or "update the PR" do not authorize an upstream PR.
- Always specify the repository when using GitHub CLI commands that support it. Create PRs with `gh pr create --repo sagardhande2942/agent-office-sd --base main --head <branch> ...`. View/edit/comment/review/merge PRs with `--repo sagardhande2942/agent-office-sd` too; PR numbers are not unique across repositories.
- For `gh api`, use explicit `repos/sagardhande2942/agent-office-sd/...` paths for writes. Do not rely on inferred `{owner}/{repo}` placeholders, fork ancestry, a bare PR number or GitHub CLI's automatic repository selection.
- Before pushing or creating a PR, verify `git remote get-url --push origin` points to `sagardhande2942/agent-office-sd`, and verify the explicit PR destination. If they differ, stop the publication step and ask the user to resolve the destination; do not silently select upstream or change remotes.
- Set or verify the local GitHub CLI default with `gh repo set-default sagardhande2942/agent-office-sd` and `gh repo set-default --view`. This is a convenience; explicit `--repo` remains mandatory.
- Verify the returned PR URL starts with `https://github.com/sagardhande2942/agent-office-sd/pull/`. Do not deliberately create an upstream PR and close it afterward: closing does not remove exposed code or retained commit references.
- Workers and delegated agents must receive and follow the same destination restriction. A reference to an upstream issue or PR is not permission to publish changes there.
