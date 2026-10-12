# Trading Research

The Trading Research module gives a project floor campaigns, research assignments,
measured experiments and independent reviews. A separate `office-research` process
owns execution and its durable journal. Office supplies the workers and controls;
Discovery supplies its existing deterministic evaluator. Discovery source and its
installed strategy files are unchanged.

## Start the coordinator

Build Office once with `npm run build`. From the Office installation, start a second
terminal. On Windows, point at a Python environment with Tradeai's dependencies:

```powershell
npm run research -- --tradeai "C:\vishal_workspace\Tradeai" --python "C:\vishal_workspace\Tradeai\trade_env\Scripts\python.exe" --data "C:\vishal_workspace\TradeaiResearch"
```

On Linux / WSL, use Linux paths and Tradeai's Linux environment:

```bash
npm run research -- --tradeai /mnt/c/vishal_workspace/Tradeai --python /mnt/c/vishal_workspace/Tradeai/venv/bin/python --data "$HOME/.agent-office/tradeai-research"
```

The installed command is `office-research` with the same arguments. Defaults are
port 4601 and two concurrent evaluations. `--concurrency` accepts 1–8. The coordinator
listens only on loopback and prints the location of `coordinator.token`, not its value.
Use the environment that actually contains your Tradeai dependencies; the paths above
are examples. Office and the coordinator must run in the same host/network environment.

## Connect a floor

1. Open/add the Tradeai checkout as an ordinary Office floor and travel there.
2. Open **☰ → Trading Research** in the 3D or 2D game.
3. Enable the module, enter the coordinator's loopback URL, and paste the contents of
   its token file. Click **Save connection**. A blank token preserves the saved one.
4. Enter an objective, development dates, dataset version, symbols and limits; click
   **Create campaign**.
5. Hire ordinary coding workers using Office's existing hire controls. For a queued
   researcher assignment, choose a ready worker and click **Assign worker**. The worker
   keeps the provider/model already configured on its session.
6. The worker submits strategy code/config using its authenticated research tools.
   Evaluation starts automatically. Completed execution creates a queued reviewer
   assignment; assign a different worker to inspect it.

Admins configure connections and control campaigns. Other signed-in floor members can
read the board. Connection tokens and worker assignment leases never reach browser
snapshots. Remote floors use the host-call registry: the coordinator and connection
file live on the floor host, and remote worker tools use that host's hook listener.
Both Office and the host need this version. Each floor receives its own persistent
coordinator scope, including floors sharing one coordinator.

The module is disabled by default on every floor. Opening the panel does not enable it.
The initial release is available in the 3D and 2D game; Lite retains its existing UI.

## Worker tools and submissions

Workers receive an assignment prompt and use:

```bash
office-workers research task --json
office-workers research submit < result.json
```

In PowerShell, submit with `Get-Content .\result.json -Raw | office-workers research submit`.

Equivalent MCP tools are `research_task` and `submit_research`. The task packet includes
the brief, assignment ID and current lease. A review packet also includes strategy code,
configuration and measured results. These values are data; previous worker text does
not override the user's instructions.

Researcher `result.json`:

```json
{
  "assignment": "ID from research task",
  "lease": "lease from research task",
  "hypothesis": "What is being tested and what would disprove it",
  "code": "Complete Python source defining Strategy with __init__ and trade",
  "config": "A JSON string containing config, alphas, exit_alphas and RMS"
}
```

Use Tradeai's `MockStrategyBase`, strategy references and existing JSON configuration
format. Work on artifacts in your own workspace, rather than editing Discovery or
installing into its shared strategy directories. Each submission is immutable and
receives a code/config hash. The coordinator validates JSON configuration; Discovery's
existing AST validator checks Python before execution.

Reviewer `result.json`:

```json
{
  "assignment": "review assignment ID",
  "lease": "current lease",
  "summary": "Assessment linked to measured evidence and implementation",
  "decision": "reject"
}
```

Decisions are `reject`, `revise`, or `retain`. A researcher cannot review its own
experiment. Retain means reviewed research, not deployment approval. **Submit manually**
accepts a hypothesis, code and JSON config for an unassigned researcher task.

Paid AI APIs are disabled in this release. Worker coding-agent access and allowances
are still required. Exhausted workers keep their drafts; an admin can release an
assignment and assign another worker. Releasing invalidates its old lease. There is
no automatic API fallback.

## Evaluation and OrcaTrex

The adapter loads validated code into the evaluator subprocess's import table and
uses a temporary config. It invokes the unchanged `discovery.evaluate_strategy`
quick filter and, when selected, development walk-forward. It never invokes the
generation manager, embeddings, concept judge, AI refinement or parameter generation.
The evaluator records engine/config/source/data evidence, supplemented by actual CSV
fingerprints. A supplied dataset label is provenance context, not a verified hash.

To execute on OrcaTrex, add:

```bash
--orcatrex http://localhost:9001 --remote-python python3 --remote-directory git
```

Slaves need an existing Tradeai checkout, dependencies and the requested dataset.
The job packages the adapter, strategy and config, so it needs no shared artifact
directory. Dataset differences are visible in result evidence. The remote Python
executable must be usable inside OrcaTrex's selected execution directory.

Experiment IDs form stable OrcaTrex batch IDs. A lost submission response is ambiguous:
the coordinator reconciles that batch and never blindly submits it again. Keep
OrcaTrex's authenticated/private deployment controls in place; this adapter uses its
existing job API and does not expose a new public listener.

## Limits, recovery and evidence

- **Pause scheduling** stops new assignments/evaluations. Active jobs continue.
- Hypothesis and experiment counts are bounded by campaign limits; execution has a
  timeout. Local infrastructure retries are explicit and limited to two attempts.
- **Request cancellation** waits for local process exit or a remote terminal status;
  a request alone does not prove a remote job stopped.
- After a coordinator restart, local running jobs become interrupted. Retry requires
  the recorded evaluator process to have stopped. Remote jobs reconcile by batch/job ID.
- Reconnects read current state. Repeated create/submission requests do not duplicate
  experiments. Worker results require the current authenticated session and assignment
  lease. The journal is owned by one coordinator process.
- Strategy/config files, manifests, execution logs and complete results live under
  the coordinator data directory's `experiments/<id>/`. Back up the journal and artifacts
  together. The floor stores only its connection in `.agent-office/research.json`.

Execution status and research outcome are separate. A completed test can disprove a
hypothesis or contain invalid-data evidence. Every result remains `RESEARCH`; final
holdout, promotion gates, paper trading and live trading are outside this release.

Strategy evaluation is a subprocess with the existing AST checks, not a security
sandbox for arbitrary external code. Use trusted workers and an evaluation environment
without live broker credentials. Local stdout/stderr has an 8 MB limit, and Office
coordinator responses have a 4 MB limit; oversized runs fail visibly rather than
silently dropping evidence.

## Verify

```bash
npm run typecheck
npm test
npm run build
node --import tsx scripts/e2e-trading-research.mjs
```

An optional read-only proof against the existing Tradeai installation uses synthetic
data in a temporary directory and fails on network access or AI-provider imports:

```bash
/path/to/tradeai/python scripts/prove-discovery-adapter.py --tradeai /path/to/Tradeai
```

The first release connects one researcher, evaluation and an independent reviewer.
Additional hypotheses/revisions are added explicitly with **Add research task**.
Automatic research-lead decisions, Advisor retrieval and knowledge consolidation are
the next layer; this release does not pretend to automate them.

Browser validation uses synthetic results and exercises worker submissions, both
evaluation phases, shared state, mobile layout and mouse-look restoration. Captured
[desktop](trading-research-evidence/experiments-desktop.png) and
[mobile](trading-research-evidence/experiments-mobile.png) screenshots and
[check results](trading-research-evidence/checks.json) are included.
