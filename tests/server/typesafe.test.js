import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { createTypeSafeClient, validateAnswers } from '../../lib/models/typesafeClient.js';
import { createEvidenceJudgments } from '../../lib/evidence/evidenceJudgments.js';
import { buildPassageCandidates, packPassages, selectPassages } from "../../lib/audit/passages.js";
import { createAuditService } from "../../lib/audit/auditService.js";
import { requestSignal } from '../../lib/http/requestSignal.js';

const question = { type: 'choice', instructions: 'Is this evidence?', criteria: { usable: 'Evidence', unusable: 'Not evidence' } };
const choice = (label, confidence = 1) => ({ type: 'choice', choice: label, confidence, probabilities: { usable: label === 'usable' ? 1 : 0, unusable: label === 'unusable' ? 1 : 0 } });
const relation = label => ({ type: 'choice', choice: label, confidence: 0.9, probabilities: { [label]: 0.9 } });
const score = value => ({ type: 'score', score: value, confidence: 1, probabilities: Object.fromEntries([0, 1, 2, 3].map(n => [n, n === value ? 1 : 0])) });
const response = answers => ({ model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 10 } });
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const evidence = 'Results: tutoring increased examination scores by 0.18 standard deviations.';
function mockClient(evaluate) { return { configured: true, model: 'test', evaluate }; }
function judgmentsFor(mode, evaluate = async ({ state, questions }) => response(Object.fromEntries(Object.keys(questions).map(id => [id, choice(state.candidates.find(c => c.id === id).text.includes('Results') ? 'usable' : 'unusable')])))) {
  return createEvidenceJudgments({ client: mockClient(evaluate), auditMode: mode });
}

test('TypeSafe sends documented auth/shape, caches judgments and isolates cached mutations', async () => {
  let calls = 0;
  const client = createTypeSafeClient({ apiKey: 'test-key', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.headers.authorization, 'Bearer test-key');
    assert.equal(JSON.parse(init.body).model, 'jev-1.13.0');
    return jsonResponse(response({ q: choice('usable') }));
  } });
  const args = { state: evidence, questions: { q: question } };
  const first = await client.evaluate(args);
  first.answers.q.choice = 'unusable';
  assert.equal((await client.evaluate(args)).answers.q.choice, 'usable');
  assert.equal(calls, 1);
  await client.evaluate({ ...args, rubricVersion: '2' });
  assert.equal(calls, 2);
});

test('TypeSafe retries rate limits but not auth errors, and never caches failures', async () => {
  let calls = 0;
  const client = createTypeSafeClient({ apiKey: 'test', fetchImpl: async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : jsonResponse(response({ q: choice('usable') })) });
  await client.evaluate({ state: '', questions: { q: question } });
  assert.equal(calls, 2);
  let failures = 0;
  const denied = createTypeSafeClient({ apiKey: 'test', fetchImpl: async () => { failures++; return new Response('', { status: 401 }); } });
  for (let i = 0; i < 2; i++) await assert.rejects(denied.evaluate({ state: '', questions: { q: question } }), /401/);
  assert.equal(failures, 2);
});

test('TypeSafe rejects missing, unexpected, invalid, and out-of-range answers', () => {
  for (const invalid of [response({}), response({ q: choice('unknown') }), response({ q: choice('usable'), extra: choice('usable') }), response({ q: { ...choice('usable'), confidence: NaN } }), response({ q: { ...choice('usable'), probabilities: { usable: 0.2, unusable: 0.2 } } })]) {
    assert.throws(() => validateAnswers(invalid, { q: question }), /invalid typed response/);
  }
  assert.throws(() => validateAnswers(response({ q: score(4) }), { q: { type: 'score', criteria: ['a','b','c','d'] } }), /invalid/);
});

test('TypeSafe enforces deadline and concurrency, releases aborted requests', async () => {
  let active = 0, peak = 0;
  const client = createTypeSafeClient({ apiKey: 'test', timeoutMs: 1000, fetchImpl: async (_url, { signal }) => {
    active++; peak = Math.max(peak, active);
    try { await delay(20, undefined, { signal }); return jsonResponse(response({ q: choice('usable') })); }
    finally { active--; }
  } });
  await Promise.all(Array.from({ length: 5 }, (_, i) => client.evaluate({ state: String(i), questions: { q: question } })));
  assert.equal(peak, 2);
  const timeout = createTypeSafeClient({ apiKey: 'test', timeoutMs: 5, fetchImpl: async (_url, { signal }) => { await delay(50, undefined, { signal }); } });
  await assert.rejects(timeout.evaluate({ state: '', questions: { q: question } }), { name: 'AbortError' });
});

test('reranking preserves contradictory source text and page provenance', async () => {
  const source = { pages: Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: i === 9 ? 'The treatment reduced rather than increased income.' : 'Increased income treatment protocol and introduction.' })) };
  const candidates = buildPassageCandidates(source, 'The treatment increased income.');
  const judgments = judgmentsFor('on', async ({ state, questions }) => response(Object.fromEntries(Object.keys(questions).map(id => [id, score(state.candidates.find(c=>c.id===id).page===10 ? 3 : 1)]))));
  const result = await judgments.rankPassages({ candidates, claim: 'The treatment increased income.', sourceHash: 'hash' });
  const selected = packPassages(result.ranked, 14000, { deduplicate: true });
  assert.deepEqual(selected[0], source.pages[9]);
  assert.equal(selected.length, 8);
});

test('overlap deduplication preserves uncovered source text without fabricating bytes', () => {
  const source = { pages: [{ page: 1, text: 'A'.repeat(1400) + 'B'.repeat(400) + 'C'.repeat(1000) }] };
  const selected = packPassages(buildPassageCandidates(source, 'claim'), 14000, { deduplicate: true });
  assert.equal(selected.map(p=>p.text).join(''), source.pages[0].text);
  assert.ok(selected.every(p=>source.pages[0].text.includes(p.text)));
});

test('large candidate sets have bounded batches and visible coverage limits', async () => {
  let count = 0;
  const judgments = judgmentsFor('on', async args => {
    assert.ok(Buffer.byteLength(JSON.stringify(args)) <= 20_000);
    count += args.state.candidates.length;
    return response(Object.fromEntries(Object.keys(args.questions).map(id=>[id, score(1)])));
  });
  const candidates = buildPassageCandidates({ pages: Array.from({length: 120},(_,i)=>({page:i+1,text:'Evidence sentence. '.repeat(60)})) }, 'Evidence');
  const result = await judgments.rankPassages({ candidates, claim:'Evidence', sourceHash:'hash' });
  assert.ok(count <= 96);
  assert.equal(result.diagnostics.truncated, true);
  assert.ok(result.warnings.length);
  assert.ok(result.ranked.some(c=>c.page===120));
});

test('verdicts come from TypeSafe relation judgments of the selected passages, in every ranking mode', async () => {
  const source = { status:'available', title:'Study', sha256:'hash', sourceUrl:'https://example.org/paper', warnings:[], pages:Array.from({length:10},(_,i)=>({page:i+1,text:i===9?'Results: income fell compared with controls.':'Income increased is the hypothesis discussed in this introduction.'})) };
  const claim = { id:'C1',text:'Income increased.',referenceIds:['R1'] };
  for (const mode of ['off','shadow','on','failure']) {
    const asked = [];
    const judgments = judgmentsFor(mode==='failure'?'on':mode, async ({ state,questions }) => {
      const types = new Set(Object.values(questions).map(q => q.type)); asked.push(...types);
      if (mode==='failure') throw new Error('down');
      return response(Object.fromEntries(Object.keys(questions).map(id => {
        const c = state.candidates.find(x => x.id === id);
        return [id, questions[id].type === 'score' ? score(c.page===10?3:1) : relation(c.text.includes('income fell') ? 'contradicted' : 'insufficient_evidence')];
      })));
    });
    const service = createAuditService({ judgments, sources:{ resolve:async()=>source } });
    if (mode === 'failure') {
      await assert.rejects(service.check({claim,references:[{id:'R1',title:'Study'}]}), e => e.status === 502 && e.code === 'checker_unavailable' && /TypeSafe could not complete/.test(e.message));
      continue;
    }
    const result = await service.check({claim,references:[{id:'R1',title:'Study'}]});
    assert.equal(asked.includes('score'), mode !== 'off', 'passages are ranked only when ranking is enabled');
    assert.ok(asked.includes('choice'), 'every mode asks TypeSafe for relation verdicts');
    if (mode === 'on') {
      assert.equal(result.assessments[0].status, 'contradicted');
      assert.equal(result.assessments[0].evidence[0].page, 10);
      assert.equal(result.assessments[0].evidence[0].quote, 'Results: income fell compared with controls.');
      assert.equal(result.combined.status, 'contradicted');
    } else {
      // Keyword selection keeps the nine matching introduction pages ahead of page 10, so nothing is established.
      assert.equal(result.assessments[0].status, 'insufficient_evidence');
    }
    assert.match(result.model, /^TypeSafe /);
  }
});

test('request cancellation is propagated to judgments', () => {
  const req = new EventEmitter(), res = new EventEmitter();
  const signal = requestSignal(req,res); res.emit('close'); assert.equal(signal.aborted,true);
});

