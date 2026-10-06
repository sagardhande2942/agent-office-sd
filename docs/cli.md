# Terminal office

The CLI is a third view of the same office, alongside 3D and `/lite`. Run the server first, then join it in another terminal:

```sh
agent-office --no-open
# In another terminal:
agent-office tui
```

Enter the office password at the hidden prompt. If `AGENT_OFFICE_PASSWORD` is set, the client uses it instead. Passwords and session cookies are never saved by the client. With an individual account, use `agent-office tui --name ada` and enter that account's password.

For a remote office use `agent-office tui --office https://office.example.com`. An existing SSH tunnel works with the default `http://localhost:4600`. TLS certificates must be trusted by Node; self-signed offices need their certificate installed as a trusted CA (for example through `NODE_EXTRA_CA_CERTS`).

At `office>`:

| Command | Action |
| --- | --- |
| `floors`, `go <id or name>` | List and switch project floors |
| `workers` | List IDs, names, statuses and current activity |
| `hire codex <prompt>` | Hire at an empty desk on the current floor |
| `attach <worker>` | Open the shared live terminal; Ctrl+] returns to the office |
| `prompt <worker> <text>` | Send the worker a prompt |
| `resume <worker>` | Resume a stopped worker |
| `pr <worker>` | Ask the office to push and open the worker's PR |
| `issues`, `pulls`, `queue` | Read the current boards and queue |
| `enqueue <text>` | Add a task to the existing queue |
| `chat <text>` | Send chat to teammates |
| `help`, `quit` | Show help or leave the client |

Worker commands accept an exact ID or a single-word name. Use IDs for names with spaces or duplicate names. The hire providers are `claude`, `codex`, `opencode`, `grok`, `muse`, `dsh` and `custom`. Hiring uses the floor's shared checkout; queue tasks follow the office's existing queue rules.

Terminal input, including Ctrl+C, goes to the attached worker. Ctrl+] detaches. Resizing your terminal resizes the shared worker terminal for all viewers. Outside attachment, Ctrl+C exits the client. Exiting leaves the server and workers running. If disconnected, rerun the command to sign in again.

This first CLI view requires an interactive terminal and an existing project floor. Add floors using the browser office. Voice, whiteboards, spatial activities and account administration remain in the existing interfaces.
