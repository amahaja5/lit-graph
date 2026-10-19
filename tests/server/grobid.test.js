import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGrobidReferences, createGrobid } from '../../lib/grobid.js';
import { createCitationImport } from '../../lib/citationImport.js';
const xml = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><sourceDesc><biblStruct><monogr><title>Not a reference</title></monogr></biblStruct></sourceDesc></fileDesc></teiHeader><text><back><listBibl><biblStruct><analytic><title level="a">A &amp; B</title><author><persName><forename>Jane</forename><forename>Q.</forename><surname>Doe</surname></persName></author><idno type="DOI">10.1234/TEST</idno></analytic><monogr><title level="j">Journal</title><imprint><date when="2020"/><biblScope unit="volume">012</biblScope><biblScope unit="page" from="10" to="20"/></imprint></monogr><note type="raw_reference">Doe (2020). A &amp; B. Journal.</note></biblStruct></listBibl></back></text></TEI>`;
const file = { name: 'paper.pdf', base64: Buffer.from('%PDF-1.4\nfixture').toString('base64') };
const env = { GROBID_API_URL: 'https://extract.example', EXTRACTION_API_KEY: 'test-secret' };
test('TEI maps bibliography only, preserves names, DOI, raw string, and string-valued fields', () => {
  const result = parseGrobidReferences(xml);
  assert.equal(result.references.length, 1);
  const ref = result.references[0];
  assert.equal(ref.title, 'A & B'); assert.equal(ref.doi, '10.1234/test');
  assert.equal(ref.bibliography, 'Doe (2020). A & B. Journal.');
  assert.deepEqual(ref.zoteroItem.creators, [{creatorType:'author',firstName:'Jane Q.',lastName:'Doe'}]);
  assert.equal(ref.zoteroItem.volume, '012'); assert.equal(ref.zoteroItem.pages, '10-20');
});
test('live GROBID reference fixture parses all 40 entries', async () => {
  const content=await readFile(new URL('../fixtures/grobid-attention-references.xml',import.meta.url),'utf8');
  const result=parseGrobidReferences(content);
  assert.equal(result.references.length,40);
  assert.ok(result.references.every(r=>r.bibliography && r.zoteroItem));
  assert.equal(result.references[1].title,'Neural machine translation by jointly learning to align and translate');
});
test('rejects XML entities, malformed responses and oversized bibliographies', () => {
  for (const value of ['<!DOCTYPE TEI><TEI/>','<!ENTITY x "abc"><TEI/>','<TEI>']) assert.throws(()=>parseGrobidReferences(value),/XML/);
  assert.throws(()=>parseGrobidReferences('<TEI><listBibl>'+ '<bibl>Reference</bibl>'.repeat(81)+'</listBibl></TEI>'),/80 references/);
  assert.match(parseGrobidReferences('<TEI/>').warnings.join(' '),/No bibliography/);
});
test('authenticated wrapper request uses multipart file and refuses redirects', async () => {
  const client=createGrobid({env,fetchImpl:async (url, options)=>{
    assert.equal(url,'https://extract.example/extract?mode=references');
    assert.equal(options.headers['X-API-Key'],'test-secret');
    assert.equal(options.redirect,'error'); assert.equal(options.body.get('file').type,'application/pdf');
    return new Response(xml);
  }});
  assert.equal((await client.extract(file)).references.length,1);
  await assert.rejects(client.extract({...file,base64:'bogus'}),/valid PDF/);
});
test('errors do not leak upstream bodies or keys', async () => {
  const client=createGrobid({env,fetchImpl:async()=>new Response('secret upstream text',{status:401})});
  await assert.rejects(client.extract(file), error=> /rejected/.test(error.message) && !/secret upstream/.test(error.message));
});
test('PDF extraction requires consent and never falls back to Anthropic on failure', async () => {
  let called=0;
  const service=createCitationImport({model:{configured:false},grobid:{configured:true,extract:async()=>{called++;throw new Error('GROBID unavailable');}}});
  await assert.rejects(service.extract({file}),/Confirm/); assert.equal(called,0);
  await assert.rejects(service.extract({file,consent:true}),/GROBID unavailable/);assert.equal(called,1);
  assert.equal(service.status().grobidConfigured,true);
});
