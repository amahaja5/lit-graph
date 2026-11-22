import test from 'node:test';
import assert from 'node:assert/strict';

test('one import action extracts, looks up and saves clear matches; uncertain references are not written', async () => {
  class Element {
    constructor() { this.value='';this.files=[];this.checked=false;this.dataset={};this.children=[];this.listeners={};this.classList={toggle(){}}; }
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(name,value){this[name]=String(value);}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    add(node){this.children.push(node);}
  }
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const events={};
  const originals={document:globalThis.document,window:globalThis.window,Option:globalThis.Option,fetch:globalThis.fetch};
  globalThis.document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>text,querySelectorAll:()=>[]};
  const dispatched=[];
  globalThis.window={addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:e=>dispatched.push(e.type)};
  globalThis.location={hash:''};
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
  const calls=[];
  const title='A detailed study of sampling';
  globalThis.fetch=async (url,options)=>{
    const body=options.body ? JSON.parse(options.body):null;calls.push({url,body});
    if(url==='/api/import/status')return Response.json({grobidConfigured:true});
    if(url==='/api/import/warm')return Response.json({state:'starting'});
    if(url==='/api/zotero/status')return Response.json({configured:true,connected:true,writeRequested:true,userId:'123'});
    if(url.endsWith('/extract'))return Response.json({filename:'paper.pdf',references:[{title,bibliography:`Doe (2020). ${title}`,doi:'10.1234/one'},{title:'Unrelated reference',bibliography:'Unrelated reference',doi:''}]});
    if(url.endsWith('/lookup'))return Response.json({match:'doi',candidates:[{title,doi:'10.1234/one',authors:'Jane Doe',year:'2020',item:{creators:[{lastName:'Doe'}]}}]});
    if(url.endsWith('/collection'))return Response.json({key:'ABCD1234',url:'https://www.zotero.org/users/123/collections/ABCD1234/items'});
    if(url.endsWith('/save'))return Response.json({key:'ITEM1234',reused:false});
    throw new Error('Unexpected route '+url);
  };
  try {
    await import('../../frontend/src/citation-import/citationImport.js');
    get('import-consent').checked=true;
    get('import-file').files=[new File(['%PDF-1.4 test manuscript'],'paper.pdf',{type:'application/pdf'})];
    await get('import-refresh').listeners.click();
    await get('import-extract').listeners.click();
    assert.equal(calls.filter(c=>c.url==='/api/import/warm').length,1,'signed-in load and panel refresh warm GROBID once');
    assert.deepEqual(calls.filter(c=>!c.url.endsWith('/status')&&!c.url.endsWith('/warm')).map(c=>c.url),['/api/import/extract','/api/import/lookup','/api/import/lookup','/api/import/collection','/api/import/save']);
    assert.equal(calls.find(c=>c.url.endsWith('/save')).body.doi,'10.1234/one');
    assert.match(get('import-status').textContent,/Saved 1 references.*1 need review/);
    assert.equal(get('import-next').hidden,false,'saved items offer the citation check');
    get('import-check').listeners.click();
    const { takeAuditHandoff } = await import('../../frontend/src/shared/auditHandoff.js');
    const handoff=takeAuditHandoff();
    assert.deepEqual(dispatched,['litgraph-audit-handoff']); assert.equal(location.hash,'audit');
    assert.equal(handoff.manuscript.file.name,'paper.pdf'); assert.match(atob(handoff.manuscript.file.base64),/^%PDF-1\.4 test manuscript$/);
    assert.equal(handoff.collection.key,'ABCD1234');
    assert.deepEqual(handoff.references,[{bibliography:`Doe (2020). ${title}`,title,sourceTitle:title,doi:'10.1234/one',zoteroKey:'ITEM1234'}]);
  } finally { Object.assign(globalThis,originals); delete globalThis.location; }
});

test('signed-out users see Zotero sign-in without fetching protected import status', async () => {
  class Element {
    constructor(){this.listeners={};this.classList={toggle(){}};this.files=[];this.checked=false;this.value='';}
    addEventListener(name,fn){this.listeners[name]=fn;}
  }
  const elements=new Map(); const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const originals={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  globalThis.document={getElementById:get,querySelectorAll:()=>[]};
  globalThis.window={addEventListener(){}};
  const calls=[];
  globalThis.fetch=async url=>{calls.push(url);assert.equal(url,'/api/zotero/status');return Response.json({appLogin:true,configured:true,connected:false});};
  try {
    await import('../../frontend/src/citation-import/citationImport.js?signed-out');
    await get('import-refresh').listeners.click();
    assert.match(get('import-zotero-status').textContent,/Sign in with Zotero \(top right\)/);
    assert.equal(get('import-extract').disabled,true);
    assert.ok(calls.length&&calls.every(url=>url==='/api/zotero/status'),'signed-out users never warm GROBID');
    assert.match(get('import-connection-status').textContent,/Sign in/);
    assert.equal(elements.has('import-token'),false);
  } finally { Object.assign(globalThis,originals); }
});

test('lookups run in parallel within reported Crossref limits and recover from a 429', async () => {
  class Element {
    constructor() { this.value='';this.files=[];this.checked=false;this.dataset={};this.children=[];this.listeners={};this.classList={toggle(){}}; }
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(name,value){this[name]=String(value);}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    add(node){this.children.push(node);}
  }
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const originals={document:globalThis.document,window:globalThis.window,Option:globalThis.Option,fetch:globalThis.fetch};
  globalThis.document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>text,querySelectorAll:()=>[]};
  globalThis.window={addEventListener(){}};
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
  const refs=Array.from({length:6},(_,i)=>({title:`Reference number ${i} about sampling`,bibliography:`Doe (2020). Reference number ${i} about sampling`,doi:''}));
  let lookups=0,inFlight=0,maxInFlight=0,limited=false;
  globalThis.fetch=async (url,options)=>{
    const body=options.body?JSON.parse(options.body):null;
    if(url==='/api/zotero/status')return Response.json({configured:true,connected:false});
    if(url==='/api/import/status')return Response.json({grobidConfigured:true});
    if(url==='/api/import/warm')return Response.json({state:'unconfigured'});
    if(url.endsWith('/extract'))return Response.json({filename:'paper.txt',references:refs});
    if(url.endsWith('/lookup')){
      lookups++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
      await new Promise(r=>setTimeout(r,300));inFlight--;
      if(lookups===4&&!limited){limited=true;return Response.json({error:{message:'The provider is busy. Wait before retrying.',retryAfterSeconds:1}},{status:429});}
      const title=body.bibliography.replace(/^Doe \(2020\)\. /,'');
      return Response.json({match:'candidate',rateLimit:{limit:10,intervalMs:1000,concurrency:3},candidates:[{title,doi:`10.1234/${lookups}`,authors:'Jane Doe',year:'2020',item:{creators:[{lastName:'Doe'}]}}]});
    }
    throw new Error('Unexpected route '+url);
  };
  try {
    await import('../../frontend/src/citation-import/citationImport.js?parallel');
    get('import-consent').checked=true; get('import-file').files=[new File(['%PDF-1.4 test manuscript'],'paper.pdf',{type:'application/pdf'})];
    await get('import-refresh').listeners.click();
    await get('import-extract').listeners.click();
    assert.ok(maxInFlight>=2,`expected parallel lookups, saw ${maxInFlight}`);
    assert.equal(lookups,7,'six references plus one retry after the 429');
    // Clear matches leave the default "Needs attention" view; chips, summary and the bar report them.
    const chips=()=>elements.get('import-filters').children.map(c=>c.textContent);
    assert.deepEqual(chips(),['Needs attention (0)','Ready to save (6)','All (6)']);
    assert.deepEqual(elements.get('import-references').children.map(c=>c.textContent),['Nothing needs your attention.']);
    assert.match(get('import-summary').textContent,/6 ready to save · sign in to Zotero to save/);
    assert.equal(get('import-save').textContent,'Save 6 to Zotero'); assert.equal(get('import-save').disabled,true);
    elements.get('import-filters').children.find(c=>c.textContent==='All (6)').listeners.click();
    assert.equal(elements.get('import-references').children.length,6);
    assert.equal(get('import-setup').hidden,true,'the upload form collapses once references are loaded');
    assert.equal(get('import-loaded-name').textContent,'paper.txt · 6 references');
    assert.doesNotMatch(get('import-status').textContent,/busy|failed/i);
    assert.match(get('import-status').textContent,/Connect Zotero to finish/);
  } finally { Object.assign(globalThis,originals); }
});

test('a rate-limited Zotero save waits and continues instead of stopping the import', async () => {
  class Element {
    constructor() { this.value='';this.files=[];this.checked=false;this.dataset={};this.children=[];this.listeners={};this.classList={toggle(){},add(){},remove(){}}; }
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(name,value){this[name]=String(value);}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    add(node){this.children.push(node);}
  }
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const originals={document:globalThis.document,window:globalThis.window,Option:globalThis.Option,fetch:globalThis.fetch};
  globalThis.document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>text,querySelectorAll:()=>[]};
  globalThis.window={addEventListener(){}};
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
  const refs=Array.from({length:3},(_,i)=>({title:`Clear reference number ${i} on sampling`,bibliography:`Doe (2020). Clear reference number ${i} on sampling`,doi:''}));
  let saves=0,limited=false;const statuses=[];
  globalThis.fetch=async (url,options)=>{
    const body=options.body?JSON.parse(options.body):null;
    if(url==='/api/zotero/status')return Response.json({configured:true,connected:true,writeRequested:true,userId:'123'});
    if(url==='/api/import/status')return Response.json({grobidConfigured:true});
    if(url==='/api/import/warm')return Response.json({state:'unconfigured'});
    if(url.endsWith('/extract'))return Response.json({filename:'paper.txt',references:refs});
    if(url.endsWith('/lookup')){const title=body.bibliography.replace(/^Doe \(2020\)\. /,'');return Response.json({match:'candidate',rateLimit:{limit:10,intervalMs:1000,concurrency:3},candidates:[{title,doi:'10.1234/'+title.length+title.slice(-12),authors:'Jane Doe',year:'2020',item:{creators:[{lastName:'Doe'}]}}]});}
    if(url.endsWith('/collection'))return Response.json({key:'ABCD1234',url:'https://www.zotero.org/users/123/collections/ABCD1234/items'});
    if(url.endsWith('/save')){
      statuses.push(get('import-status').textContent);
      if(saves===1&&!limited){limited=true;return Response.json({error:{message:'Zotero is limiting requests.',retryAfterSeconds:1}},{status:429});}
      saves++;return Response.json({key:'ITEM'+saves+'XYZ',reused:false});
    }
    throw new Error('Unexpected route '+url);
  };
  try {
    await import('../../frontend/src/citation-import/citationImport.js?save-retry');
    get('import-consent').checked=true; get('import-file').files=[new File(['%PDF-1.4 test manuscript'],'paper.pdf',{type:'application/pdf'})];
    await get('import-refresh').listeners.click();
    await get('import-extract').listeners.click();
    assert.equal(saves,3,'all three saved after one rate-limited attempt');
    assert.ok(limited);
    assert.match(get('import-status').textContent,/Saved 3 references/);
  } finally { Object.assign(globalThis,originals); }
});
