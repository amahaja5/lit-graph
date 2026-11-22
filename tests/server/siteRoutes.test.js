import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/src/index.js';

test('the landing page is at /, the app at /app, SEO files are served, and unknown paths 404', async t => {
  const server = createApp({ logger: { error() {}, debug() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async path => { const r = await fetch(base + path); return { status: r.status, type: r.headers.get('content-type') || '', body: await r.text() }; };

  const landing = await get('/');
  assert.equal(landing.status, 200);
  assert.match(landing.body, /<title>Groundwork: explore papers/);
  assert.match(landing.body, /<link rel="canonical" href="https:\/\/groundwork\.avijmahajan\.com\/"/);
  assert.match(landing.body, /"@type": "SoftwareApplication"/);
  assert.doesNotMatch(landing.body, /noindex/);

  for (const path of ['/app', '/app/']) {
    const app = await get(path);
    assert.equal(app.status, 200); assert.match(app.body, /id="citation-import"/); assert.match(app.body, /name="robots" content="noindex"/);
  }
  assert.match((await get('/robots.txt')).body, /Sitemap: https:\/\/groundwork\.avijmahajan\.com\/sitemap\.xml/);
  assert.match((await get('/sitemap.xml')).body, /<loc>https:\/\/groundwork\.avijmahajan\.com\/<\/loc>/);
  assert.match((await get('/og-image.png')).type, /image\/png/);
  assert.equal((await get('/no-such-page')).status, 404);
});
