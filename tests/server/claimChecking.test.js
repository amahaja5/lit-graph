import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inventoryFromTei, citationLabel } from '../../lib/audit/teiInventory.js';
import { sourceVerdict, combinedVerdict } from '../../lib/audit/verdicts.js';

test('GROBID full text becomes a citation inventory linked to the bibliography (real paper)', async () => {
  const tei = await readFile(new URL('../fixtures/grobid-attention-fulltext.xml', import.meta.url), 'utf8');
  const inv = inventoryFromTei(tei);
  assert.equal(inv.references.length, 40);
  assert.equal(inv.claims.length, 36);
  assert.deepEqual(inv.claims[0].referenceIds, ['R13', 'R7', 'R35', 'R2', 'R5'], 'grouped citations "[35, 2, 5]" link each entry');
  assert.match(inv.claims[0].text, /^Recurrent neural networks, long short-term memory \[13\]/);
  assert.equal(inv.references.find(r => r.id === 'R13').title, 'Long short-term memory');
  assert.deepEqual(inv.references.slice(0, 3).map(r => r.label), ['[1]', '[2]', '[3]']);
  assert.ok(inv.references.filter(r => r.arxiv).length >= 10, 'arXiv references carry their ID for retrieval');
  assert.ok(inv.claims.every(c => c.referenceIds.length <= 8 && c.text.length >= 10));
  assert.match(inv.coverageNotice, /GROBID/);
});

test('citation markers become clean labels', () => {
  assert.equal(citationLabel('[35,'), '[35]');
  assert.equal(citationLabel('5]'), '[5]');
  assert.equal(citationLabel('(Smith et al., 2020;'), 'Smith et al., 2020');
});

test('unlinked citations and oversized citation lists are reported, not silently dropped', () => {
  const refs = Array.from({ length: 10 }, (_, i) => `<biblStruct xml:id="b${i}"><analytic><title level="a">Paper ${i}</title></analytic><monogr/><note type="raw_reference">Author ${i}. Paper ${i}. 2020.</note></biblStruct>`).join('');
  const cites = Array.from({ length: 10 }, (_, i) => `<ref type="bibr" target="#b${i}">[${i + 1}]</ref>`).join(' ');
  const tei = `<TEI><text><body><div><p><s>Many works study this question in depth ${cites}.</s><s>An unlinked citation appears here <ref type="bibr">[99]</ref>.</s></p></div></body><back><listBibl>${refs}</listBibl></back></text></TEI>`;
  const inv = inventoryFromTei(tei);
  assert.equal(inv.claims.length, 1);
  assert.equal(inv.claims[0].referenceIds.length, 8);
  assert.ok(inv.warnings.some(w => /could not be linked/.test(w)));
  assert.ok(inv.warnings.some(w => /more than 8 sources/.test(w)));
  assert.throws(() => inventoryFromTei('<!DOCTYPE x><TEI/>'), /invalid or unsupported XML/);
});

const passages = [{ page: 2, text: 'Accuracy rose to 95.3 percent on the test set.' }, { page: 5, text: 'On the held-out languages accuracy fell to 40 percent.' }, { page: 7, text: 'Related work is summarised here.' }];
const s = (id, choice, confidence) => ({ id, choice, confidence });

test('per-source verdicts follow confident passage judgments and quote the judged passages', () => {
  const supported = sourceVerdict('R1', passages, [s('p1', 'supported', 0.9), s('p3', 'insufficient_evidence', 0.8)], 0.6);
  assert.equal(supported.status, 'supported');
  assert.deepEqual(supported.evidence, [{ quote: passages[0].text, page: 2 }]);
  assert.equal(sourceVerdict('R1', passages, [s('p2', 'contradicted', 0.8)], 0.6).status, 'contradicted');
  const mixed = sourceVerdict('R1', passages, [s('p1', 'supported', 0.9), s('p2', 'contradicted', 0.85)], 0.6);
  assert.equal(mixed.status, 'partially_supported'); assert.match(mixed.explanation, /Mixed evidence/); assert.equal(mixed.evidence.length, 2);
  assert.equal(sourceVerdict('R1', passages, [s('p1', 'partially_supported', 0.7)], 0.6).status, 'partially_supported');
  const unsure = sourceVerdict('R1', passages, [s('p1', 'supported', 0.49)], 0.6);
  assert.equal(unsure.status, 'insufficient_evidence'); assert.equal(unsure.evidence.length, 0);
  assert.match(unsure.explanation, /leaned "supported" \(confidence 0\.49, page 2\)/);
  assert.equal(sourceVerdict('R1', passages, [s('p9', 'supported', 0.99)], 0.6).status, 'insufficient_evidence', 'answers for unknown passages are ignored');
});

test('combined verdicts are conservative across sources', () => {
  const v = status => ({ status });
  assert.equal(combinedVerdict([v('supported'), v('supported')]).status, 'supported');
  assert.equal(combinedVerdict([v('contradicted')]).status, 'contradicted');
  assert.equal(combinedVerdict([v('supported'), v('contradicted')]).status, 'partially_supported');
  assert.equal(combinedVerdict([v('insufficient_evidence')]).status, 'insufficient_evidence');
  assert.equal(combinedVerdict([]).status, 'insufficient_evidence');
});
