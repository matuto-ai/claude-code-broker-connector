import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { PassThrough, Readable, Writable } from 'node:stream';
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setImmediate as settle } from 'node:timers/promises';
import { processIdentity, writePrivateJson } from '../src/launch-state.mjs';
import { pluginHook, hostDirectory, readBinding } from '../src/plugin-state.mjs';
import { associateNativeBinding } from '../src/native-binding.mjs';
import { issueNativePermit, consumeNativePermit } from '../src/native-call-permit.mjs';
import { Inbox } from '../vendor/psst/reference/inbox.mjs';
import { createPluginEpoch } from '../src/plugin-epoch.mjs';
import { createCooperativeInbox } from '../src/cooperative-inbox.mjs';
import { serveStdio } from '../src/cooperative-stdio.mjs';
import { setupEndpoint, REAUTHORIZE_USAGE } from '../src/reauthorization.mjs';
import { beginApproval } from '../src/approval-support.mjs';
import { saveSetupContext } from '../src/setup-context.mjs';
import { saveSelection, readSelection } from '../src/installation-selection.mjs';

const brokerUrl='https://broker.invalid';
const malformed=['','not-a-url','http://broker.invalid','https:broker.invalid','https://user:password@broker.invalid','https://broker.invalid/path','https://broker.invalid/path/..','https:///broker.invalid','https://broker.invalid//','https://broker.invalid?','https://broker.invalid#',' https://broker.invalid','https://broker.invalid\n','https://broker.invalid\\path'];
function snapshot(root){
 return readdirSync(root,{recursive:true}).sort().map(path=>{const file=join(root,path),stat=statSync(file);return [path,stat.mode,stat.isFile()?createHash('sha256').update(readFileSync(file)).digest('hex'):null];});
}
async function fixture(t,{native=false,failAttachment=false}={}){
 const root=mkdtempSync(join(tmpdir(),'reauthorize-endpoint-'));
 const keys=['HOME','CLAUDE_CONFIG_DIR','PSST_CONFIG_FILE','PSST_CLAUDE_CONFIG','PSST_BROKER_URL','PSST_PLUGIN_BROKER_URL'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);
 process.env.HOME=root;process.env.CLAUDE_CONFIG_DIR=join(root,'config');process.env.PSST_PLUGIN_BROKER_URL=brokerUrl;
 const nativeConfig={stateRoot:join(root,'native')},host=processIdentity(process.pid),sessionId=randomUUID();
 pluginHook(nativeConfig,{hook_event_name:'SessionStart',session_id:sessionId},host);associateNativeBinding({nativeConfig,host,sessionId});
 const {directory}=hostDirectory(nativeConfig,host),binding=readBinding(directory),requests=[],inboxes=[];
 let approved=false;
 const credential={protocol_version:'1',client_type:'claude-code',credential_id:'enrolled-'+randomUUID(),adapter_id:'installation-'+randomUUID(),scopes:['psst'],expires_at:new Date(Date.now()+3600000).toISOString()};
 // Exercise the real approval helper without opening a socket or using live credentials.
 t.mock.method(https,'request',(url,options,callback)=>{
  let body='';return new Writable({write(chunk,encoding,done){body+=chunk;done();},final(done){
   const input=body?JSON.parse(body):null;requests.push({origin:url.origin,method:options.method,requestId:input?.request_id});
   const response=Readable.from([Buffer.from(JSON.stringify({request_id:input?.request_id??url.pathname.split('/').at(-1),state:approved?'approved':'pending',request_expires_at:new Date(Date.now()+60000).toISOString(),...(approved?{credential}:{})}))]);
   response.statusCode=201;response.headers={};callback(response);done();
  }});
 });
 class BrokerClient {constructor({inbox,tokenFile}){inboxes.push(inbox);this.replacement=tokenFile!==config.tokenFile;}async recoverOutgoing(){} }
 class AdapterRuntime {constructor({client}){this.client=client;}async start(){if(failAttachment&&this.client.replacement)throw Error('fixture_attachment_failed');}async stop(){} }
 const config={brokerUrl,tokenFile:join(root,'token'),stateRoot:join(root,'legacy'),name:'legacy',project:null};
 const epoch=createPluginEpoch({directory,binding,host,nativeConfig,legacyConfig:config,dependencies:{BrokerClient,AdapterRuntime,createTools:()=>({}),createCooperativeInbox}});
 const input=new PassThrough(),waiting=new Map();let id=0;
 const output=new Writable({write(chunk,encoding,done){const result=JSON.parse(chunk);waiting.get(result.id)?.(result);waiting.delete(result.id);done();}});
 const nativeAdmission=native?async(name,args)=>{
  const permit=consumeNativePermit({directory,binding,toolName:name,args});
  return {arguments:permit.arguments,tools:epoch.tools,isCurrent:epoch.isCurrent};
 }:undefined;
 const server=serveStdio({input,output,tools:epoch.tools,nativeAdmission});
 t.after(async()=>{await server.close();await epoch.retire();for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];rmSync(root,{recursive:true,force:true});});
 const rpc=(method,params)=>new Promise(resolve=>{const next=++id;waiting.set(next,resolve);input.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
 input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const permit=(name,args)=>{
  const event={hook_event_name:'PreToolUse',session_id:sessionId,tool_use_id:'toolu_'+randomUUID(),tool_name:'mcp__plugin_psst_psst__'+name,tool_input:args};
  assert.equal(pluginHook(nativeConfig,event,host),null,'native hook must not grant or deny a current main session');
  return issueNativePermit({directory,binding,event}).arguments;
 };
 const call=async(name,args={})=>{const response=await rpc('tools/call',{name,arguments:native?permit(name,args):args});assert.equal(response.error,undefined);return JSON.parse(response.result.content[0].text);};
 return {root,directory,epoch,call,rpc,permit,requests,inboxes,config,installation:join(root,'config','psst'),approve:()=>{approved=true;},allowAttachment:()=>{failAttachment=false;}};
}

test('endpoint parser requires explicit HTTPS origins for replacement, without changing initial setup',()=>{
 assert.equal(setupEndpoint({}),undefined);
 for(const expectedBrokerUrl of [undefined,null,1,...malformed])assert.throws(()=>setupEndpoint({replace:true,expectedBrokerUrl}),/invalid_reauthorization_endpoint/);
 for(const expectedBrokerUrl of malformed)assert.throws(()=>setupEndpoint({expectedBrokerUrl}),/invalid_reauthorization_endpoint/);
 for(const expectedBrokerUrl of [brokerUrl,brokerUrl+'/','HTTPS://BROKER.INVALID:443/'])assert.equal(setupEndpoint({replace:true,expectedBrokerUrl}),brokerUrl);
 assert.equal(setupEndpoint({replace:true,expectedBrokerUrl:'https://broker.invalid:8443'}),'https://broker.invalid:8443');
});

test('real MCP replacement rejects missing, malformed and mismatched endpoints before any setup mutation',async t=>{
 const f=await fixture(t),before=snapshot(f.root);
 for(const expected_broker_url of [undefined,...malformed]){
  const result=await f.call('broker_setup',{replace:true,...(expected_broker_url===undefined?{}:{expected_broker_url})});
  assert.deepEqual(result,{error:{code:'invalid_reauthorization_endpoint',retryable:false,effect:'not_applied'},usage:REAUTHORIZE_USAGE});
  assert.deepEqual(snapshot(f.root),before);
 }
 for(const replace of [false,true])for(const expected_broker_url of ['https://other.invalid','https://broker.invalid:8443']){
  const result=await f.call('broker_setup',{replace,expected_broker_url});
  assert.equal(result.error.code,'configured_broker_mismatch');assert.equal(result.error.effect,'not_applied');
  assert.deepEqual(snapshot(f.root),before);
 }
 assert.equal(f.requests.length,0);
 assert.equal((await f.call('broker_setup')).outcome,'pending','initial setup still accepts no endpoint argument');
 assert.equal(f.requests.length,1);
});

test('rejected replacement leaves active access, pending/cancelled candidate, selection and unread data intact',async t=>{
 const f=await fixture(t),file=join(f.root,'old.json');writePrivateJson(file,f.config);
 assert.equal(saveSelection(file,null,f.installation).saved,true);
 const selection=readSelection(f.installation),identity=await f.call('broker_connect'),inbox=f.inboxes[0];
 const message={protocol_version:'1',message_id:randomUUID(),recipient_id:identity.client_id,recipient_sequence:1,
  sender:{client_id:randomUUID(),client_type:'pi',name:'peer',model:{provider:null,id:null,source:'unknown'},project:null,metadata_revision:1},
  origin:'broker_agent',authority:'untrusted_agent_input',content:{type:'text/plain',text:'retain this unread task'},
  accepted_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),correlation_id:null,reply_to_message_id:null};
 inbox.accept(message);
 const pending=await f.call('broker_setup',{replace:true,expected_broker_url:'HTTPS://BROKER.INVALID:443/'});
 assert.equal(pending.outcome,'pending');assert.equal(pending.connected,true);assert.equal(f.requests.length,1);
 for(const cancelled of [false,true]){
  if(cancelled)await f.call('broker_setup_cancel');
  const before=snapshot(f.root);
  for(const args of [{replace:true},{replace:true,expected_broker_url:'http://broker.invalid'},{replace:true,expected_broker_url:'https://other.invalid'},{expected_broker_url:'https://other.invalid'}]){
   assert((await f.call('broker_setup',args)).error);assert.deepEqual(snapshot(f.root),before);
  }
  assert.equal((await f.call('broker_identity')).client_id,identity.client_id);
  assert.equal(inbox.head().message_id,message.message_id);assert.equal(f.requests.length,1);
 }
 const resumed=await f.call('broker_setup',{replace:true,expected_broker_url:brokerUrl});
 assert.equal(resumed.requestId,pending.requestId);assert.equal(resumed.connected,true);
 assert.equal(f.requests.length,2);assert.equal(f.requests[0].requestId,f.requests[1].requestId);
 assert.equal(inbox.head().message_id,message.message_id);
 assert.deepEqual(readSelection(f.installation),selection);
});

test('rejecting an invocation does not suppress saved pending recovery or initiate another enrollment',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture(t);
 const pending=await beginApproval({brokerUrl,directory:f.installation,clientType:'claude-code'});
 saveSetupContext({broker_url:brokerUrl,selection_revision:null,request_id:pending.requestId,state:'pending'},null,f.installation);
 const before=snapshot(f.root);
 assert.equal((await f.call('broker_setup',{replace:true,expected_broker_url:'https://other.invalid'})).error.code,'configured_broker_mismatch');
 assert.deepEqual(snapshot(f.root),before);
 await f.epoch.tick();t.mock.timers.tick(2000);await settle();
 assert.deepEqual(f.requests.map(x=>x.method),['POST','GET']);
 assert.equal((await f.call('broker_setup_status')).requestId,pending.requestId);
});

test('replacement cannot use model claims as native admission or bypass endpoint and session fences',async t=>{
 const f=await fixture(t,{native:true}),args={replace:true,expected_broker_url:brokerUrl};
 for(const arguments_ of [args,{...args,confirmed:true,human_invoked:true},{...args,_psst_permit:'0'.repeat(64)+'.'+'0'.repeat(64)}]){
  const response=await f.rpc('tools/call',{name:'broker_setup',arguments:arguments_});
  assert.equal(response.error.code,-32000);
 }
 for(const claim of ['confirmed','human_invoked','target_confirmed']){
  const response=await f.rpc('tools/call',{name:'broker_setup',arguments:f.permit('broker_setup',{...args,[claim]:true})});
  assert.equal(response.error.code,-32602,'even a native tool permit cannot make invented confirmation arguments valid');
 }
 assert.equal((await f.call('broker_setup',{replace:true})).error.code,'invalid_reauthorization_endpoint');
 assert.equal((await f.call('broker_setup',{...args,expected_broker_url:'https://other.invalid'})).error.code,'configured_broker_mismatch');
 const admitted=f.permit('broker_setup',args);
 await f.epoch.retire();
 assert.equal((await f.rpc('tools/call',{name:'broker_setup',arguments:admitted})).error.code,-32000,'retired native session cannot dispatch replacement');
 assert.equal(f.requests.length,0);
});

for(const failAttachment of [false,true])test(`native replacement preserves pending intent and old data through approval; attachment failure=${failAttachment}`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture(t,{native:true,failAttachment}),file=join(f.root,'old.json');
 writePrivateJson(file,f.config);writeFileSync(f.config.tokenFile,'fixture-old-credential\n',{mode:0o600});
 assert.equal(saveSelection(file,null,f.installation).saved,true);
 const oldSelection=readSelection(f.installation),oldIdentity=await f.call('broker_connect'),oldInbox=f.inboxes[0];
 const message={protocol_version:'1',message_id:randomUUID(),recipient_id:oldIdentity.client_id,recipient_sequence:1,
  sender:{client_id:randomUUID(),client_type:'pi',name:'peer',model:{provider:null,id:null,source:'unknown'},project:null,metadata_revision:1},
  origin:'broker_agent',authority:'untrusted_agent_input',content:{type:'text/plain',text:'retain unread through replacement'},
  accepted_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),correlation_id:null,reply_to_message_id:null};
 oldInbox.accept(message);
 assert.equal((await f.call('broker_setup_status')).broker_url,brokerUrl);
 const args={replace:true,expected_broker_url:brokerUrl},pending=await f.call('broker_setup',args);
 assert.equal(pending.outcome,'pending');assert.equal(pending.connected,true);assert.equal(pending.candidate_connected,false);
 assert.equal((await f.call('broker_setup',args)).requestId,pending.requestId);
 await f.call('broker_setup_cancel');
 assert.equal((await f.call('broker_setup',args)).requestId,pending.requestId);
 assert.deepEqual(readSelection(f.installation),oldSelection);
 assert.equal(oldInbox.head().message_id,message.message_id);
 assert.deepEqual(f.requests.map(x=>x.method),['POST','POST','POST']);
 assert(f.requests.every(x=>x.requestId===pending.requestId),'explicit repeats reconcile the same durable request');
 f.approve();t.mock.timers.tick(2000);await settle();
 const status=await f.call('broker_setup_status');
 assert.equal(status.requestId,pending.requestId);
 if(failAttachment){
  assert.equal(status.outcome,'approved_not_connected');assert.equal(status.candidate_connected,false);
  assert.equal(status.previous_connection_retained,true);
  assert.deepEqual(readSelection(f.installation),oldSelection);
  assert.equal((await f.call('broker_identity')).client_id,oldIdentity.client_id);
  assert.equal(f.inboxes.at(-1).head().message_id,message.message_id);
  f.allowAttachment();
  const retry=await f.call('broker_setup',{expected_broker_url:brokerUrl});
  assert.equal(retry.requestId,pending.requestId);assert.equal(retry.outcome,'connected');
 }else assert.equal(status.outcome,'connected');
 assert.deepEqual(f.requests.map(x=>x.method),['POST','POST','POST','GET'],'approval polling and approved attachment retry do not enroll again');
 const identity=await f.call('broker_identity');assert.notEqual(identity.client_id,oldIdentity.client_id);
 assert.notEqual(readSelection(f.installation).connection_file,oldSelection.connection_file);
 assert.equal(f.inboxes.at(-1).head(),null,'replacement inbox never replays old messages');
 assert.equal(readFileSync(f.config.tokenFile,'utf8'),'fixture-old-credential\n','replacement never revokes or rewrites old credentials');
 const retained=new Inbox({directory:oldInbox.directory,identity:oldInbox.identity});
 try{assert.equal(retained.head().message_id,message.message_id,'old unread journal remains recoverable');}finally{retained.close();}
});
