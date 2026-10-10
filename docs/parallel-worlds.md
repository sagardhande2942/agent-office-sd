# Parallel worlds

Back to the [README](../README.md).

Open **🌀 Parallel worlds** from Tab or the command palette. On the Office map, three glowing holographic doors stand in the south aisle; approach one and press **E** to open its world. The doors are permeable and work in both 3D and 2D Game. Other maps expose the same experiment through the menu. Lite does not include the experiment interface.

## Create an experiment

Enter one shared task and edit the three names and approach briefs (Minimal, Visual and Experimental by default). Choose an installed agent, model and effort using the usual provider controls, then select **Split into three worlds**.

The office fetches the floor's base using its existing worker rules, resolves it once and pins all three variants to that commit. Each agent gets a separate desk, branch and Git worktree plus the shared task and its own approach. Local-only repositories use the current committed HEAD; uncommitted changes in the floor checkout are excluded. Three free desks and capacity for three workers are required, and existing budget and sign-in restrictions apply. Each launch is saved independently: a failed variant shows its error while successful variants keep running.

Experiments require a Git floor hosted on the office machine. Remote floor hosts are not supported by this feature. The agent prompt asks workers to verify, commit, start a preview on a free port and wait for the human's choice before opening a PR. This prompt is guidance, not an enforced restriction on an agent's tools.

## Explore and compare

**Enter world** opens a preview room with the approach, branch, worker status and terminal button. Web previews use servers discovered by the existing Services feature; select the server if a worker has several. **Compare previews side by side** puts all three screens together. Servers must use distinct ports; discovery normally takes a few seconds. Reopen a room after its preview starts to load it. Non-web projects can be inspected through their terminals.

When the office runs remotely, run `agent-office tunnel <office-url>` on your own computer, or use **Services / tunnels** for the existing SSH/Tailscale instructions. Preview screens use those existing service URLs, not a new deployment or proxy. **Open full screen** opens a separate tab if embedding is blocked by the app or browser. Sandboxed previews cannot navigate the office page and have no camera, microphone or geolocation access. An iframe that has keyboard focus may consume Escape; the office's top-right **✕** remains available.

**Send feedback** delivers a prompt only to that world's worker using the existing worker queue/resume behavior. Feedback to a selected world clears the selection, requiring a fresh choice after the next revision. Read replies, check output and review changes in the existing terminal and Changes controls; a worker's done status alone is not verification that its result is correct.

## Select, publish and preserve

**Select winner** records your choice once its worker is idle or done and its worktree is available. **Open PR** then uses the existing forge sign-in, branch push and PR flow. Only committed changes appear in the PR; the office warns about uncommitted work. Selection never merges anything and never stops or deletes the other variants. Combining variants is future work and currently requires a separate integration task.

**Archive experiment** preserves all workers, previews and branches and makes room for another experiment. Use the usual Send home controls when you want to stop workers or clean their worktrees. One unarchived experiment is allowed per floor, with up to 30 saved experiments. Archived rooms remain inspectable; missing workers are shown as unavailable with their last recorded branches.

History lives in the floor's `.agent-office/parallel-worlds.json` and is restored after restart. The experiment creator or an admin may change it; signed-in teammates can inspect it under the office's existing shared floor permissions. Closing a preview room or comparison with **✕** or Escape also dismisses its experiment window and returns directly to office controls and mouse-look. Opening the agent terminal or Services dismisses the experiment first, so no hidden window prevents returning to the office afterward.
