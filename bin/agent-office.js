#!/usr/bin/env node
import('../dist/server/server/cli.js').catch((err) => {
  if (err.code === 'ERR_MODULE_NOT_FOUND' && err.url === new URL('../dist/server/server/cli.js', import.meta.url).href) {
    console.error('agent-office: compiled CLI is missing. From this checkout, run npm ci && npm run build, then retry node bin/agent-office.js.');
  } else console.error(err);
  process.exit(1);
});
