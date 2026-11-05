import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate as settle } from 'node:timers/promises';
import { processIdentity } from '../src/launch-state.mjs';
import { pluginHook, hostDirectory, readBinding } from '../src/plugin-state.mjs';
import { associateNativeBinding } from '../src/native-binding.mjs';
import { createPluginEpoch } from '../src/plugin-epoch.mjs';
import { createCooperativeInbox } from '../src/cooperative-inbox.mjs';
import { BrokerClient, BrokerError } from '../vendor/psst/reference/client.mjs';
import { AdapterRuntime } from '../vendor/psst/reference/runtime.mjs';
import { LocalError } from '../vendor/psst/reference/errors.mjs';

async function until(predicate) {
 for(let i=0;i<100;i++){if(predicate())return;await settle();}
 assert.fail('transport did not reach the expected state');
}

function fixture(t,{completionFailures=0}={}) {
 const root=mkdtempSync(join(tmpdir(),'claude-transport-'));
 const nativeConfig={stateRoot:join(root,'native')},host=processIdentity(process.pid),sessionId=randomUUID();
 pluginHook(nativeConfig,{hook_event_name:'SessionStart',session_id:sessionId},host);
 associateNativeBinding({nativeConfig,host,sessionId});
 const {directory}=hostDirectory(nativeConfig,host),binding=readBinding(directory);
 const sleepers=new Set(),requests=[],completions=[];
 let client,runtime,owned,poll,replay,available=true,stale=false,heartbeatSuccesses=0,now=Date.now();
 const unavailable=()=>new LocalError('request_failed',{effect:'unknown',retryable:true});
 const sleep=(ms,unused,{signal}={})=>new Promise((resolve,reject)=>{
  const done=error=>{sleepers.delete(entry);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
  const abort=()=>done(new LocalError('request_aborted'));
  const entry={ms,wake:()=>done()};sleepers.add(entry);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 });
 class FaultClient extends BrokerClient {
  constructor(options){super({...options,maxAttempts:1});client=this;}
  async requestOnce(method,path,options){
   requests.push({method,path,key:options.key,heartbeatSuccesses});
   if(!available)throw unavailable();
   if(path==='/v1/sessions'&&method==='POST'){
    const body=options.body;
    if(owned?.connection_id!==body.connection_id)owned={...body,lease_epoch:(owned?.lease_epoch??0)+1};
    stale=false;
    return {client_id:this.identity.client_id,lease_epoch:owned.lease_epoch,metadata_revision:1,policy:{heartbeat_interval_seconds:1}};
   }
   const state=()=>({...owned,metadata_revision:1,connected:!stale,lease_expires_at:new Date(Date.now()+60000).toISOString(),server_time:new Date().toISOString()});
   if(method==='GET'&&path===`/v1/sessions/${this.identity.client_id}`)return state();
   if(stale||this.attachment.lease_epoch!==owned.lease_epoch)throw new BrokerError(409,{error:{code:'stale_lease_epoch',effect:'not_applied'}});
   if(path.endsWith('/heartbeat')){heartbeatSuccesses++;return state();}
   if(path==='/v1/mailbox/claim'){
    if(replay?.key===options.key)return replay.value;
    assert.equal(poll,undefined,'only one mailbox poll may own the transport');
    return new Promise((resolve,reject)=>{
     const done=(error,value)=>{options.signal?.removeEventListener('abort',abort);poll=undefined;error?reject(error):resolve(value);};
     const abort=()=>done(new LocalError('request_aborted'));
     poll={fail:error=>done(error),deliver:envelope=>{
      replay={key:options.key,value:{claim_id:randomUUID(),lease_epoch:owned.lease_epoch,attempt:1,claim_expires_at:new Date(Date.now()+60000).toISOString(),envelope}};
      done(null,replay.value);
     },empty:()=>done(null,null)};
     if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
    });
   }
   if(path.endsWith('/complete')){
    assert(client.inbox.head(),'durable inbox storage must precede transport completion');
    if(completionFailures-->0)throw unavailable();
    completions.push(options.body);replay=undefined;return {};
   }
   assert.fail(`unexpected broker operation: ${method} ${path}`);
  }
 }
 class SupervisedRuntime extends AdapterRuntime {
  constructor(options){super({...options,sleep,random:()=>0.5,now:()=>now});runtime=this;}
 }
 const config={brokerUrl:'https://broker.invalid',tokenFile:join(root,'unused-token'),name:'fault-fixture',project:null};
 const epoch=createPluginEpoch({directory,binding,host,nativeConfig,legacyConfig:config,dependencies:{BrokerClient:FaultClient,AdapterRuntime:SupervisedRuntime,createTools:()=>({}),createCooperativeInbox}});
 t.after(async()=>{await epoch.retire({closeSession:false});rmSync(root,{recursive:true,force:true});});
 return {epoch,requests,completions,get client(){return client;},get runtime(){return runtime;},get poll(){return poll;},
  async wake(){now+=Math.max(1000,...[...sleepers].map(s=>s.ms));for(const sleeper of [...sleepers])sleeper.wake();await settle();},
  changeSession(){const next=randomUUID();pluginHook(nativeConfig,{hook_event_name:'SessionStart',session_id:next},host);associateNativeBinding({nativeConfig,host,sessionId:next});},
  outage(){available=false;poll?.fail(unavailable());},
  restart(){available=true;stale=true;},
  message(){return {protocol_version:'1',message_id:randomUUID(),recipient_id:client.identity.client_id,recipient_sequence:1,
   sender:{client_id:randomUUID(),client_type:'pi',name:'peer',model:{provider:null,id:null,source:'unknown'},project:null,metadata_revision:1},
   origin:'broker_agent',authority:'untrusted_agent_input',content:{type:'text/plain',text:'queued during outage'},
   accepted_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),correlation_id:null,reply_to_message_id:null};},
 };
}

test('native epoch automatically resumes its inbox after broker outage, without connect or read ACK',async t=>{
 const f=fixture(t),identity=await f.epoch.tools.broker_connect({});
 assert(identity.client_id);await until(()=>f.poll);
 const client=f.client,inbox=client.inbox,firstKey=inbox.getState('claim_pending').key;
 const sendKey=client.prepareSend({recipient_id:randomUUID(),content:{type:'text/plain',text:'retain ambiguous outgoing intent'}});
 inbox.markOutgoingAttempt(sendKey);const pending=inbox.outgoing(sendKey);
 f.outage();await until(()=>f.runtime.status().recovery==='retry_waiting');
 assert.equal((await f.epoch.tools.broker_identity()).readiness,'transport_retry_waiting');
 const registrationCount=()=>f.requests.filter(r=>r.method==='POST'&&r.path==='/v1/sessions').length;
 for(let i=0;i<6;i++)await f.wake();
 assert.equal(registrationCount(),1,'unreachable supervision must not repeatedly register');
 assert.equal(inbox.getState('claim_pending').key,firstKey);
 f.restart();
 for(let i=0;i<8&&!f.poll;i++)await f.wake();
 await until(()=>f.poll);
 assert.equal(registrationCount(),2,'validated stale lease restores the owned session without replacement approval');
 assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path==='/v1/sessions').at(-1).heartbeatSuccesses,0,'reconciliation must not wait for an impossible successful heartbeat');
 const message=f.message();f.poll.deliver(message);
 await until(()=>inbox.head());
 assert.equal(f.client,client);assert.equal(client.inbox,inbox);
 assert.equal((await f.epoch.tools.broker_identity()).client_id,identity.client_id);
 assert.deepEqual(inbox.outgoing(sendKey),pending,'recovery preserves the original uncertain send and retry key');
 assert.equal(inbox.head().state,'pending','transport recovery is not a model read ACK');
 await until(()=>f.completions.length===1);
 assert.equal(f.completions[0].outcome,'delivered');
 const status=await f.epoch.tools.broker_identity();
 assert.equal(status.transport.error_code,null);assert.equal(status.transport.recovery,'idle');
 assert(!['transport_retry_waiting','blocked_transport'].includes(status.readiness));
 assert.equal((await f.epoch.tools.broker_setup_status()).transport.error_code,null);
 await f.epoch.tools.broker_disconnect({});
 const requests=f.requests.length;await f.wake();await settle();
 assert.equal(f.requests.length,requests,'explicit disconnect fences all old supervision');
});

test('an uncertain delivery completion reuses the pending claim without duplicating inbox data',async t=>{
 const f=fixture(t,{completionFailures:1});await f.epoch.tools.broker_connect({});await until(()=>f.poll);
 const claimKey=f.client.inbox.getState('claim_pending').key,message=f.message();
 f.poll.deliver(message);await until(()=>f.runtime.status().recovery==='retry_waiting');
 assert.equal(f.client.inbox.head().state,'pending');
 for(let i=0;i<8&&f.completions.length===0;i++)await f.wake();
 await until(()=>f.completions.length===1);
 const attempts=f.requests.filter(r=>r.path==='/v1/mailbox/claim'&&r.key===claimKey);
 assert.equal(attempts.length,2,'ambiguous claim is retried using the original idempotency key');
 assert.equal(f.client.inbox.head().message_id,message.message_id);
 assert.equal((await f.epoch.tools.broker_receive()).message_id,message.message_id);
 assert.equal((await f.epoch.tools.broker_acknowledge({message_id:message.message_id})).acknowledged,true);
 assert.equal(f.client.inbox.head(),null,'one explicit read ACK consumes exactly one stored message');
 assert.equal(f.runtime.status().error_code,null);
});

test('a native-session change fences queued transport recovery',async t=>{
 const f=fixture(t);await f.epoch.tools.broker_connect({});await until(()=>f.poll);
 f.outage();await until(()=>f.runtime.status().recovery==='retry_waiting');
 f.changeSession();f.restart();
 await f.wake();await until(()=>f.runtime.closed);
 const requests=f.requests.length;await f.wake();
 assert.equal(f.requests.length,requests);
 assert.equal((await f.epoch.tools.broker_identity()).error.code,'session_changed');
});

test('heartbeat supervision recovers a receive-only transient failure, but not a protocol blocker or human pause',async t=>{
 const f=fixture(t);await f.epoch.tools.broker_connect({});await until(()=>f.poll);
 f.poll.fail(new LocalError('request_failed',{effect:'unknown',retryable:true}));
 await until(()=>f.runtime.status().recovery==='retry_waiting');
 for(let i=0;i<8&&!f.poll;i++)await f.wake();
 await until(()=>f.poll);f.poll.empty();await until(()=>f.poll);
 assert.equal(f.runtime.status().error_code,null,'an empty successful mailbox poll is healthy');
 f.runtime.pauseReceiving(true);
 await until(()=>!f.poll);
 const claims=()=>f.requests.filter(r=>r.path==='/v1/mailbox/claim').length;
 const paused=claims();for(let i=0;i<4;i++)await f.wake();
 assert.equal(claims(),paused);assert.equal((await f.epoch.tools.broker_identity()).readiness,'paused_receiving');
 f.runtime.pauseReceiving(false);await f.wake();await until(()=>f.poll);
 f.poll.fail(new LocalError('invalid_response',{effect:'unknown'}));
 await until(()=>f.runtime.status().reception==='blocked');
 const blocked=claims();for(let i=0;i<4;i++)await f.wake();
 assert.equal(claims(),blocked,'strict successful-response validation must not be treated as an outage');
 assert.equal((await f.epoch.tools.broker_identity()).readiness,'blocked_transport');
});
