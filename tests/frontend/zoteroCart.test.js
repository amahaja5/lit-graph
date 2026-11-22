import test from 'node:test';
import assert from 'node:assert/strict';
import { createZoteroCartSaver } from '../../frontend/src/review/zoteroCart.js';

function el(value = '') {
  return { value, textContent: '', disabled: false, hidden: true, href: '', listeners: {}, classList: { toggle() {} },
    addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {} };
}
function setup({ connected = true, writeRequested = true, nodes, responses = {} } = {}) {
  const els = { name: el(), save: el(), status: el(), open: el() };
  const calls = []; let ids = 0;
  const account = { state: { connected, writeRequested, configured: true }, status() { return this.state; }, signIn: async () => { account.state = { connected: true, writeRequested: true, configured: true }; return true; } };
  const post = async (url, body) => {
    calls.push({ url, body });
    const handler = responses[url];
    if (handler) return handler(body, calls);
    return url.endsWith('/collection') ? { key: 'COLL2345', url: 'https://www.zotero.org/users/1/collections/COLL2345/items' } : { key: 'ITEM' + body.paperId.slice(0, 4), reused: false, source: 'crossref' };
  };
  const saver = createZoteroCartSaver({ els, account, post, getNodes: () => nodes, getSeedTitle: () => 'Attention Is All You Need', sleep: async () => {}, newId: () => `id-${++ids}` });
  return { els, calls, saver, account };
}
const paper = n => ({ paperId: String(n).repeat(40).slice(0, 40), title: `Paper ${n}` });

test('the cart is saved to one named collection, and saving again adds only new papers', async () => {
  const nodes = [paper(1), paper(2)];
  const { els, calls, saver } = setup({ nodes });
  saver.render();
  assert.equal(els.name.value, 'Reading list · Attention Is All You Need');
  assert.equal(els.save.textContent, 'Save 2 to Zotero');
  await saver.save();
  assert.deepEqual(calls.map(c => c.url), ['/api/import/collection', '/api/import/work', '/api/import/work']);
  assert.deepEqual(calls.slice(1).map(c => c.body.paperId), nodes.map(n => n.paperId));
  assert.ok(calls.every(c => c.body.importId === 'id-1'));
  assert.equal(els.open.hidden, false);
  assert.match(els.status.textContent, /Saved 2 papers to "Reading list · Attention Is All You Need"/);
  assert.equal(els.save.textContent, 'Saved to Zotero');

  nodes.push(paper(3)); saver.render();
  assert.equal(els.save.textContent, 'Save 1 more to Zotero');
  await saver.save();
  assert.deepEqual(calls.slice(3).map(c => c.url), ['/api/import/work'], 'collection reused, only the new paper saved');

  els.name.value = 'A different list'; saver.render();
  await saver.save();
  assert.equal(calls.at(-4).url, '/api/import/collection');
  assert.equal(calls.at(-4).body.importId, 'id-2', 'renaming starts a new collection');
});

test('signed-out users are sent to the global sign-in first; read-only sign-ins are told to reconnect', async () => {
  const signedOut = setup({ connected: false, nodes: [paper(1)] });
  signedOut.saver.render();
  assert.equal(signedOut.els.save.textContent, 'Sign in to save to Zotero');
  await signedOut.saver.save();
  assert.equal(signedOut.calls.filter(c => c.url.endsWith('/work')).length, 1, 'continues after signing in');

  const readOnly = setup({ writeRequested: false, nodes: [paper(1)] });
  readOnly.saver.render(); await readOnly.saver.save();
  assert.equal(readOnly.calls.length, 0);
  assert.match(readOnly.els.status.textContent, /read-only/);
});

test('a rate-limited save waits and continues; papers without a DOI are reported', async () => {
  let limited = false;
  const { els, calls, saver } = setup({ nodes: [paper(1), paper(2)], responses: {
    '/api/import/work': body => {
      if (!limited) { limited = true; const e = new Error('Zotero is limiting requests.'); e.status = 429; e.retryAfterSeconds = 2; throw e; }
      return { key: 'K' + body.paperId.slice(0, 7), reused: false, source: body.paperId.startsWith('2') ? 'semanticscholar' : 'crossref' };
    },
  } });
  saver.render(); await saver.save();
  assert.equal(calls.filter(c => c.url.endsWith('/work')).length, 3, 'one retry');
  assert.match(els.status.textContent, /Saved 2 papers.*1 had no DOI and used Semantic Scholar metadata/);
});
