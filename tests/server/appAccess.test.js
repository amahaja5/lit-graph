import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/src/index.js';
import { handleCitationImport } from '../../lib/citationImportHandler.js';
import auditHandler from '../../api/audit/[action].js';

test('hosted import and audit routes reject anonymous and legacy bearer access before processing', async t => {
  const oldMode=process.env.APP_AUTH_MODE, oldToken=process.env.AUDIT_ACCESS_TOKEN;
  process.env.APP_AUTH_MODE='zotero';process.env.AUDIT_ACCESS_TOKEN='legacy-token';
  t.after(()=>{ for(const [key,value] of [['APP_AUTH_MODE',oldMode],['AUDIT_ACCESS_TOKEN',oldToken]]) {if(value===undefined)delete process.env[key];else process.env[key]=value;} });
  let calls=0;
  const oauth={session:()=>null,assertOrigin:()=>{throw Error('Must not reach');}};
  const service={extract:()=>{calls++;return {};},status:()=>{calls++;return {};}};
  const server=createApp({zoteroOAuth:oauth,citationImport:service,auditService:service,serveFrontend:false}).listen(0,'127.0.0.1');
  await once(server,'listening');t.after(()=>server.close());
  for(const path of ['import/status','audit/status','import/extract','audit/extract']){
    const isPost=path.endsWith('extract');
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:isPost?'POST':'GET',headers:{Authorization:'Bearer legacy-token','Content-Type':'application/json'},body:isPost?'{}':undefined});
    assert.equal(response.status,401);assert.equal((await response.json()).error.code,'app_signin_required');
  }
  const response=()=>({code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
  const req={method:'POST',headers:{authorization:'Bearer legacy-token'},query:{action:'extract'},body:{}};
  const importRes=response();await handleCitationImport(req,importRes,'extract',{oauth,service});assert.equal(importRes.code,401);
  const auditRes=response();await auditHandler(req,auditRes);assert.equal(auditRes.code,401);
  assert.equal(calls,0);
});
