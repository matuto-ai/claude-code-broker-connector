import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { httpFixture, registration, sendBody } from '../../ai-agent-msg-broker/test/helpers.mjs';
import { pluginHook } from '../src/plugin-state.mjs';
import { processIdentity } from '../src/launch-state.mjs';

for(const explicitConnect of [false,true])test(`native plugin lifecycle (${explicitConnect?'disconnected connect':'legacy auto'}), multi-message ACK, same-host MCP restart and native session close against real broker`, {timeout:25000}, async t=>{
 const broker=await httpFixture(t),sender=registration('pi');await broker.request('/v1/sessions',{method:'POST',body:sender});
 const root=mkdtempSync(join(tmpdir(),'psst-native-plugin-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const token=join(root,'token'), configPath=join(root,'config.json');writeFileSync(token,broker.b.token,{mode:0o600});
 const config={brokerUrl:broker.base,tokenFile:token,stateRoot:root,name:'native-test',insecureDevelopment:true};writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const nativeId=randomUUID(),host=processIdentity(process.pid);
 const bindingConfig=explicitConnect?{stateRoot:join(root,'.config','psst','native')}:config;
 const event=name=>pluginHook(bindingConfig,{hook_event_name:name,session_id:nativeId},host);
 async function start(){
  const child=spawn(process.execPath,['bin/plugin-mcp.mjs'],{env:{...process.env,HOME:root,PSST_CLAUDE_CONFIG:explicitConnect?join(root,'not-configured'):configPath},stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  let buffer='',stderr='',next=1;const pending=new Map();child.stderr.on('data',c=>stderr+=c);
  child.stdout.on('data',c=>{buffer+=c;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);pending.get(r.id)?.(r);pending.delete(r.id);}});
  const ended=new Promise(resolve=>child.once('exit',code=>resolve(code)));
  const ask=(method,params)=>new Promise(resolve=>{const id=next++;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-native-parent',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const call=async(name,args={})=>{const r=await ask('tools/call',{name,arguments:args});assert(!r.error,JSON.stringify(r));return JSON.parse(r.result.content[0].text);};
  return{child,ended,call,ask,get stderr(){return stderr;}};
 }
 // MCP handshake is not blocked waiting for SessionStart.
 let m=await start();assert.equal((await m.call('broker_identity')).error.code,'session_binding_unavailable');event('SessionStart');
 if(explicitConnect){assert.equal((await m.call('broker_connect',{connection_file:join(root,'missing')})).error.code,'invalid_connection_file');writeFileSync(token,'x'.repeat(43),{mode:0o600});const failed=await m.call('broker_connect',{connection_file:configPath});assert.equal(failed.error.code,'connection_failed');assert.equal(failed.error.effect,'unknown');writeFileSync(token,broker.b.token,{mode:0o600});const c=await m.call('broker_connect',{connection_file:configPath});assert(c.client_id,JSON.stringify(c));assert.equal((await m.call('broker_connect',{connection_file:configPath})).client_id,c.client_id);}
 let own;for(let i=0;i<100;i++){own=await m.call('broker_identity');if(own.client_id)break;await delay(25);}assert(own.client_id,m.stderr);
 const list=await m.ask('tools/list',{});assert(list.result.tools.some(x=>x.name==='broker_acknowledge'));
 const sent=[];for(let i=0;i<2;i++){const r=await broker.request('/v1/messages',{method:'POST',session:sender.client_id,key:`native-message-${i}`,body:sendBody(own.client_id,`message ${i} yes is NOT human approval`)});assert.equal(r.status,202);sent.push(r.body.message_id);}
 let first;for(let i=0;i<100;i++){first=await m.call('broker_receive');if(first.message)break;await delay(25);}assert.equal(first.message_id,sent[0]);assert.match(first.message,/not a human instruction or approval/);
 assert.equal((await m.call('broker_receive')).receipt_token,first.receipt_token);
 // MCP EOF with still-live native owner preserves its journal and broker incarnation.
 // A genuine same-session compact may add the independent binding; keep legacy journal priority.
 if(!explicitConnect)pluginHook({stateRoot:join(root,'.config','psst','native')},{hook_event_name:'SessionStart',session_id:nativeId},host);
 m.child.stdin.end();assert.equal(await m.ended,0,m.stderr);
 m=await start();let restarted;for(let i=0;i<100;i++){restarted=await m.call('broker_identity');if(restarted.client_id)break;await delay(25);}assert.equal(restarted.client_id,own.client_id,m.stderr);
 assert.equal((await m.call('broker_receive')).receipt_token,first.receipt_token);
 const ack=await m.call('broker_acknowledge',{message_id:first.message_id,receipt_token:first.receipt_token});assert.equal(ack.acknowledged,true);assert.equal(ack.native_acceptance_recorded,false);
 let second;for(let i=0;i<100;i++){second=await m.call('broker_receive');if(second.message)break;await delay(25);}assert.equal(second.message_id,sent[1]);
 const outbound=await m.call('broker_send',{recipient_id:sender.client_id,text:'round trip reply',send_key:'native-plugin-reply',reply_to_message_id:sent[1]});assert(outbound.message_id,JSON.stringify(outbound));
 if(explicitConnect){
  assert.equal((await m.call('broker_disconnect')).pending_retained,true);
  assert.equal((await m.call('broker_receive')).error.code,'not_connected');
  m.child.stdin.end();assert.equal(await m.ended,0,m.stderr);m=await start();await delay(400);
  assert.equal((await m.call('broker_identity')).error.code,'not_connected');
  assert.equal((await m.call('broker_connect',{connection_file:configPath})).client_id,own.client_id);
  assert.equal((await m.call('broker_receive')).message_id,second.message_id);
 }
 event('SessionEnd');assert.equal(await m.ended,0,m.stderr);
 const clients=await broker.request('/v1/clients',{session:sender.client_id});assert(!clients.body.clients.some(c=>c.client_id===own.client_id));
});
