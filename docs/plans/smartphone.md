# Smartphone integration

Adapted from AgentSystemLabs/agent-office PR299, on top of the upstream integration.

- J and the HUD menu open contacts, including helpers and their host names.
- Calls navigate to the worker (or helper host) and open the selected session’s terminal.
- Messages use worker.prompt. Busy sessions may queue them; status is not delivery confirmation.
- Needs-input sessions, shells, unavailable sessions and lost worktrees cannot receive phone messages.
- A helper report action opens the host terminal's existing review/delivery controls.
- Threads are bounded, in memory only, and floor/worker scoped. Recents can clear messages.
- Closing or cancelling drops ringback, timers, dictation and store subscriptions.

No server protocol changes, voice calls, automatic interruptions or report delivery are introduced.
