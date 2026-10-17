---
title: "Standing web displays: shared configuration and private frames"
summary: "Web displays use their own registries, central floor/map configuration, native isolated frames and an explicit cross-origin exit/fallback contract."
author: "worker:282dd964150a"
updated: "2026-10-15"
---
# Standing web displays

Implementation: `src/client/features/web-display/`, `src/server/web-display/`, `src/server/ws/handlers/web-display.ts`, `src/shared/web-display.ts` and the dedicated protocol/state slice. Registries contain only composition changes. See `docs/web-displays.md` for the plan and browser limits.

Settings → Building places the stand before asking for a URL. Placement validates scene clearance and map bounds; move/remove are available in Settings and interaction controls. Non-office maps need dynamic interaction entries in `ctx.world().interactables`: the pointer's proximity fallback reads `ctx.usables` only on the office map. Dynamic geometry belongs to the current world's group, and colliders/interactions are removed on floor/map teardown.

Only id/map/position/rotation/starting URL are shared. Central office `dataDir/web-displays/<hex floor id>.json` owns configuration for local and hosted floors, like existing object placements. It does not read hosted checkout paths or travel with a host to another office. All signed-in floor members may edit, matching decor permissions. Explicitly saved URL query strings are shared too; never save secret starting URLs.

One native iframe is created only while interacting and removed on close/travel/disconnect. Native links/forms/password fields are handled by the destination. There is no page DOM inspection, keystroke relay, credential proxy or navigation telemetry. Private toolbar navigation is not saved unless the viewer explicitly saves the shared start.

The iframe permits scripts, forms and popups (including escaping the popup sandbox), but omits same-origin and top navigation. The opaque origin protects office DOM/storage even after redirects to the office origin. Storage-dependent authentication can fail; browser/CSP/X-Frame-Options/mixed-content rules still apply. Load events cannot establish cross-origin embedding success. Keep honest guidance and an explicit new-tab fallback visible. A sign-in in a tab does not promise a sign-in in the frame.

Cross-origin key events do not reach parent modal handlers. Esc while a page field owns focus cannot close the office window. Click its always-visible top-right ✕, or enter the office exit bar to focus it and press Esc. Use the existing modal lifecycle to clear keys, suppress office input and restore canvas focus/pointer lock; do not steal page focus on a timer.

Validation commands:

```sh
npm run test:focus -- tests/web-display.test.ts tests/web-display-server.test.ts tests/client-registry.test.ts tests/client-structure.test.ts tests/size.test.ts
npm run typecheck
npm run build
node --import tsx scripts/e2e-web-display.mjs
npm test
```

The browser harness uses isolated real office floors and a controlled cross-origin form fixture plus CSP/X-Frame-Options rejection. It saves screenshots/checks to `/tmp/agent-office-web-display-evidence` (`WEB_DISPLAY_ARTIFACTS` overrides it). Use `CHROMIUM_PATH` for another installed Chromium. Browser shared libraries may need an environment-local `LD_LIBRARY_PATH` on minimal WSL installations.
