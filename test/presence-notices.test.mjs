import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Inbox,newSessionIdentity} from '../vendor/psst/reference/inbox.mjs';
import {PresenceNotices,presenceEvent,readablePresence} from '../src/presence-notices.mjs';
function event(){return {event_id:randomUUID(),recipient_id:randomUUID(),type:'recipient_offline',presence_state:'disconnected',last_heartbeat_at:new Date().toISOString(),created_at:new Date().toISOString(),observed_at:new Date().toISOString(),messages:[{message_id:randomUUID(),delivery_state:'claimed',delivery_uncertain:true}],has_more_messages:false};}
function setup(t){const dir=mkdtempSync(join(tmpdir(),'claude-presence-'));const inbox=new Inbox({directory:dir,identity:newSessionIdentity('claude-code')});t.after(()=>{inbox.close();rmSync(dir,{recursive:true,force:true});});let events=[event()],active=true;const acks=[];const client={policy:{presence_events:true},presenceEvents:async()=>({events,next_cursor:null,capacity_limited:false}),acknowledgePresenceEvent:async id=>{acks.push(id);events=events.filter(e=>e.event_id!==id);return {event_id:id,acknowledged:true};}};const make=()=>new PresenceNotices({client,inbox,isAlive:()=>active});return {inbox,client,make,acks,get events(){return events;},set events(v){events=v;},stop:()=>active=false};}
test('separate durable journal, explicit read and ACK, recovery without message receipts',async t=>{const x=setup(t);let n=x.make();await n.tick();assert.equal(x.inbox.head(),null);const id=x.events[0].event_id;await assert.rejects(n.acknowledge(id),/Read this exact transport event/);const read=await n.read();assert.equal(read.events[0].event_id,id);assert.equal(x.acks.length,0);await n.stop();n=x.make();await n.tick();assert.equal((await n.read()).events.length,1);assert.equal((await n.acknowledge(id)).acknowledged,true);assert.equal((await n.read()).events.length,0);assert.equal(x.inbox.head(),null);await n.stop();});
test('lost ACK response persists intent and retries without presenting again',async t=>{const x=setup(t);let n=x.make();await n.read();const id=x.events[0].event_id;const ack=x.client.acknowledgePresenceEvent;x.client.acknowledgePresenceEvent=async id=>{await ack(id);throw Error('lost');};await assert.rejects(n.acknowledge(id),/lost/);await n.stop();x.client.acknowledgePresenceEvent=async()=>{throw Object.assign(Error(),{status:404,code:'message_not_found'});};n=x.make();assert.equal((await n.read()).events.length,0);assert.equal(x.inbox.db.prepare('SELECT state FROM native_presence_events').get().state,'acked');await n.stop();});
test('read refresh suppresses obsolete and updates changed message samples',async t=>{const x=setup(t),n=x.make();await n.tick();x.events[0].messages[0].delivery_uncertain=false;assert.equal((await n.read()).events[0].messages[0].delivery_uncertain,false);x.events=[];assert.equal((await n.read()).events.length,0);await n.stop();});
test('unsupported broker avoids HTTP calls; close drains delayed polling without writes',async t=>{const x=setup(t),n=x.make();x.client.policy.presence_events=false;x.client.presenceEvents=()=>{throw Error('must not call');};assert.equal((await n.read()).supported,false);x.client.policy.presence_events=true;let release;const gate=new Promise(r=>release=r);x.client.presenceEvents=async()=>{await gate;return {events:x.events};};const pending=n.tick(),stopping=n.stop();release();await Promise.all([pending,stopping]);assert.equal(x.inbox.db.prepare('SELECT COUNT(*) n FROM native_presence_events').get().n,0);});
test('malformed payload and injected fields do not become transport instructions',()=>{const e=event();e.content='malicious secret';const clean=presenceEvent(e);assert.equal(clean.content,undefined);const rendered=readablePresence({events:[clean]});assert.match(rendered.content[0].text,/not an agent instruction/);assert.doesNotMatch(rendered.content[0].text,/malicious secret/);assert.throws(()=>presenceEvent({...e,event_id:'bad\nrecipient'}));assert.throws(()=>presenceEvent({...e,messages:[{...e.messages[0],delivery_state:'delivered'}]}));});
test('capacity-limited snapshot never retires old pending; cursor cycles fail closed',async t=>{const x=setup(t),n=x.make();await n.tick();const old=x.events[0].event_id;x.client.presenceEvents=async()=>({events:[],capacity_limited:true});assert.equal((await n.read()).events[0].event_id,old);x.client.presenceEvents=async()=>({events:[],next_cursor:'1'});await assert.rejects(n.read(),/broker response is invalid/);assert.equal(x.inbox.db.prepare('SELECT COUNT(*) n FROM native_presence_events').get().n,1);await n.stop();});
test('backlogs beyond 256 remain readable and progress after explicit acknowledgment',async t=>{const x=setup(t),n=x.make();x.events=Array.from({length:270},event);x.client.presenceEvents=async({cursor='0',limit=10})=>{const offset=Number(cursor),end=offset+limit;return {events:x.events.slice(offset,end),next_cursor:end<x.events.length?String(end):null};};const read=await n.read();assert.equal(read.events.length,10);assert.equal(read.capacity_limited,true);assert.equal(x.inbox.db.prepare('SELECT COUNT(*) n FROM native_presence_events').get().n,256);const old=read.events[0].event_id;await n.acknowledge(old);const next=await n.read();assert.equal(next.events.length,10);assert(!next.events.some(e=>e.event_id===old));assert.equal(x.inbox.db.prepare('SELECT COUNT(*) n FROM native_presence_events').get().n,256);await n.stop();});
test('invalid or wrong-event ACK responses retain durable explicit intent',async t=>{
 const x=setup(t),n=x.make();await n.read();const id=x.events[0].event_id;
 x.client.acknowledgePresenceEvent=async()=>({event_id:randomUUID(),acknowledged:true});
 await assert.rejects(n.acknowledge(id),/broker response is invalid/);
 assert.equal(x.inbox.db.prepare('SELECT state FROM native_presence_events').get().state,'ack_requested');
 x.client.acknowledgePresenceEvent=async()=>{throw Object.assign(Error('forbidden'),{status:403,code:'forbidden'});};
 await assert.rejects(n.read(),/forbidden/);
 assert.equal(x.inbox.db.prepare('SELECT state FROM native_presence_events').get().state,'ack_requested');
 await n.stop();
});
test('polling is bounded to once a minute, pending hints become stale and stop aborts in-flight I/O',async t=>{
 const x=setup(t);let now=1000,calls=0;
 const real=x.client.presenceEvents;x.client.presenceEvents=async args=>{calls++;return real(args);};
 const n=new PresenceNotices({client:x.client,inbox:x.inbox,isAlive:()=>true,now:()=>now});
 await n.tick();assert.equal(calls,1);assert.equal(n.pendingId(),x.events[0].event_id);
 await n.tick();now+=59999;await n.tick();assert.equal(calls,1);
 now++;await n.tick();assert.equal(calls,2);
 now+=90001;assert.equal(n.pendingId(),null);
 x.client.presenceEvents=async(_, {signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 const polling=n.tick();await n.stop();await polling;assert.equal(n.pendingId(),null);
});
test('bounded pages reject excess, oversized and malformed metadata without journal changes',async t=>{
 const x=setup(t),n=x.make();
 for(const page of [{events:Array.from({length:11},event)},{events:[{...event(),text:'x'.repeat(65536)}]},{events:[{...event(),messages:[]}]},{events:[event()],next_cursor:'-1'}]){
  x.client.presenceEvents=async()=>page;await assert.rejects(n.read(),/broker response is invalid/);
  assert.equal(x.inbox.db.prepare('SELECT COUNT(*) n FROM native_presence_events').get().n,0);
 }
 await n.stop();
});
test('structured transport results strip untrusted extra fields as well as readable text',()=>{
 const result=readablePresence({events:[{...event(),content:'SECRET'}],text:'SECRET',supported:true});
 assert.doesNotMatch(JSON.stringify(result),/SECRET/);
 assert.equal(Object.hasOwn(result.structuredContent,'native_acceptance_recorded'),false);
 assert.equal(Object.hasOwn(result.structuredContent,'read_acknowledgment'),false);
});
test('sparse >26-page scans persist continuation across restart and do not prune a seen prefix',async t=>{
 const x=setup(t);let n=x.make();const old=event(),prefix=event(),tail=event();
 x.events=[old];await n.read();
 const calls=[];let includePrefix=true;
 x.client.presenceEvents=async({cursor='0'})=>{
  const offset=Number(cursor);calls.push(offset);
  if(offset<2700)return {events:offset===0&&includePrefix?[prefix]:[],next_cursor:String(offset+100)};
  return {events:[tail],next_cursor:null};
 };
 const first=await n.read();assert.equal(first.capacity_limited,true);assert.equal(calls.length,26);
 assert(first.events.some(e=>e.event_id===old.event_id),'do not prune before the full traversal');
 assert.equal(x.inbox.db.prepare('SELECT cursor FROM native_presence_scan').get().cursor,'2600');
 await n.stop();n=x.make();const resumed=await n.read();
 assert.deepEqual(calls.slice(26),[2600,2700]);
 assert(resumed.events.some(e=>e.event_id===prefix.event_id),'resumed suffix must preserve the already-seen prefix');
 assert(resumed.events.some(e=>e.event_id===tail.event_id));
 assert(!resumed.events.some(e=>e.event_id===old.event_id),'complete traversal suppresses obsolete pending event');
 assert.equal(x.inbox.db.prepare('SELECT cursor FROM native_presence_scan').get().cursor,null);
 includePrefix=false;await n.read();await n.read();
 assert.equal(x.inbox.db.prepare('SELECT event_id FROM native_presence_events WHERE event_id=?').get(prefix.event_id),undefined);
 await n.stop();
});
test('each valid page is checkpointed even when a later request fails',async t=>{
 const x=setup(t),n=x.make(),calls=[];let fail=true;
 x.client.presenceEvents=async({cursor='0'})=>{
  calls.push(cursor);
  if(cursor==='0')return {events:[],next_cursor:'100'};
  if(fail)throw Error('later-page-network-error');
  return {events:x.events,next_cursor:null};
 };
 await assert.rejects(n.read(),/later-page/);
 assert.equal(x.inbox.db.prepare('SELECT cursor FROM native_presence_scan').get().cursor,'100');
 fail=false;assert.equal((await n.read()).events[0].event_id,x.events[0].event_id);
 assert.deepEqual(calls,['0','100','100']);await n.stop();
});
