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
 let options;const f=fixture({readApprovalState:()=>({...pending,state:'approved'}),beginApproval:async x=>{options=x;return {...pending,state:'denied'};}});t.after(()=>f.instance.cancel());
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

test('uncertain initial POST resumes the durable request with GET only in the same session', async t => {
 let durable = null, begins = 0, polls = 0;
 const error = Object.assign(Error('private transport details'), { retryable: true, effect: 'unknown' });
 const states = [];
 const f = fixture({
  readApprovalState: () => durable,
  beginApproval: async () => { begins++; durable = { ...pending, token: 'private-candidate' }; throw error; },
  pollApproval: async () => { polls++; return { ...durable, state: 'approved' }; },
  onState: state => states.push(state),
 });
 t.after(() => f.instance.cancel());
 await assert.rejects(f.instance.start({}), thrown => thrown === error);
 assert.equal(f.instance.status.state, 'pending');
 assert.equal(f.instance.status.requestId, pending.requestId);
 assert.equal(f.instance.status.connection, 'temporarily_unavailable');
 for (let i = 0; i < 30 && !f.instance.status.connected; i++) await delay(10);
 assert.equal(f.instance.status.connected, true);
 assert.equal(begins, 1);
 assert.equal(polls, 1);
 assert.doesNotMatch(JSON.stringify(states), /private-candidate|private transport details/);
});

test('initial POST recovery honors retry-after before GET reconciliation', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 let begins = 0, polls = 0;
 const error = Object.assign(Error('rate_limited'), { retryable: true, retryAfterMs: 3000 });
 const f = fixture({
  beginApproval: async () => { begins++; throw error; },
  pollApproval: async () => { polls++; return { ...pending, state: 'denied' }; },
 });
 t.after(() => f.instance.cancel());
 await assert.rejects(f.instance.start({}), thrown => thrown === error);
 t.mock.timers.tick(2999);
 assert.equal(polls, 0);
 t.mock.timers.tick(1);
 await Promise.resolve();
 assert.equal(polls, 1);
 assert.equal(f.instance.status.state, 'denied');
 t.mock.timers.tick(10000);
 assert.equal(polls, 1);
 assert.equal(begins, 1);
});

test('initial POST recovery clamps backoff and cancellation clears it', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 for (const [hint, wait] of [[-1, 1000], [600000, 300000]]) {
  let polls = 0;
  const f = fixture({ beginApproval: async () => { throw Object.assign(Error('offline'), { retryable: true, retryAfterMs: hint }); },
   pollApproval: async () => { polls++; return pending; } });
  await assert.rejects(f.instance.start({}));
  t.mock.timers.tick(wait - 1);
  assert.equal(polls, 0);
  f.instance.cancel();
  t.mock.timers.tick(wait + 1);
  assert.equal(polls, 0);
 }
});

test('initial POST recovery refuses missing, corrupt and terminal durable candidates', async t => {
 for (const saved of [null, 'corrupt', { ...pending, state: 'denied' }, { ...pending, state: 'expired' }, { ...pending, state: 'approved' }]) {
  let reads = 0, polls = 0;
  const error = Object.assign(Error('offline'), { retryable: true, effect: 'unknown' });
  const f = fixture({ readApprovalState: () => { if (++reads === 1) return null; if (saved === 'corrupt') throw Error('private corrupt file'); return saved; },
   beginApproval: async () => { throw error; }, pollApproval: async () => { polls++; return pending; } });
  t.after(() => f.instance.cancel());
  await assert.rejects(f.instance.start({}), thrown => thrown === error);
  assert.equal(f.instance.timer, null);
  assert.equal(polls, 0);
  assert.equal(f.counts().attachments, 0);
 }
});

test('terminal or unclassified initial POST errors never start automatic recovery', async t => {
 for (const retryable of [false, undefined]) {
  let reads = 0;
  const error = Object.assign(Error('forbidden'), { retryable });
  const f = fixture({ readApprovalState: () => { reads++; return pending; }, beginApproval: async () => { throw error; } });
  t.after(() => f.instance.cancel());
  await assert.rejects(f.instance.start({}), thrown => thrown === error);
  assert.equal(reads, 1);
  assert.equal(f.instance.timer, null);
 }
});

test('cancelled or departed native intent cannot resume a late failed POST', async t => {
 for (const action of ['cancel', 'depart']) {
  let reject, live = true;
  const error = Object.assign(Error('late network failure'), { retryable: true });
  const f = fixture({ isCurrent: () => live, beginApproval: () => new Promise((_, fail) => { reject = fail; }) });
  t.after(() => f.instance.cancel());
  const started = f.instance.start({});
  if (action === 'cancel') f.instance.cancel(); else live = false;
  reject(error);
  await assert.rejects(started, thrown => thrown === error);
  assert.equal(f.instance.timer, null);
  assert.equal(f.counts().polls, 0);
  assert.equal(f.counts().attachments, 0);
 }
});

test('recovered pending state stops on terminal GET failure without another POST', async t => {
 let begins = 0, polls = 0;
 const f = fixture({ beginApproval: async () => { begins++; throw Object.assign(Error('lost response'), { retryable: true }); },
  pollApproval: async () => { polls++; throw Object.assign(Error('not found'), { retryable: false }); } });
 t.after(() => f.instance.cancel());
 await assert.rejects(f.instance.start({}));
 for (let i = 0; i < 30 && f.instance.status.connection !== 'blocked'; i++) await delay(10);
 assert.equal(f.instance.status.connection, 'blocked');
 await delay(30);
 assert.equal(begins, 1);
 assert.equal(polls, 1);
 assert.equal(f.counts().attachments, 0);
});
