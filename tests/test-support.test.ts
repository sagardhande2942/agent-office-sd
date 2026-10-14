import { test } from 'node:test';
import assert from 'node:assert/strict';
import timing from './support/timing.mjs';
import { load } from './support/css-loader.mjs';

test('asset hook handles styles and Vite URLs and delegates ordinary modules unchanged', async () => {
  const context = { format: 'module' };
  const next = (url: string, received: unknown) => {
    assert.equal(received, context);
    return Promise.resolve({ format: 'module', source: url });
  };
  assert.equal(load('file:///styles.css', context, next).source, '');
  for (const url of ['file:///pet.glb', 'file:///decoder.js?url', 'file:///decoder.wasm?url']) {
    assert.equal(load(url, context, next).source, 'export default "";');
  }
  assert.equal((await load('file:///code.js', context, next)).source, 'file:///code.js');
});

test('timing reporter ranks failures too, excludes suite double counting, and exposes file overhead', async () => {
  async function* events() {
    yield { type: 'test:pass', data: { name: 'fast', file: '/fast.ts', details: { type: 'test', duration_ms: 10 } } };
    yield { type: 'test:fail', data: { name: 'slow failure', file: '/slow.ts', details: { type: 'test', duration_ms: 2000 } } };
    yield { type: 'test:pass', data: { name: 'parent suite', file: '/slow.ts', details: { type: 'suite', duration_ms: 4000 } } };
    yield { type: 'test:summary', data: { file: '/fast.ts', duration_ms: 5000 } };
    yield { type: 'test:summary', data: { file: '/slow.ts', duration_ms: 3000 } };
    yield { type: 'test:summary', data: { duration_ms: 6000 } };
  }
  let output = '';
  for await (const chunk of timing(events())) output += chunk;
  assert.ok(output.indexOf('slow failure') < output.indexOf('fast\n'));
  assert.doesNotMatch(output, /parent suite/);
  assert.match(output, /5\.000s total \/ 0\.010s bodies  \/fast.ts/);
  assert.match(output, /3\.000s total \/ 2\.000s bodies  \/slow.ts/);
});
