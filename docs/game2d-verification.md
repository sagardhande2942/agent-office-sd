# 2D Game verification

The production bundle was checked against an isolated office with two temporary Git floors, real shell workers and headless Chromium. The harness is `scripts/e2e-game2d.mjs`; it never connects to the live office. Provider-producing hiring, helper and Manager requests are captured before launch. Queue operations and terminal input use the real server.

```sh
npm run typecheck
npm test -- --test-concurrency=1
npm run build
node --import tsx scripts/e2e-game2d.mjs
```

Typecheck and build passed. The full suite passed **977 tests**, including the size and client structure guards. The browser harness passed **15 check groups** with no page errors:

- Protected `/2d`, `/2d.html` and `/game2d.html`, login return path and a non-default floor.
- Keyboard movement, click-to-walk and desk collisions.
- Real shell terminal input; click and nearby E attach the same worker.
- All five destination dialogs from toolbar and map; top-right ✕ and Esc restore controls immediately.
- Worker prompt, helper, send-home and hiring dialogs, plus existing request contracts.
- Three nested board/issue/confirmation dialogs and real paused-queue add/remove operations.
- Same-floor multiplayer movement and removal on floor change/disconnect.
- Worker working, needs input, done and offline fixtures at two desktop viewport sizes.
- 3D mouse-look recovery after closing a shared dialog.
- 2D → Lite → 3D → 2D retains floor and worker/session IDs without spawn/resume requests; 3D receives 2D movement.
- Reconnect sends one terminal reattach; repeated switches leave one positioned peer.
- Unsupported-map input guard retains the selected floor.

Detailed machine-readable results are in [checks.json](game2d-evidence/checks.json).

The live office's local-server discovery initially hit the TUI test fixture at `/`, causing its login-only assertion to fail. The fixture now returns 404 for that unrelated probe while preserving its login assertions; the subsequent full suite passed.

## Office, 1440 × 900

![Office map with workers and live statuses](game2d-evidence/office-1440.png)

## Office, 1120 × 760

![Smaller desktop view](game2d-evidence/office-1120.png)

## Shared dialogs

![Existing worker terminal in 2D](game2d-evidence/terminal.png)

![Existing plan comparison dialog in 2D](game2d-evidence/plans.png)
