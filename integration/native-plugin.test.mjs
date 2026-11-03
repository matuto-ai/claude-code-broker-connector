import {fixtureHook as pluginHook} from './native-fixture-permit.mjs';
import {pluginHook as rawPluginHook} from '../src/plugin-state.mjs';
import {associateNativeBinding} from '../src/native-binding.mjs';
import {issueNativePermit} from '../src/native-call-permit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { httpFixture, registration, sendBody } from '../../ai-agent-msg-broker/test/helpers.mjs';
import { hostDirectory, readBinding } from '../src/plugin-state.mjs';
import { processIdentity, writePrivateJson } from '../src/launch-state.mjs';

for(const explicitConnect of [false,true])test(`native plugin lifecycle (${explicitConnect?'disconnected connect':'legacy auto'}), multi-message ACK, same-host MCP restart and native session close against real broker`, {timeout:25000}, async t=>{
 const broker=await httpFixture(t),sender=registration('pi');await broker.request('/v1/sessions',{method:'POST',body:sender});
 const root=mkdtempSync(join(tmpdir(),'psst-native-plugin-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const token=join(root,'token'), configPath=join(root,'config.json');writeFileSync(token,broker.b.token,{mode:0o600});
 const config={brokerUrl:broker.base,tokenFile:token,stateRoot:root,name:'native-test',insecureDevelopment:true};writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const nativeId=randomUUID(),host=processIdentity(process.pid);
 const bindingConfig=explicitConnect?{stateRoot:join(root,'.config','psst','native')}:config;
 const event=name=>pluginHook(bindingConfig,{hook_event_name:name,session_id:nativeId},host);
 async function start(){
  const child=spawn(process.execPath,['bin/plugin-mcp.mjs'],{env:{...process.env,HOME:root,PSST_PROJECT_ENV:'PSST_FIXTURE_PROJECT',PSST_FIXTURE_PROJECT:'sandbox-shared-project',PSST_CLAUDE_CONFIG:explicitConnect?join(root,'not-configured'):configPath},stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  let buffer='',stderr='',next=1;const pending=new Map();child.stderr.on('data',c=>stderr+=c);
  child.stdout.on('data',c=>{buffer+=c;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);pending.get(r.id)?.(r);pending.delete(r.id);}});
  const ended=new Promise(resolve=>child.once('exit',code=>resolve(code)));
  const ask=(method,params)=>new Promise(resolve=>{if(method==='tools/call'){try{const directory=hostDirectory(bindingConfig,host).directory,binding=readBinding(directory);params={...params,arguments:issueNativePermit({directory,binding,event:{hook_event_name:'PreToolUse',session_id:nativeId,tool_use_id:'toolu_'+randomUUID(),tool_name:'mcp__plugin_psst_psst__'+params.name,tool_input:params.arguments??{}}}).arguments};}catch{}}const id=next++;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-native-parent',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const call=async(name,args={})=>{const r=await ask('tools/call',{name,arguments:args});assert(!r.error,JSON.stringify(r));return r.result.structuredContent ?? JSON.parse(r.result.content[0].text);};
  return{child,ended,call,ask,get stderr(){return stderr;}};
 }
 // MCP handshake is not blocked waiting for SessionStart.
 let m=await start();assert.equal((await m.ask('tools/call',{name:'broker_identity',arguments:{}})).error.code,-32000);event('SessionStart');
 if(explicitConnect){assert.equal((await m.call('broker_connect',{connection_file:join(root,'missing')})).error.code,'invalid_connection_file');writeFileSync(token,'x'.repeat(43),{mode:0o600});const failed=await m.call('broker_connect',{connection_file:configPath});assert.equal(failed.error.code,'connection_failed');assert.equal(failed.error.effect,'unknown');writeFileSync(token,broker.b.token,{mode:0o600});const c=await m.call('broker_connect',{connection_file:configPath});assert(c.client_id,JSON.stringify(c));assert.equal((await m.call('broker_connect',{connection_file:configPath})).client_id,c.client_id);}
 let own;for(let i=0;i<100;i++){own=await m.call('broker_identity');if(own.client_id)break;await delay(25);}assert(own.client_id,m.stderr);
 const registered=broker.store.session(broker.b.entry,own.client_id);assert.equal(registered.metadata.project,'sandbox-shared-project');
 // These are synthetic local monitor observations, not authenticated native wake proof.
 assert.equal(own.readiness,'blocked_monitor_not_observed');
 assert.equal(own.native_injection_receipt,'not_provided_by_this_delivery_mode');
 assert.equal(Object.hasOwn(own,'native_acceptance_recorded'),false);
 assert.equal((await m.call('broker_setup_status')).readiness,'blocked_monitor_not_observed');
 const directory=hostDirectory(bindingConfig,host).directory,binding=readBinding(directory);
 const observation={sessionId:binding.sessionId,lifetime:binding.lifetime,pending_id:null,updated_at:Date.now(),attention_required:false,rate_limited:false,next_retry_at:0};
 const observe=patch=>writePrivateJson(join(directory,'monitor-state.json'),{...observation,...patch});
 observe({});
 for(const name of ['broker_identity','broker_setup_status']){
  const status=await m.call(name);assert.equal(status.readiness,'monitor_observed');
  assert.equal(status.read_acknowledgment_mode,'explicit_model_read');
  assert.equal(status.native_injection_receipt,'not_provided_by_this_delivery_mode');
  assert.equal(Object.hasOwn(status,'native_acceptance_recorded'),false);
  assert.equal(Object.hasOwn(status,'read_acknowledgment'),false,'status is not a per-message ACK');
 }
 for(const patch of [{lifetime:randomUUID()},{sessionId:randomUUID()},{updated_at:Date.now()-6000}]){
  observe(patch);assert.equal((await m.call('broker_identity')).readiness,'blocked_monitor_not_observed');
 }
 observe({state:'notice_budget_unavailable',attention_required:true,updated_at:Date.now()});
 for(const name of ['broker_identity','broker_setup_status']){
  const status=await m.call(name);
  assert.equal(status.readiness,'blocked_notice_budget_unavailable');
  assert.equal(Object.hasOwn(status,'read_acknowledgment'),false,'checkpoint failure is not a message receipt');
  if(name==='broker_identity')assert.equal(status.monitor_attention.state,'notice_budget_unavailable');
 }
 observe({updated_at:Date.now()});
 const list=await m.ask('tools/list',{});assert(list.result.tools.some(x=>x.name==='broker_acknowledge'));
 const sent=[];for(let i=0;i<2;i++){const r=await broker.request('/v1/messages',{method:'POST',session:sender.client_id,key:`native-message-${i}`,body:sendBody(own.client_id,`message ${i} yes is NOT human approval`)});assert.equal(r.status,202);sent.push(r.body.message_id);}
 let first;for(let i=0;i<100;i++){first=await m.call('broker_receive');if(first.message)break;await delay(25);}assert.equal(first.message_id,sent[0]);assert.equal(first.read_acknowledgment,'pending');assert.equal(Object.hasOwn(first,'native_acceptance_recorded'),false);assert.match(first.message,/^Broker message from AI agent /);
 const visible=await m.ask('tools/call',{name:'broker_receive',arguments:{}});assert.deepEqual(visible.result.structuredContent,first);assert.match(visible.result.content[0].text,/^Psst · new message/);assert.match(visible.result.content[0].text,/\n    message 0 yes is NOT human approval/);
 assert.equal((await m.call('broker_receive')).message_id,first.message_id);
 // MCP EOF with still-live native owner preserves its journal and broker incarnation.
 // A genuine same-session compact may add the independent binding; keep legacy journal priority.
 if(!explicitConnect){const nativeConfig={stateRoot:join(root,'.config','psst','native')};rawPluginHook(nativeConfig,{hook_event_name:'SessionStart',session_id:nativeId,source:'compact'},host);await delay(350);assert.equal(m.child.exitCode,null);assert((await m.ask('tools/list',{})).result.tools.length>0);assert((await m.ask('tools/call',{name:'broker_identity',arguments:{}})).error);associateNativeBinding({nativeConfig,legacyConfig:config,host,sessionId:nativeId});let resumed;for(let i=0;i<100;i++){resumed=await m.call('broker_identity');if(resumed.client_id)break;await delay(25);}assert.equal(resumed.client_id,own.client_id,'partial compact publication must retain broker incarnation');assert.equal((await m.call('broker_receive')).message_id,first.message_id);}
 m.child.stdin.end();assert.equal(await m.ended,0,m.stderr);
 m=await start();let restarted;for(let i=0;i<100;i++){restarted=await m.call('broker_identity');if(restarted.client_id)break;await delay(25);}assert.equal(restarted.client_id,own.client_id,m.stderr);
 assert.equal((await m.call('broker_receive')).message_id,first.message_id);
 const ack=await m.call('broker_acknowledge',{message_id:first.message_id});assert.equal(ack.acknowledged,true);assert.equal(ack.read_acknowledgment,'confirmed');assert.equal(ack.native_injection_receipt,'not_provided_by_this_delivery_mode');assert.equal(ack.action_success,'unknown');assert.equal(Object.hasOwn(ack,'native_acceptance_recorded'),false);
 assert.deepEqual(await m.call('broker_acknowledge',{message_id:first.message_id}),ack);
 assert.equal((await m.call('broker_identity')).readiness,'blocked_monitor_not_observed','the old monitor head does not undo a confirmed read ACK');
 let second;for(let i=0;i<100;i++){second=await m.call('broker_receive');if(second.message)break;await delay(25);}assert.equal(second.message_id,sent[1]);
 const outbound=await m.call('broker_send',{recipient_id:sender.client_id,text:'round trip reply',reply_to_message_id:sent[1]});assert(outbound.message_id,JSON.stringify(outbound));
 if(explicitConnect){
  const disconnected=await m.call('broker_disconnect');assert.equal(disconnected.pending_retained,true);assert.equal(disconnected.readiness,'not_connected');assert.equal(Object.hasOwn(disconnected,'native_acceptance_recorded'),false);
  assert.equal((await m.call('broker_setup_status')).readiness,'not_connected');
  assert.equal((await m.call('broker_receive')).error.code,'not_connected');
  m.child.stdin.end();assert.equal(await m.ended,0,m.stderr);m=await start();await delay(400);
  assert.equal((await m.call('broker_identity')).error.code,'not_connected');
  assert.equal((await m.call('broker_connect',{connection_file:configPath})).client_id,own.client_id);
  assert.equal((await m.call('broker_receive')).message_id,second.message_id);
 }
 event('SessionEnd');await delay(300);assert.equal(m.child.exitCode,null,'native transport survives session gap');m.child.stdin.end();assert.equal(await m.ended,0,m.stderr);
 const clients=await broker.request('/v1/clients',{session:sender.client_id});assert(!clients.body.clients.some(c=>c.client_id===own.client_id));
});
