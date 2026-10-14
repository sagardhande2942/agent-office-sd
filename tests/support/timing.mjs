// An additional reporter: timing evidence without changing discovery or isolation.
export default async function* timing(events) {
  const tests = [];
  const files = new Map();
  const bodies = new Map();
  for await (const event of events) {
    if (event.type === 'test:summary' && event.data.file) {
      files.set(event.data.file, event.data.duration_ms);
    }
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { name, file, details } = event.data;
    // Nested suites include their children's durations; count leaf tests only.
    if (details?.type !== 'test' || !file) continue;
    const ms = details.duration_ms;
    tests.push({ name, file, ms });
    bodies.set(file, (bodies.get(file) ?? 0) + ms);
  }
  yield '\nSlowest test bodies (includes awaited I/O; excludes process startup):\n';
  for (const { name, ms } of tests.sort((a, b) => b.ms - a.ms).slice(0, 15)) {
    yield `${(ms / 1000).toFixed(3)}s  ${name}\n`;
  }
  yield '\nSlowest test files (includes setup and time waiting for handles):\n';
  for (const [file, ms] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    yield `${(ms / 1000).toFixed(3)}s total / ${((bodies.get(file) ?? 0) / 1000).toFixed(3)}s bodies  ${file}\n`;
  }
}
