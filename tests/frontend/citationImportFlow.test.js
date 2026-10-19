import test from 'node:test';
import assert from 'node:assert/strict';

test('one import action extracts, looks up and saves clear matches; uncertain references are not written', async () => {
  class Element {
    constructor() { this.value='';this.files=[];this.checked=false;this.dataset={};this.children=[];this.listeners={};this.classList={toggle(){}}; }
    addEventListener(name,fn){this.listeners[name]=fn;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    add(node){this.children.push(node);}
  }
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const events={};
  const originals={document:globalThis.document,window:globalThis.window,Option:globalThis.Option,fetch:globalThis.fetch};
  globalThis.document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>text,querySelectorAll:()=>[]};
  globalThis.window={addEventListener:(name,fn)=>events[name]=fn};
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
  const calls=[];
  const title='A detailed study of sampling';
  globalThis.fetch=async (url,options)=>{
    const body=options.body ? JSON.parse(options.body):null;calls.push({url,body});
    if(url==='/api/import/status')return Response.json({grobidConfigured:true});
    if(url==='/api/zotero/status')return Response.json({configured:true,connected:true,writeRequested:true,userId:'123'});
    if(url.endsWith('/extract'))return Response.json({filename:'paper.pdf',references:[{title,bibliography:`Doe (2020). ${title}`,doi:'10.1234/one'},{title:'Unrelated reference',bibliography:'Unrelated reference',doi:''}]});
    if(url.endsWith('/lookup'))return Response.json({match:'doi',candidates:[{title,doi:'10.1234/one',authors:'Jane Doe',year:'2020',item:{creators:[{lastName:'Doe'}]}}]});
    if(url.endsWith('/collection'))return Response.json({key:'ABCD1234',url:'https://www.zotero.org/users/123/collections/ABCD1234/items'});
    if(url.endsWith('/save'))return Response.json({key:'ITEM1234',reused:false});
    throw new Error('Unexpected route '+url);
  };
  try {
    await import('../../frontend/src/ui/citationImport.js');
    get('import-consent').checked=true;
    get('import-text').value='A public bibliography';
    await get('import-refresh').listeners.click();
    await get('import-extract').listeners.click();
    assert.deepEqual(calls.filter(c=>!c.url.endsWith('/status')).map(c=>c.url),['/api/import/extract','/api/import/lookup','/api/import/lookup','/api/import/collection','/api/import/save']);
    assert.equal(calls.find(c=>c.url.endsWith('/save')).body.doi,'10.1234/one');
    assert.match(get('import-status').textContent,/Saved 1 references.*1 need review/);
  } finally { Object.assign(globalThis,originals); }
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
    await import('../../frontend/src/ui/citationImport.js?signed-out');
    await get('import-refresh').listeners.click();
    assert.equal(get('import-zotero-connect').disabled,false);
    assert.equal(get('import-extract').disabled,true);
    assert.deepEqual(calls,['/api/zotero/status']);
    assert.match(get('import-connection-status').textContent,/Sign in/);
    assert.equal(elements.has('import-token'),false);
  } finally { Object.assign(globalThis,originals); }
});
