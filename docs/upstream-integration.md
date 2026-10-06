# Upstream integration

This release brings upstream AgentSystemLabs/agent-office through `7f7211ea10` into the fork.

Added upstream features include the space-station map and airlock, drifting workers, Pi and Cursor agents, model and effort catalogues, automatic worker PR detection and `office-workers pr` / MCP `link_pr`, needs-input navigation and alarms, dictation, terminal web tabs, automatic service tunnels, TURN support, real-time skies and lamplight, first-person bodies and hands, dog breeds and coats, expanded meetings, immediate issue claiming, clone progress/cancellation/restart, and Coolify deployment support. The client, protocol and server now use upstream's feature registries.

The fork keeps hosted floors, Bitbucket sign-ins and repositories, helper agents with their own carried terminal laptops, pending helper reports with explicit interruption/delivery, helper cleanup when the host goes home, shared TV URLs and theatre controls, the fridge, energy and stress, Fugdi, the movable jukebox and Night City. Original and futuristic interiors remain choices under Settings → Theme. Musical chairs remain removed.

Run with Node 22 or newer: `npm install`, `npm run build`, then `npm start -- /path/to/project`. On WSL, run these commands inside WSL so the terminal dependencies match Linux. Use a separate port and project directory for a test office.

Validation includes the full test suite, both TypeScript builds, production bundling, and browser screenshots of the office and carried helper laptop. These checks do not authenticate live Pi/Cursor accounts or exercise deployed TURN/Coolify credentials; those depend on the operator's configuration.
