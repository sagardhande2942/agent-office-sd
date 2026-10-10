import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebGLRenderer } from 'three';
import { renderOverlay } from '../src/client/core/render-overlay';

test('first-person overlay preserves world color, clears depth, and restores automatic clearing', () => {
  const buffer = { color: 'office', depth: 'office' };
  const renderer = { autoClear: true, clearDepth() { buffer.depth = ''; } };
  renderOverlay(renderer as unknown as WebGLRenderer, () => {
    if (renderer.autoClear) buffer.color = 'black';
    assert.equal(buffer.color, 'office');
    assert.equal(buffer.depth, '');
    buffer.depth = 'hands';
  });
  assert.equal(renderer.autoClear, true);
});

test('overlay restores either clearing mode even when rendering throws', () => {
  for (const autoClear of [true, false]) {
    const renderer = { autoClear, clearDepth() {} };
    assert.throws(() => renderOverlay(renderer as unknown as WebGLRenderer, () => { throw new Error('render failed'); }), /render failed/);
    assert.equal(renderer.autoClear, autoClear);
  }
});
