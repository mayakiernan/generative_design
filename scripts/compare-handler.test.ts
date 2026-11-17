import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleCompare,parseRequest} from './compare-handler.js';
import {passwordOk} from './password.js';

const basic=(pass:string)=>`Basic ${btoa(`anyone:${pass}`)}`;
const req=(headers:Record<string,string>,body:unknown={prompt:'a bridge',models:['sonnet']})=>new Request('https://site.test/api/compare',{method:'POST',headers:{host:'site.test','content-type':'application/json',origin:'https://site.test',...headers},body:JSON.stringify(body)});

test('password check: any username, exact password, open only in local dev when unset',()=>{
 const r=(h?:string)=>new Request('https://site.test/',{headers:h?{authorization:h}:{}});
 assert.equal(passwordOk(r(basic('s3cret')),'s3cret',true),true);
 assert.equal(passwordOk(r(basic('s3cre')),'s3cret',true),false);
 assert.equal(passwordOk(r(basic('s3cret:x')),'s3cret',true),false);
 assert.equal(passwordOk(r(),'s3cret',true),false);
 assert.equal(passwordOk(r('Basic !!!'),'s3cret',true),false);
 assert.equal(passwordOk(r(),undefined,true),false);
 assert.equal(passwordOk(r(),undefined,false),true);
});

test('request parsing cleans input and rejects bad limits',()=>{
 assert.deepEqual(parseRequest({prompt:'  bridge ',models:['opus','gpt'],constraints:{maxConnectors:25,freestanding:true}}),
  {prompt:'bridge',models:['opus'],effort:'high',repairs:2,constraints:{maxConnectors:25,maxRods:undefined,gapMm:undefined,freestanding:true}});
 assert.equal(parseRequest({prompt:'',models:['opus']}),'Write a brief first.');
 assert.equal(parseRequest({prompt:'x',models:[]}),'Pick at least one model.');
 assert.match(parseRequest({prompt:'x',models:['opus'],constraints:{maxConnectors:-1}}) as string,/positive/);
 assert.match(parseRequest({prompt:'x',models:['opus'],constraints:{maxConnectors:500}}) as string,/up to 100/);
 assert.equal((parseRequest({prompt:'x',models:['opus'],effort:'ultra',repairs:9}) as {effort:string}).effort,'high');
});

test('endpoint refuses before spending anything: password, origin, key',async()=>{
 const env={apiKey:'test-key',password:'s3cret',deployed:true};
 assert.equal((await handleCompare(req({}),env)).status,401);
 assert.equal((await handleCompare(req({authorization:basic('s3cret'),origin:'https://evil.test'}),env)).status,403);
 assert.equal((await handleCompare(req({authorization:basic('s3cret'),'content-type':'text/plain'}),env)).status,403);
 assert.equal((await handleCompare(req({authorization:basic('s3cret')},{prompt:'',models:['opus']}),env)).status,400);
 assert.equal((await handleCompare(req({authorization:basic('s3cret')}),{...env,apiKey:undefined})).status,500);
 assert.equal((await handleCompare(req({}),{deployed:true,apiKey:'k'})).status,401);
 assert.equal((await handleCompare(new Request('https://site.test/api/compare'),env)).status,405);
});
