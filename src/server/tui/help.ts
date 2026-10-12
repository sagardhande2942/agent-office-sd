export const TUI_HELP = `Usage: agent-office tui [--office http://localhost:4600] [--name NAME] [--floor ID]

Start the server in terminal 1:
  agent-office /path/to/project --no-open
Join that server in terminal 2:
  agent-office tui
Use the password printed by the server, or your account password with --name.
AGENT_OFFICE_PASSWORD skips the hidden password prompt.

From a source checkout, build first: npm ci && npm run build
Use node bin/agent-office.js in place of agent-office in BOTH terminals.
The TUI joins a running server; it does not start one. Use the same build for both.

Dashboard: arrows select desks, Enter opens a worker, Tab changes panels.
Press : ONCE, type a command, then Enter. These are not shell commands.
Examples: hire codex Fix the failing tests | attach <worker-id> | help
Ctrl+] leaves a worker terminal. q exits the dashboard, leaving workers running.
While attached, mouse wheel or Page Up/Page Down scrolls history.

Commands:
  workers / floors / go <floor ID or name>
  hire <provider> [prompt] / attach <worker ID or name>
  prompt <worker> <text> / resume <worker> / pr <worker>
  home <worker> [--cleanup auto|keep|worktree|all]
  messages [request-id] / issues / pulls / queue / enqueue <prompt> / chat <text>
  teams / team-start <JSON-file> / team-pause / team-resume / team-stop
  team-preset <JSON-file> / team-preset-delete <ID>
  plans / plan-start <JSON-file> / plan-stop / plan-retry
  help / quit

JSON files are read on the TUI machine. Paths with spaces may be quoted.
Requires an interactive terminal. Feature commands depend on your installed build.`;
export const TUI_HELP_LINES = [
  'QUICK START: this terminal is the dashboard; the server runs separately.',
  '1. Press : once to open the command prompt.',
  '2. Type hire codex Fix the failing tests, then Enter.',
  '3. Select the worker with arrows; Enter opens its terminal.',
  '4. Ctrl+] returns here. q leaves the dashboard; work continues.',
  '',
  'Arrow keys: select desks or scroll this help and other boards',
  'Enter: attach / hire at empty desk / switch selected floor',
  'Tab / Shift+Tab: next / previous panel',
  'h: hire   p: prompt   r: resume   x: send home (choose cleanup)',
  'f: floors   n: next worker needing attention',
  'i: issues   b: PRs   t: queue   m: worker messages',
  'c: chat   ?: help   Esc: cancel / return to desks',
  'Attached: wheel / Page Up / Page Down scroll; Ctrl+] detaches',
  '',
  'COMMANDS (press : first; run node/npm/agent-office in your shell):',
  'workers | floors | go <floor ID or name>',
  'hire <provider> [prompt] | attach <worker ID or name>',
  'prompt <worker> <text> | resume <worker> | pr <worker>',
  'home <worker> [--cleanup auto|keep|worktree|all]',
  'issues | pulls | queue | enqueue <text> | messages [request-id]',
  'chat <text> | help | quit',
  '',
  'MASTER / WORKERS:',
  'teams | team-start <JSON-file> | team-pause | team-resume | team-stop',
  'team-preset <JSON-file> | team-preset-delete <ID>',
  '',
  'PLAN COMPARISON:',
  'plans | plan-start <JSON-file> | plan-stop | plan-retry',
  '',
  'JSON paths refer to this machine, even when the office is remote.',
  'Quote paths with spaces; ~ expands to your home directory.',
  'Feature commands depend on the server and TUI build you run.',
];
