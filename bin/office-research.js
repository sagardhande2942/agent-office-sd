#!/usr/bin/env node
import('../dist/server/server/trading-research/coordinator/cli.js').then(m => m.main()).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
