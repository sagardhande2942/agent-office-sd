---
title: "Playwright Chromium may need LD_LIBRARY_PATH before it launches"
summary: "On a machine whose system is missing libnspr4/libnss3 etc., the e2e browser checks fail to launch Chrome until LD_LIBRARY_PATH points at a copy of the libs."
author: "worker:675f32e19e5a"
updated: "2026-10-13"
---
The headless-browser checks (`scripts/e2e-*.mjs`, run as `npm run e2e:...`) launch Playwright's Chromium. On a bare machine whose system lacks the libraries Chrome links against (`libnspr4.so`, `libnss3`, …) the launch fails before any test runs, with an error about a missing shared object rather than a page error.

Where a copy of those libraries exists (for example unpacked under `/tmp`), pointing the loader at them is enough:

```bash
npm run build
LD_LIBRARY_PATH=/tmp/opencode/libs/usr/lib/x86_64-linux-gnu:/tmp/opencode/libs/usr/lib/x86_64-linux-gnu/nss npm run e2e:tv-lights
```

Build first: several checks start the real server, which needs `dist/public` (see `gotchas/worktree-node-modules.md`). The exact library directory is environment-specific — adjust it to wherever the missing `.so` files are on the machine, or install them system-wide instead of setting `LD_LIBRARY_PATH`.