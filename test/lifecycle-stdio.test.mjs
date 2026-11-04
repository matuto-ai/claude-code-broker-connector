import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { serveStdio, TOOL_DEFINITIONS } from '../src/cooperative-stdio.mjs';
const ids=['broker_sent_history','broker_message_content','broker_resend','broker_cancel'];
function rpc(tools){
 const input=new PassThrough(),responses=[];let text='';
 const output=new Writable({write(bytes,enc,done){text+=bytes;while(text.includes('\n')){const i=text.indexOf('\n');responses.push(JSON.parse(text.slice(0,i)));text=text.slice(i+1);}done();}});
 const server=serveStdio({input,output,tools});let id=0;
 const send=(method,params,requestId=++id)=>input.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');
 const call=async(method,params,requestId=++id)=>{const before=responses.length;send(method,params,requestId);for(let i=0;i<100;i++){const found=responses.slice(before).find(r=>r.id===requestId);if(found)return found;await delay(5);}throw Error('rpc_timeout');};
 const ready=async()=>{await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');};
 return {server,call,send,ready};
}
test('lifecycle catalog is bounded and never asks the model for a retry key',()=>{
 for(const name of ids)assert.ok(TOOL_DEFINITIONS.some(d=>d.name===name),name);
 for(const name of ['broker_send','broker_resend']){const d=TOOL_DEFINITIONS.find(d=>d.name===name);assert.equal(d.inputSchema.additionalProperties,false);assert.equal(Object.hasOwn(d.inputSchema.properties,'send_key'),false);}
 assert.deepEqual(TOOL_DEFINITIONS.find(d=>d.name==='broker_cancel').inputSchema.required,['message_id']);
});
test('new lifecycle calls preserve arguments; reused completed JSON-RPC IDs are not false intent identities',async t=>{
 const seen=[];const tools=Object.fromEntries([...ids,'broker_send'].map(name=>[name,async(args,context)=>{seen.push({name,args,context});return {ok:true};}]));
 const f=rpc(tools);t.after(()=>f.server.close());await f.ready();
 const uuid='11111111-1111-4111-8111-111111111111';
 for(const name of ids){const args=name==='broker_sent_history'?{limit:10,status:'cancelled'}:{message_id:uuid};const result=await f.call('tools/call',{name,arguments:args},42);assert.equal(result.result.isError,false);assert.deepEqual(seen.at(-1).args,args);assert.equal(Object.hasOwn(seen.at(-1).context,'operationId'),false);assert.ok(seen.at(-1).context.signal instanceof AbortSignal);}
 const bad=await f.call('tools/call',{name:'broker_send',arguments:{recipient_id:uuid,text:'x',send_key:'private'}});assert.equal(bad.error.code,-32602);assert.equal(seen.length,4);
 await f.server.close();assert.equal(seen[0].context.signal.aborted,true);
});

test('agent instructions separate completed read ACK from unavailable native transcript receipt',async t=>{
 const f=rpc({broker_identity:async()=>({})});t.after(()=>f.server.close());
 const init=await f.call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
 assert.match(init.result.instructions,/read_acknowledgment:confirmed completes that read ACK/);
 assert.match(init.result.instructions,/not failed delivery or a required user validation step/);
 assert.doesNotMatch(init.result.instructions,/native_acceptance_recorded|native_wakeup_acceptance_unverified/);
 const ack=TOOL_DEFINITIONS.find(x=>x.name==='broker_acknowledge');
 assert.match(ack.description,/no additional user validation is required/);
 assert.equal(Object.hasOwn(ack.inputSchema.properties,'native_acceptance_recorded'),false);
 assert.equal(Object.hasOwn(ack.inputSchema.properties,'read_acknowledgment'),false);
 assert.match(TOOL_DEFINITIONS.find(x=>x.name==='broker_identity').description,/not a per-message read receipt/);
 assert.match(TOOL_DEFINITIONS.find(x=>x.name==='broker_receive').description,/unavailable capability, not failed delivery/);
});

test('presence MCP tools validate exact explicit event ACK without caller cursors or retry IDs',async t=>{
 const eventId='11111111-1111-4111-8111-111111111111',seen=[];
 const f=rpc({broker_presence_events:async args=>{seen.push(args);return {events:[],supported:true};},broker_acknowledge_presence_event:async args=>{seen.push(args);return {event_id:args.event_id,acknowledged:true};}});
 t.after(()=>f.server.close());await f.ready();
 assert.equal(TOOL_DEFINITIONS.find(d=>d.name==='broker_presence_events').inputSchema.additionalProperties,false);
 for(const [name,args] of [['broker_presence_events',{cursor:'1'}],['broker_acknowledge_presence_event',{}],['broker_acknowledge_presence_event',{event_id:'wrong'}]]){
  assert.equal((await f.call('tools/call',{name,arguments:args})).error.code,-32602);
 }
 assert.equal(seen.length,0);
 assert.equal((await f.call('tools/call',{name:'broker_presence_events',arguments:{}})).result.isError,false);
 assert.equal((await f.call('tools/call',{name:'broker_acknowledge_presence_event',arguments:{event_id:eventId}})).result.isError,false);
 assert.deepEqual(seen,[{},{event_id:eventId}]);
});

test('reauthorization dispatch preserves boolean replacement and confirmed origin; rejects invented/credential arguments',async t=>{
 const calls=[];const f=rpc({broker_setup:async args=>{calls.push(args);return {state:'pending',requestId:'public'};}});t.after(()=>f.server.close());await f.ready();
 const args={replace:true,expected_broker_url:'https://broker.invalid'};
 assert.equal((await f.call('tools/call',{name:'broker_setup',arguments:args})).result.isError,false);
 assert.deepEqual(calls,[args]);
 for(const args of [{replace:'true'},{replace:true,token:'secret'},{replace:true,broker_url:'https://other.invalid'}])assert.equal((await f.call('tools/call',{name:'broker_setup',arguments:args})).error.code,-32602);
 assert.equal(calls.length,1);
});
