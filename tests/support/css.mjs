// Client modules import their own stylesheets, which Vite bundles in the browser. Under node a
// stylesheet has nothing to give, so a test importing such a module gets an empty one instead of
// "Unknown file extension .css". The same goes for a model's .glb, which a module imports for its URL.
//
// npm test loads it as #tests/css (package.json "imports"), not by a relative path: processes the
// tests start with node's own flags, like the PTY host (src/server/ptys.ts), run from another folder,
// where ./tests/support/css.mjs isn't there and they would fail to start.
import * as module from 'node:module';
import { load } from './css-loader.mjs';

// Node 22.15+/24 can load assets synchronously, avoiding asynchronous asset-hook
// registration/dispatch. Keep the asynchronous hook for supported Node 20 builds.
if (module.registerHooks) module.registerHooks({ load });
else module.register('./css-loader.mjs', import.meta.url);
