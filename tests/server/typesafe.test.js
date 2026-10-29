import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { createTypeSafeClient, validateAnswers } from '../../lib/models/typesafeClient.js';
import { createEvidenceJudgments } from '../../lib/evidence/evidenceJudgments.js';
import { extractHtmlCandidates } from '../../lib/evidence/htmlCandidates.js';
import { createHtmlReviewEvidenceProvider } from '../../lib/review/reviewEvidence.js';
import { createReviewService } from '../../lib/review/reviewService.js';
import { buildPassageCandidates, packPassages, selectPassages } from "../../lib/audit/passages.js";
import { createAuditService } from "../../lib/audit/auditService.js";
import { TTLCache } from '../../lib/shared/cache.js';
import { requestSignal } from '../../lib/http/requestSignal.js';

const question = { type: 'choice', instructions: 'Is this evidence?', criteria: { usable: 'Evidence', unusable: 'Not evidence' } };
const choice = (label, confidence = 1) => ({ type: 'choice', choice: label, confidence, probabilities: { usable: label === 'usable' ? 1 : 0, unusable: label === 'unusable' ? 1 : 0 } });
const score = value => ({ type: 'score', score: value, confidence: 1, probabilities: Object.fromEntries([0, 1, 2, 3].map(n => [n, n === value ? 1 : 0])) });
const response = answers => ({ model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 10 } });
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const paper = { paperId: 'p1', title: 'Trial', url: 'https://example.org/paper', abstract: 'An abstract.' };
const evidence = 'Results: tutoring increased examination scores by 0.18 standard deviations.';
function mockClient(evaluate) { return { configured: true, model: 'test', evaluate }; }
function judgmentsFor(mode, evaluate = async ({ state, questions }) => response(Object.fromEntries(Object.keys(questions).map(id => [id, choice(state.candidates.find(c => c.id === id).text.includes('Results') ? 'usable' : 'unusable')])))) {
  return createEvidenceJudgments({ client: mockClient(evaluate), reviewMode: mode, auditMode: mode });
}
const htmlFetch = markup => async () => new Response(markup, { headers: { 'content-type': 'text/html' } });

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

test('HTML parser retains short evidence and multiple articles without duplicate nested text', () => {
  const { candidates } = extractHtmlCandidates(`<nav>Navigation</nav><article>Subscribe</article><main><article><p>${evidence}</p><p>Alpha &amp; beta <em>result</em>.</p></article></main><script>ignore me</script>`);
  assert.deepEqual(candidates.map(c => c.text), ['Subscribe', evidence, 'Alpha & beta result.']);
  const limited = extractHtmlCandidates('<p>One</p><p>Two</p>', { maxCandidates: 1 });
  assert.equal(limited.truncated, true);
});

test('HTML on mode selects exact short evidence after an access article', async () => {
  const provider = createHtmlReviewEvidenceProvider({ judgments: judgmentsFor('on'), fetchImpl: htmlFetch(`<article>Subscribe to read this paper.</article><article><p>${evidence}</p></article>`) });
  const result = await provider.buildEvidenceForPaper(paper, { refId: 'R1' });
  assert.equal(result.extractedText, evidence);
  assert.equal(result.coverage, 'html_plus_abstract');
  assert.equal(result.quality.selectedIds.length, 1);
});

test('HTML off and shadow retain legacy evidence; off makes no judgments', async () => {
  const text = 'Subscribe to read this paper. '.repeat(10);
  let calls = 0;
  for (const mode of ['off', 'shadow']) {
    const judgments = judgmentsFor(mode, async ({ questions }) => { calls++; return response(Object.fromEntries(Object.keys(questions).map(id => [id, choice('unusable')]))); });
    const result = await createHtmlReviewEvidenceProvider({ judgments, fetchImpl: htmlFetch(`<article>${text}</article>`) }).buildEvidenceForPaper(paper);
    assert.equal(result.extractedText, text.trim());
  }
  assert.equal(calls, 1);
});

test('HTML rejection, low confidence, missing key and API failures use abstract fallback', async () => {
  const clients = [
    mockClient(async ({ questions }) => response(Object.fromEntries(Object.keys(questions).map(id => [id, choice('unusable')])))),
    mockClient(async ({ questions }) => response(Object.fromEntries(Object.keys(questions).map(id => [id, choice('usable', 0.5)])))),
    createTypeSafeClient({ apiKey: '' }),
    mockClient(async () => { throw new Error('service down'); }),
  ];
  for (const client of clients) {
    const provider = createHtmlReviewEvidenceProvider({ judgments: createEvidenceJudgments({ client, reviewMode: 'on' }), fetchImpl: htmlFetch(`<p>${evidence}</p>`) });
    const result = await provider.buildEvidenceForPaper(paper);
    assert.equal(result.coverage, 'abstract_only');
    assert.equal(result.extractedText, '');
    assert.ok(result.warnings.length);
  }
});

test('failed HTML quality checks are not cached and refId is current on cache hits', async () => {
  let calls = 0;
  const judgments = judgmentsFor('on', async ({ questions }) => {
    if (++calls === 1) throw new Error('temporary');
    return response(Object.fromEntries(Object.keys(questions).map(id => [id, choice('usable')])));
  });
  const provider = createHtmlReviewEvidenceProvider({ judgments, cache: new TTLCache(), fetchImpl: htmlFetch(`<p>${evidence}</p>`) });
  assert.equal((await provider.buildEvidenceForPaper(paper, { refId: 'R1' })).coverage, 'abstract_only');
  assert.equal((await provider.buildEvidenceForPaper(paper, { refId: 'R2' })).coverage, 'html_plus_abstract');
  assert.equal(calls, 2);
  assert.equal((await provider.buildEvidenceForPaper(paper, { refId: 'R3' })).refId, 'R3');
});

test('HTML downloads are bounded', async () => {
  const provider = createHtmlReviewEvidenceProvider({ judgments: judgmentsFor('off'), logger: { debug() {} }, fetchImpl: async () => new Response('x', { headers: { 'content-type':'text/html', 'content-length':String(3*1024*1024) } }) });
  assert.equal((await provider.buildEvidenceForPaper(paper)).coverage, 'abstract_only');
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

test('audit off, shadow, enabled, and unavailable modes retain validation and fallback', async () => {
  const source = { status:'available', title:'Study', sha256:'hash', sourceUrl:'https://example.org/paper', warnings:[], pages:Array.from({length:10},(_,i)=>({page:i+1,text:i===9?'Results: income fell compared with controls.':'Income increased is the hypothesis discussed in this introduction.'})) };
  const claim = { id:'C1',text:'Income increased.',referenceIds:['R1'] };
  for (const mode of ['off','shadow','on','failure']) {
    let observed;
    const judgments = judgmentsFor(mode==='failure'?'on':mode, async ({ state,questions }) => {
      if(mode==='failure') throw new Error('down');
      return response(Object.fromEntries(Object.keys(questions).map(id=>[id,score(state.candidates.find(c=>c.id===id).page===10?3:1)])));
    });
    const service = createAuditService({ judgments, sources:{ resolve:async()=>source }, model:{ configured:true,model:'mock',json:async(_prompt,data)=>{
      observed=data.sources[0];
      return { assessments:[{referenceId:'R1',status:'supported',evidence:[{page:10,quote:'Fabricated evidence that is not in the source.'}]}] };
    }} });
    const result=await service.check({claim,references:[{id:'R1',title:'Study'}]});
    assert.equal(result.assessments[0].status,'insufficient_evidence');
    assert.equal(observed.selection,undefined);
    if(mode==='on') assert.equal(observed.passages[0].page,10);
    else assert.deepEqual(observed.passages,selectPassages(source,claim.text));
    if(mode==='failure') assert.ok(result.assessments[0].source.warnings.some(w=>w.includes('keyword')));
  }
});

test('request cancellation is propagated rather than converted to an evidence fallback', async () => {
  const controller = new AbortController(); controller.abort();
  const provider = createHtmlReviewEvidenceProvider({ judgments: judgmentsFor('on'), fetchImpl: htmlFetch(`<p>${evidence}</p>`) });
  await assert.rejects(provider.buildEvidenceForPaper(paper, { budget:{ signal:controller.signal, deadline:null } }), {name:'AbortError'});
  const req = new EventEmitter(), res = new EventEmitter();
  const signal = requestSignal(req,res); res.emit('close'); assert.equal(signal.aborted,true);
});

test('review cache cannot bypass new quality modes', async () => {
  const cache = new TTLCache(), evidenceCache = new TTLCache();
  let syntheses=0;
  const opts = { s2Client:{ getPapersBatch:async()=>[paper,{...paper,paperId:'p2'}] }, anthropicClient:{generateStructuredSynthesis:async()=>({model:'mock',review:{serial:++syntheses}})}, fetchImpl:htmlFetch(`<p>${'Subscribe for access. '.repeat(20)}</p>`), reviewCache:cache,evidenceCache };
  const input={paperIds:['p1','p2'],mode:'html',outputShape:'structured_synthesis'};
  const off=createReviewService({...opts,judgments:judgmentsFor('off')});
  assert.equal((await off.generateReview(input)).references[0].coverage,'html_plus_abstract');
  const on=createReviewService({...opts,judgments:judgmentsFor('on')});
  assert.equal((await on.generateReview(input)).references[0].coverage,'abstract_only');
  assert.equal(syntheses,2);
  await on.generateReview(input);
  assert.equal(syntheses,2);
});

test('review synthesis does not cache a temporary quality fallback', async () => {
  let failed=true, calls=0;
  const judgments=judgmentsFor('on',async ({questions})=>{
    if(failed) throw new Error('temporary');
    return response(Object.fromEntries(Object.keys(questions).map(id=>[id,choice('usable')])));
  });
  const service=createReviewService({judgments,s2Client:{getPapersBatch:async()=>[paper,{...paper,paperId:'p2'}]},anthropicClient:{generateStructuredSynthesis:async()=>({model:'mock',review:{serial:++calls}})},fetchImpl:htmlFetch(`<p>${evidence}</p>`),evidenceCache:new TTLCache(),reviewCache:new TTLCache()});
  const input={paperIds:['p1','p2'],mode:'html',outputShape:'structured_synthesis'};
  assert.equal((await service.generateReview(input)).references[0].coverage,'abstract_only');
  failed=false;
  assert.equal((await service.generateReview(input)).references[0].coverage,'html_plus_abstract');
  assert.equal(calls,2);
});
