import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewController } from '../../frontend/src/review/controller.js';

function setup() {
  const pending = [];
  const messages = [];
  const controller = createReviewController({
    api: { generateReview: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    getPaperIds: () => ['a', 'b'], onChange() {}, clearError() {},
    setStatus: message => messages.push(message), setError: message => messages.push(message),
  });
  return { controller, pending, messages };
}

test('review result is stale if the cart changed during generation', async () => {
  const { controller, pending } = setup();
  const work = controller.generate();
  assert.deepEqual(controller.getState(), { status: 'loading' });
  controller.cartChanged();
  pending[0].resolve({ references: [] });
  await work;
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().stale, true);
  assert.ok(Object.isFrozen(controller.getState()));
});

test('reset prevents an old response from replacing a new review', async () => {
  const { controller, pending } = setup();
  const old = controller.generate();
  controller.reset();
  const current = controller.generate();
  const payload = { references: [{ paperId: 'new' }] };
  pending[1].resolve(payload);
  await current;
  pending[0].resolve({ references: [{ paperId: 'old' }] });
  await old;
  assert.equal(controller.getState().payload, payload);
});

test('reset suppresses old errors and duplicate generation is ignored', async () => {
  const { controller, pending, messages } = setup();
  const old = controller.generate();
  await controller.generate();
  assert.equal(pending.length, 1);
  controller.reset();
  const before = messages.length;
  pending[0].reject(new Error('old failure'));
  await old;
  assert.deepEqual(controller.getState(), { status: 'idle' });
  assert.equal(messages.length, before);
});

test('invalid review responses become errors without ready payloads', async () => {
  const { controller, pending } = setup();
  const work = controller.generate();
  pending[0].resolve(null);
  await work;
  assert.equal(controller.getState().status, 'error');
  assert.match(controller.getState().errorMessage, /Invalid review response/);
  assert.equal('payload' in controller.getState(), false);
});
