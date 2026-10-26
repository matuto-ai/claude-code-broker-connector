import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ApprovalSession} from '../src/approval-session.mjs';
const pending={state:'pending',requestId:'same-request',requestExpiresAt:new Date(Date.now()+60000).toISOString()};
function fixture(overrides={}){let begins=0,polls=0,attachments=0;const instance=new ApprovalSession({
 beginApproval:async()=>{begins++;return pending;},pollApproval:async()=>{polls++;return pending;},readApprovalState:()=>pending,
 onApproved:async()=>{attachments++;return {connected:true};},isCurrent:()=>true,intervalMs:10,...overrides});return {instance,counts:()=>({begins,polls,attachments})};}
test('startup is inert; explicit setup polls same request and never begins again after network failures',async t=>{
 let polls=0;const f=fixture({pollApproval:async()=>{polls++;if(polls===1)throw Error('network');return {...pending,state:'approved',connectionFile:'/private/file',credentialId:'private-id'};}});t.after(()=>f.instance.cancel());
 await delay(20);assert.deepEqual(f.counts(),{begins:0,polls:0,attachments:0});
 assert.equal((await f.instance.start({brokerUrl:'https://broker.invalid'})).state,'pending');
 for(let i=0;i<30&&!f.instance.status.connected;i++)await delay(10);
 assert.equal(f.instance.status.connected,true);assert.equal(f.counts().begins,1);assert.equal(f.counts().attachments,1);assert.equal(polls,2);
 assert(!JSON.stringify(f.instance.status).includes('/private/'));assert(!JSON.stringify(f.instance.status).includes('private-id'));
});
test('cancel during pending begin fences late approval without attaching',async()=>{
 let release;const f=fixture({beginApproval:()=>new Promise(r=>release=r)});const started=f.instance.start({});f.instance.cancel();release({...pending,state:'approved'});
 assert.equal((await started).state,'cancelled');assert.equal(f.counts().attachments,0);
});
test('explicit replacement supplies exact prior request and terminal denial does not poll',async t=>{
 let options;const f=fixture({beginApproval:async x=>{options=x;return {...pending,state:'denied'};}});t.after(()=>f.instance.cancel());
 assert.equal((await f.instance.start({brokerUrl:'https://broker.invalid'},{replace:true})).state,'denied');assert.equal(options.replaceRequestId,pending.requestId);await delay(30);assert.equal(f.counts().polls,0);assert.equal(f.counts().attachments,0);
});
test('native lifetime ending fences poll approval',async t=>{
 let live=true,release;const f=fixture({isCurrent:()=>live,pollApproval:()=>new Promise(r=>release=r)});t.after(()=>f.instance.cancel());await f.instance.start({});
 for(let i=0;i<30&&!release;i++)await delay(5);assert(release);live=false;release({...pending,state:'approved'});await delay(10);assert.equal(f.counts().attachments,0);
});

test('restart resumes only existing pending request via polling, never begin',async t=>{
 const f=fixture({pollApproval:async()=>({...pending,state:'approved'})});t.after(()=>f.instance.cancel());
 assert.equal((await f.instance.resume({})).state,'pending');for(let i=0;i<30&&!f.instance.status.connected;i++)await delay(10);
 assert.equal(f.instance.status.connected,true);assert.equal(f.counts().begins,0);
 const missing=fixture({readApprovalState:()=>null});t.after(()=>missing.instance.cancel());assert.equal((await missing.instance.resume({})).state,'not_started');await delay(20);assert.deepEqual(missing.counts(),{begins:0,polls:0,attachments:0});
});

test('nonretryable configuration failure and approved attach failure stop polling',async t=>{
 let polls=0;const f=fixture({pollApproval:async()=>{polls++;throw Object.assign(Error('private config'),{retryable:false});}});t.after(()=>f.instance.cancel());await f.instance.start({});await delay(40);assert.equal(polls,1);assert.equal(f.instance.status.connection,'blocked');
 const applied=fixture({pollApproval:async()=>({...pending,state:'approved'}),onApproved:async()=>{throw Error('attach failure');}});t.after(()=>applied.instance.cancel());await applied.instance.start({});await delay(30);assert.equal(applied.instance.status.state,'approved');assert.equal(applied.instance.status.error,'approved_installation_not_applied');assert.equal(applied.instance.status.connected,false);
});

test('host polling respects retryAfterMs and cancellation clears the delayed retry',async t=>{
 let polls=0;const f=fixture({pollApproval:async()=>{polls++;throw Object.assign(Error('rate limit'),{retryable:true,retryAfterMs:1000});}});t.after(()=>f.instance.cancel());await f.instance.start({});await delay(100);assert.equal(polls,1);f.instance.cancel();await delay(30);assert.equal(polls,1);
});
