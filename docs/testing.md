# Testing efficiently

Run the relevant files while editing, then run the complete checks once the change is ready:

```sh
npm run test:focus -- tests/communications.test.ts
npm run test:focus -- tests/boss-mode.test.ts tests/boss-mode-server.test.ts
npm run test:focus -- --test-name-pattern='retention' tests/communications.test.ts

npm run typecheck
npm test
npm run build
```

`test:focus` uses the same TypeScript and asset loaders and process isolation as `npm test`; it runs only the files you supply. Include affected integration tests as well as unit tests. A passing subset does not replace the final full suite. After successful final checks, rerun checks only when another edit or an unresolved failure justifies it. Browser changes also need the matching headless harness and screenshot.

Build a fresh checkout before running integration tests: worker subprocesses and HTTP fixtures use `dist/`. Rebuild when tests exercise compiled entry points changed by your patch. Missing build artifacts can cause failures and leave integration fixtures waiting for events that never arrive.

## Find bottlenecks

```sh
npm run test:profile
```

This runs the full suite with normal pass/fail output, then prints the 15 slowest test bodies and 10 slowest files. File timings include fixture setup and waiting for open handles; body timings include awaited I/O. A large difference can indicate expensive imports, module-level setup, or timers/processes/sockets left alive after a test. Parallel file durations overlap, so do not add them to estimate suite wall time. Profiling does not skip tests or alter failure exit codes.

Use consistent Node versions and concurrency, build artifacts ready, and an otherwise quiet machine for before/after measurements. Shared office workers and concurrent suites affect timing. Keep Node's default bounded concurrency unless measurements justify an override; focused runs accept `--test-concurrency=2` before file paths.

## Fast fixtures without weaker assertions

- For retention or pagination boundaries, seed bulk history from a small valid fixture, then exercise the real operation across the boundary and reload from disk. Keep lifecycle/persistence tests separate.
- Fake interactive agent CLIs should also answer incidental one-shot requests such as version probes and task-label generation. A fake that hangs on every invocation can leave a real 45-second timeout running after assertions finish. Settle fake RPC calls even when the test only checks the outgoing frame.
- Await an observable event or bounded condition for readiness rather than reducing a fixed sleep until it passes locally.
- Clear timeout guards when their event arrives. Close sockets, servers and child processes in cleanup.
- Use fake clocks for pure time-based behavior; retain real process and socket tests for integration contracts.

On Node versions with synchronous loader hooks (22.15+ and 24+), the test asset hook avoids asynchronous asset-hook registration and dispatch for every file. TypeScript still uses the tsx loader. Node 20 retains the asynchronous loader fallback. Tests still run in isolated processes; shared globals, environment changes and module caches cannot leak across files.

Worker startup warnings remain scheduled for 12 seconds while the office is running, but no longer keep a shut-down process alive. `tests/worker-shutdown.test.ts` checks this in a child process so other suite handles cannot hide the regression.
