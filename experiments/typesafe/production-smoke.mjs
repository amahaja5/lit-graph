// Explicit opt-in live check of the production adapter/workflow. Synthetic data only.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createEvidenceJudgments } from '../../lib/evidenceJudgments.js';
import { createHtmlReviewEvidenceProvider } from '../../lib/reviewEvidence.js';
import { buildPassageCandidates, packPassages } from '../../lib/auditService.js';
import { retrieval, html } from './fixtures.mjs';

if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required');
const judgments = createEvidenceJudgments({ reviewMode: 'on', auditMode: 'on' });
const research = html.find(f => f.id === 'research').text;
const notice = html.find(f => f.id === 'paywall').text;
const provider = createHtmlReviewEvidenceProvider({
  judgments,
  fetchImpl: async () => new Response(`<article>${notice}</article><article><h1>School Tutoring Trial</h1><p>${research}</p></article>`, { headers: { 'content-type': 'text/html' } }),
});
const evidence = await provider.buildEvidenceForPaper({paperId:'synthetic',title:'School Tutoring Trial',abstract:'A randomized school tutoring trial.',url:'https://example.org/synthetic'}, {refId:'R1'});
assert.equal(evidence.quality.status, 'evaluated');
assert.equal(evidence.extractedText, research);
const fixture = retrieval.find(f => f.id === 'negation');
const pages = [...fixture.distractors, ...fixture.relevant].map((text,i)=>({page:i+1,text}));
const ranked = await judgments.rankPassages({ candidates:buildPassageCandidates({pages},fixture.claim),claim:fixture.claim,sourceHash:'synthetic-fixture' });
assert.equal(ranked.diagnostics.status,'evaluated');
const selected = packPassages(ranked.ranked,14000,{deduplicate:true});
assert.equal(selected[0].text,fixture.relevant[0]);
assert.equal(selected[0].page,10);
const result = {createdAt:new Date().toISOString(),html:{coverage:evidence.coverage,quality:evidence.quality},audit:{firstPage:selected[0].page,selection:ranked.diagnostics}};
await writeFile(new URL('./results/production-smoke.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({html:evidence.coverage,htmlStatus:evidence.quality.status,auditFirstPage:selected[0].page,auditStatus:ranked.diagnostics.status,models:[...evidence.quality.models,...ranked.diagnostics.models]},null,2));
