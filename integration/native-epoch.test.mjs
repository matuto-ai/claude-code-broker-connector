import {fixtureHook as pluginHook} from './native-fixture-permit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {httpFixture,registration,sendBody} from '../../ai-agent-msg-broker/test/helpers.mjs';
import {hostDirectory,readBinding,journalName} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
import {associateNativeBinding} from '../src/native-binding.mjs';
import {issueNativePermit} from '../src/native-call-permit.mjs';

// Real broker HTTP and actual MCP process; native hook invocations below are synthetic.
// This does not certify an interactive Claude /new or /compact transition.
for(const mode of ['configured','explicit','stale-legacy'])test(`same native MCP (${mode}) survives closed-session gap and new lifetime without adopting old calls or pending inbox`, {timeout:15000}, async t=>{
 const explicitConnect=mode==='explicit',staleLegacy=mode==='stale-legacy';
 const broker=await httpFixture(t),sender=registration('pi');await broker.request('/v1/sessions',{method:'POST',body:sender});
 const root=mkdtempSync(join(tmpdir(),'psst-native-epoch-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const token=join(root,'token'),configPath=join(root,'config.json');writeFileSync(token,broker.b.token,{mode:0o600});
 const config={brokerUrl:broker.base,tokenFile:token,stateRoot:root,name:'epoch-test',insecureDevelopment:true};writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const host=processIdentity(process.pid),bindingConfig=explicitConnect?{stateRoot:join(root,'.config','psst','native')}:config,directory=hostDirectory(bindingConfig,host).directory;
 let session=randomUUID(),activeDirectory=directory;const nativeConfig={stateRoot:join(root,'.config','psst','native')};
 const event=hook_event_name=>pluginHook(staleLegacy?nativeConfig:bindingConfig,{hook_event_name,session_id:session},host);
 const permit=(name,args={})=>issueNativePermit({directory:activeDirectory,binding:readBinding(activeDirectory),event:{session_id:session,tool_use_id:'synthetic_'+randomUUID(),tool_name:'mcp__plugin_psst_psst__'+name,tool_input:args}}).arguments;
 const start=async()=>{
  const env={...process.env,HOME:root};delete env.PSST_CLAUDE_CONFIG;delete env.PSST_CONFIG_FILE;if(!explicitConnect)env.PSST_CLAUDE_CONFIG=configPath;
  const child=spawn(process.execPath,['bin/plugin-mcp.mjs'],{env,stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let buffer='',stderr='',next=1;const pending=new Map();child.stderr.on('data',c=>stderr+=c);
  child.stdout.on('data',c=>{buffer+=c;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);pending.get(r.id)?.(r);pending.delete(r.id);}});
  const ended=new Promise(resolve=>child.once('exit',resolve));
  const ask=(method,params)=>new Promise(resolve=>{const id=next++;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-native-epoch',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const call=async(name,args={})=>{const r=await ask('tools/call',{name,arguments:permit(name,args)});assert(!r.error,JSON.stringify(r));return r.result.structuredContent??JSON.parse(r.result.content[0].text);};
  const identity=async()=>{let result;for(let i=0;i<100;i++){result=await call('broker_identity');if(result.client_id)return result;await delay(20);}assert.fail(stderr+' '+JSON.stringify(result));};
  return {child,ended,ask,call,identity,get stderr(){return stderr;}};
 };
 if(staleLegacy){pluginHook(bindingConfig,{hook_event_name:'SessionStart',session_id:session},host);event('SessionStart');associateNativeBinding({nativeConfig,legacyConfig:bindingConfig,host,sessionId:session});}
 else event('SessionStart');let m=await start();if(explicitConnect)assert((await m.call('broker_connect',{connection_file:configPath})).client_id);const a=await m.identity(),bindingA=readBinding(directory);
 const sent=await broker.request('/v1/messages',{method:'POST',session:sender.client_id,key:'epoch-pending-a',body:sendBody(a.client_id,'A-private-pending')});assert.equal(sent.status,202);
 let pendingA;for(let i=0;i<100;i++){pendingA=await m.call('broker_receive');if(pendingA.message_id)break;await delay(20);}assert.equal(pendingA.message_id,sent.body.message_id);
 const delayedA=permit('broker_receive');
 // Hold an accepted A send response while the native lifetime changes. The old
 // outgoing journal must retain it; B may not replay or adopt that operation.
 let releaseSend,acceptedSend;const sendAccepted=new Promise(r=>acceptedSend=r),sendGate=new Promise(r=>releaseSend=r);
 const originalHandler=broker.app.server.listeners('request')[0];let holdSend=true;
 broker.app.server.removeAllListeners('request');broker.app.server.on('request',(req,res)=>{
  if(holdSend&&req.method==='POST'&&req.url==='/v1/messages'){holdSend=false;const end=res.end.bind(res);res.end=(...args)=>{acceptedSend();void sendGate.then(()=>end(...args));return res;};}
  return originalHandler(req,res);
 });
 const delayedSend=m.ask('tools/call',{name:'broker_send',arguments:permit('broker_send',{recipient_id:sender.client_id,text:'A-accepted-before-transition'})});
 await sendAccepted;

 // Same verified lifetime survives compact, and a previously issued call remains A.
 event('SessionStart');assert.equal(readBinding(directory).lifetime,bindingA.lifetime);assert.equal((await m.identity()).client_id,a.client_id);
 event('SessionEnd');await delay(350);assert.equal(m.child.exitCode,null,'SessionEnd gap must not destroy native MCP transport');
 const gap=await m.ask('tools/call',{name:'broker_receive',arguments:delayedA});assert(gap.error||gap.result?.isError,'gap must deny without broker dispatch');assert(!JSON.stringify(gap).includes('A-private-pending'));
 if(mode==='configured'){writeFileSync(join(activeDirectory,'binding.json'),'{broken',{mode:0o600});await delay(600);assert.equal(m.child.exitCode,null,'corrupt binding retains native transport');assert((await m.ask('tools/list',{})).result.tools.length>0,'corrupt binding retains tool catalog');}
 session=randomUUID();event('SessionStart');if(staleLegacy)activeDirectory=hostDirectory(nativeConfig,host).directory;releaseSend();const sendResult=await delayedSend;assert(sendResult.error||sendResult.result?.isError);assert(!JSON.stringify(sendResult).includes('A-accepted-before-transition'));const b=await m.identity();assert.notEqual(b.client_id,a.client_id);assert.equal(b.native_session_id,session);
 const stale=await m.ask('tools/call',{name:'broker_receive',arguments:delayedA});assert(stale.error||stale.result?.isError);assert(!JSON.stringify(stale).includes('A-private-pending'));
 assert.equal((await m.call('broker_receive')).message_id,undefined);
 const db=new DatabaseSync(join(directory,journalName(bindingA.lifetime,config),'inbox.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT state,envelope FROM inbox WHERE message_id=?').get(sent.body.message_id);assert.equal(row.state,'pending');assert(row.envelope.includes('A-private-pending'));assert.equal(db.prepare("SELECT count(*) AS n FROM outgoing WHERE request LIKE '%A-accepted-before-transition%'").get().n,1);}finally{db.close();}
 // Transport-only restart preserves the live B lifetime and its broker identity.
 m.child.stdin.end();assert.equal(await m.ended,0,m.stderr);m=await start();assert.equal((await m.identity()).client_id,b.client_id);
 event('SessionEnd');await delay(300);m.child.stdin.end();assert.equal(await m.ended,0,m.stderr);
});
