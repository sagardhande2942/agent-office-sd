---
title: "Preserve modal focus and shared client boundaries"
summary: "Use the existing modal lifecycle for close/Esc, preserve Lite import boundaries, and register gameplay once for both 3D and 2D."
tags: ["ui","modal","architecture"]
sources: ["AGENTS.md","docs/code-layout.md","src/client/input/focus.ts"]
paths: ["src/client/input/focus.ts"]
status: "active"
verified_at: "3679129"
author: "agent:codex"
updated: "2026-10-14"
---
# Modal behavior is part of the feature

Every modal needs a top-right ✕. Closing with ✕ or Esc must return the player to mouse-look without an extra click. Use the existing modal registration and close path; hiding an element alone can leave movement, key state or pointer lock inconsistent.

src/client/input/focus.ts listens for modal changes. Opening clears player keys, updates movement blocking, notifies windowOpened hooks, releases the mouse and stops walking where appropriate. Closing schedules backToGame after a tick, so replacing one modal with another does not grab the mouse between them.

Preserve the last-window check: closing a child while another window is open must not enable game controls. backToGame focuses the canvas unless typing, checks pointer-lock capability and requests mouse recovery. Browser restrictions can use the existing next-key fallback. Do not implement a second document-wide pointer-lock listener in a feature to bypass this lifecycle.

Verify both close paths and a window-to-window transition in a headless browser. Capture a screenshot for visual changes, but also check focus/control behavior: an image cannot prove Esc restored controls.

# Three clients, two import boundaries

3D and /2d share the complete office composition. game2d.ts loads main.ts; features/topdown registers view and input adaptation through existing registries. Add common gameplay once in its own feature. Do not copy mechanics into game2d.ts or branch generic store behavior by rendering mode.

/lite is a separate dashboard with no three.js. Shared hiring, prompt tools and other reusable UI belong under src/client/shared/ when Lite needs them. A convenient import from features/, core/, input/, world/ or player/ can pull the 3D graph into Lite; use a shared interface/module instead.

Example: an optional editor beside a task prompt registers in ui/prompt-tools.ts and exposes a valid() guard. Keep its reusable code in shared/ so both Lite and game dialogs validate unfinished drafts consistently.

Relevant coverage: tests/client-structure.test.ts, tests/client-registry.test.ts and tests/size.test.ts. Use scripts/e2e-game2d.mjs for shared 2D/3D behavior changes and a feature's browser harness for its modal.
