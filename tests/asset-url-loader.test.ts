import test from 'node:test';
import assert from 'node:assert/strict';

// Test the same hook npm test registers, without evaluating Vite URL assets as code.
test('Vite decoder and model URL imports are URLs under Node tests', async () => {
  const { load } = await import('./support/css-loader.mjs');
  for (const url of ['file:///decoder.wasm?url', 'file:///decoder.js?url', 'file:///fridge.glb?url']) {
    const result = await load(url, {}, () => { throw Error('asset must not be evaluated'); });
    assert.equal(result.shortCircuit, true);
    assert.equal(result.source, 'export default "";');
  }
  let passed = false;
  await load('file:///normal-module.js', {}, () => { passed = true; return {}; });
  assert.equal(passed, true);
});
