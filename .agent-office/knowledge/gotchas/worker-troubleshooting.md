---
title: "Diagnose a blocked worker without discarding its work"
summary: "Separate terminal input, stale status hooks, missing CLI, completion review and queue verification before restarting or cleaning up."
tags: ["workers","debugging","recovery"]
paths: []
sources: ["docs/controls.md","docs/agents.md","docs/completion-checklist.md","docs/knowledge.md","docs/communications.md","docs/configuration.md"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Start with evidence from the correct floor

Capture the worker, floor, provider, task, branch/worktree, terminal's last error and current checklist. Redact credentials. An animated status or an idle terminal is a clue; neither proves the task finished or that the process is hung.

| Symptom | Check next | Safe response |
| --- | --- | --- |
| Needs input or an approval question | Open that worker/helper terminal | Answer the actual question or permission request; do not send a second task to dismiss it |
| UI says working but terminal is waiting | Provider hooks and terminal prompt | Inspect terminal; some providers cannot report every permission event |
| CLI not found | PATH and CLI installation on the machine executing the worker | Fix the owning machine's environment and restart/resume as documented |
| Hooks still behave like an older version | Worker launch/resume configuration | Update office/host as needed and launch/resume to load new hooks; existing processes may retain old configuration |
| Completion rejected for knowledge review | Current completion revision and knowledge review | Inspect diff, update notes or record none_reason, call knowledge_review_done, then resubmit |
| Checklist ready but task unverified | Actual commit, PR, tests and queue verdict | Treat checklist as worker-reported evidence; investigate verification instead of declaring success |
| Waiting for a colleague/helper | office-workers inbox --json | Read and acknowledge the correct message; acknowledgment is not proof its advice was implemented |
| Worktree missing | Saved branch, remote commits and retained directory | Inspect recovery context before creating replacement work or deleting the worker |

## Esc has two meanings

Esc closes the office terminal window and restores office controls. Ctrl+[ or the terminal header's Esc action sends Esc to the CLI, for an internal menu or interruption. If a provider menu is still open after closing the window, the office close action was not a CLI interrupt.

R resumes a sleeping worker (or restarts a shell). Provider adapters resume their recorded session; do not substitute a global “most recent conversation” command and risk selecting another worker's conversation.

Before sending home or pruning, inspect uncommitted changes, branch and pushed commits. Start cleanup diagnosis with agent-office prune <project-dir> --dry-run. Do not force cleanup to make a status card disappear.

Helpers provide findings; their report must be handled through inbox acknowledgment or manual delivery. Read docs/communications.md for the current helper lifecycle rather than assuming a report printed in a terminal was acted on.
