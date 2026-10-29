import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticMatch } from '../../frontend/src/citation-import/importMatching.js';
import { referencesToRis } from '../../frontend/src/citation-import/ris.js';
const candidate={doi:'10.1234/work',title:'A detailed study of sampling',year:'2020',item:{creators:[{lastName:'Doe'}]}};
const reference={title:candidate.title,bibliography:'Doe. (2020). A detailed study of sampling.',doi:candidate.doi};
test('automatic matching accepts exact DOI plus matching title, not mismatched metadata',()=>{
  assert.equal(automaticMatch(reference,[candidate]),0);
  assert.equal(automaticMatch({...reference,title:'Another paper entirely'},[candidate]),-1);
  assert.equal(automaticMatch(reference,[candidate,candidate]),-1);
});
test('title-only lookup requires corroborating year and author',()=>{
  assert.equal(automaticMatch({...reference,doi:''},[candidate]),0);
  assert.equal(automaticMatch({...reference,doi:'',bibliography:'Smith (2020)'},[candidate]),-1);
  assert.equal(automaticMatch({...reference,doi:'',bibliography:'Doe (2021)'},[candidate]),-1);
  assert.equal(automaticMatch({...reference,doi:'',title:''},[candidate]),0);
});
test('RIS preserves names and Unicode, strips injected record delimiters and permits DOI-less items',()=>{
  const ris=referencesToRis([{title:'Étude\nTY  - JOUR',bibliography:'Original',doi:'',zoteroItem:{itemType:'book',creators:[{lastName:'Doe',firstName:'Jane'}],publisher:'Press'}}]);
  assert.ok(ris.startsWith('TY  - BOOK\r\n'));
  assert.ok(ris.includes('AU  - Doe, Jane\r\n'));
  assert.equal((ris.match(/^TY  -/gm)||[]).length,1);
  assert.ok(!ris.includes('DO  -'));
});
