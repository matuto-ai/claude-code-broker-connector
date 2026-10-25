#!/usr/bin/env node
import { homedir } from 'node:os';
import { connectPairingFile } from '../src/enrollment-support.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { readPrivateJson, writePrivateJson, privateDirectory } from '../src/launch-state.mjs';
import { verifyReference } from '../src/reference-pin.mjs';
import { readPluginConfig, nativeStateConfig, hostDirectory, readBinding, verifyBinding, bindingModel, journalName, refreshEnrollment } from '../src/plugin-state.mjs';

let server,runtime,inbox,timer,live=true,expected,directory,host,tools,connected=false,connecting=false,disabled=false,generation=0,autoAttempted=false;
let legacyConfig=null,connectedConfig=null,lastNotice=null,lastNoticeAt=0;
const failure=(code,effect='not_applied')=>({error:{code,retryable:true,effect}});
const bound=()=>live&&expected&&verifyBinding(directory,expected);
const active=()=>connected&&bound();
function status(){
 if(!directory||!expected)return;
 const head=connected&&inbox?inbox.head():null;
 const value={host,sessionId:expected.sessionId,lifetime:expected.lifetime,connected:!!active(),pending_id:head?.state==='pending'?head.message_id:null};
 const key=JSON.stringify(value),now=Date.now();
 if(key===lastNotice&&now-lastNoticeAt<2000)return;
 writePrivateJson(join(directory,'notice.json'),{...value,updated_at:now});lastNotice=key;lastNoticeAt=now;
}
function monitorAttention(){
 try{const s=readPrivateJson(join(directory,'monitor-state.json'));if(s.sessionId===expected.sessionId&&s.lifetime===expected.lifetime&&s.pending_id===(inbox?.head()?.message_id??null)&&Date.now()-s.updated_at>=0&&Date.now()-s.updated_at<5000)return {attention_required:s.attention_required===true,rate_limited:s.rate_limited===true,next_retry_at:s.next_retry_at};}catch{}
 return {state:'not_observed'};
}
async function stop(closeSession){connected=false;status();await runtime?.stop({closeSession});inbox?.close();runtime=null;inbox=null;tools=null;}
try {
 const root=dirname(dirname(fileURLToPath(import.meta.url)));verifyReference(join(root,'vendor','psst'));
 const [{Inbox,newSessionIdentity},{BrokerClient},{AdapterRuntime},{createTools},{createCooperativeInbox},{serveStdio}]=await Promise.all([
 import('../vendor/psst/reference/inbox.mjs'),import('../vendor/psst/reference/client.mjs'),import('../vendor/psst/reference/runtime.mjs'),import('../vendor/psst/reference/tools.mjs'),import('../src/cooperative-inbox.mjs'),import('../src/cooperative-stdio.mjs')]);
 try{legacyConfig=readPluginConfig();}catch(error){
  if(error.code!=='ENOENT')process.stderr.write('psst_default_config_invalid: staying disconnected; provide a valid private connection file.\n');
 }
 const native=hostDirectory(nativeStateConfig());({directory,host}=native);
 function confirm(){
  if(expected)return bound();
  for(const candidate of [...legacyConfig?[hostDirectory(legacyConfig,host).directory]:[],native.directory]){
   try{const b=readBinding(candidate);if(b.host.pid===host.pid&&verifyBinding(candidate,b)){directory=candidate;expected=b;return true;}}catch{}
  }return false;
 }
 async function connect(config){
  config=refreshEnrollment(config);
  if(connecting)return failure('connection_busy');
  if(!confirm())return failure('session_binding_unavailable');
  if(connected)return connectedConfig.brokerUrl===config.brokerUrl&&connectedConfig.tokenFile===config.tokenFile&&connectedConfig.enrollment?.credentialId===config.enrollment?.credentialId?tools.broker_identity():failure('connection_conflict');
  connecting=true;disabled=false;const epoch=generation;
  try{
   const journal=privateDirectory(join(directory,journalName(expected.lifetime,config)));
   const pin=join(journal,'connection.json');
   // One lifetime cannot silently adopt a different broker or credential path.
   try{const old=readPrivateJson(pin);if(old.brokerUrl!==config.brokerUrl||old.tokenFile!==config.tokenFile) return failure('connection_conflict');}
   catch(e){if(e.code!=='ENOENT')throw e;writePrivateJson(pin,{brokerUrl:config.brokerUrl,tokenFile:config.tokenFile});}
   const identityFile=join(journal,'identity.json');
   try{writeFileSync(identityFile,JSON.stringify(newSessionIdentity('claude-code'))+'\n',{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
   const identity=readPrivateJson(identityFile);inbox=new Inbox({directory:journal,identity});
   const client=new BrokerClient({url:config.brokerUrl,tokenFile:config.tokenFile,caFile:config.caFile,insecureDevelopment:config.insecureDevelopment===true,inbox});
   runtime=new AdapterRuntime({client,inbox,verifySession:bound,isAlive:bound,onDiagnostic:({code})=>process.stderr.write(`psst_${code}\n`)});
   tools={...createTools({client,inbox,observeMetadata:()=>({model:bindingModel(readBinding(directory))})}),...createCooperativeInbox({inbox,isActive:active}),
    broker_identity:async()=>({credential_id:config.enrollment?.credentialId??null,credential_expires_at:config.enrollment?.expiresAt??null,monitor_attention:monitorAttention(),client_id:identity.client_id,client_type:'claude-code',native_session_id:expected.sessionId,local_mode:'cooperative_read_with_bounded_monitor_notices',automatic_wakeup:'monitor_requires_interactive_connect_skill',native_acceptance_recorded:false})};
   await runtime.start({name:config.name,project:config.project??null,model:bindingModel(expected)});
   if(!bound()||generation!==epoch||disabled)throw Error('session_changed');connected=true;connectedConfig=config;disabled=false;writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:false,config});status();return tools.broker_identity();
  }catch{await stop(!bound());return failure(generation!==epoch?'connection_cancelled':'connection_failed','unknown');}finally{connecting=false;}
 }
 const names=['broker_list_clients','broker_send','broker_update_metadata','broker_message_status','broker_receive','broker_acknowledge','broker_identity'];
 const guarded=Object.fromEntries(names.map(name=>[name,async args=>{
  if(!active())return failure(expected?'not_connected':'session_binding_unavailable');
  const result=await tools[name](args);status();return result;
 }]));
 let pairing=false;
 guarded.broker_connect=async({connection_file})=>{
  // Explicit user intent supersedes deferred startup resume, including failed attempts.
  autoAttempted=true;
  if(pairing||connecting)return failure('connection_busy');
  if(!confirm())return failure('session_binding_unavailable');
  try{
   const input=readPrivateJson(connection_file);
   if(input?.format==='psst-pairing-v1'){
    if(connected)return failure('disconnect_before_pairing');
    pairing=true;const epoch=generation;
    const result=await connectPairingFile({pairingFile:connection_file,directory:join(homedir(),'.config','psst','enrollment'),clientType:'claude-code'});
    if(epoch!==generation||!bound())return failure('connection_cancelled','unknown');
    return await connect(readPluginConfig(result.connectionFile));
   }
   return await connect(readPluginConfig(connection_file));
  }catch(error){return failure(error.effect==='unknown'?'enrollment_or_connection_uncertain':'invalid_connection_file',error.effect==='unknown'?'unknown':'not_applied');}
  finally{pairing=false;}
 };
 guarded.broker_disconnect=async()=>{autoAttempted=true;generation++;disabled=true;connected=false;if(expected)writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:true});status();if(connecting)void runtime?.stop({closeSession:false}).catch(()=>{});else await stop(false);return{connected:false,pending_connection_cancelled:connecting||pairing,pending_retained:true,native_acceptance_recorded:false};};
 server=serveStdio({tools:guarded,onClose:async()=>{const closeSession=!bound();generation++;live=false;await stop(closeSession);},onDiagnostic:()=>{}});
 // Stay available while disconnected. Never retry failed enrollment/auth indefinitely.
 timer=setInterval(()=>{void(async()=>{
  if(expected&&!bound()){live=false;await server.close();return;}
  if(!expected)confirm();
  if(expected&&!autoAttempted&&!disabled){
   autoAttempted=true;let config=legacyConfig;
   try{const a=readPrivateJson(join(directory,'activation.json'));if(a.sessionId===expected.sessionId&&a.lifetime===expected.lifetime){disabled=a.disabled===true;config=a.config??null;}}catch{}
   if(config&&!disabled)await connect(config);
  }
  if(active())status();
 })().catch(()=>{live=false;void server.close();});},250);
 await server.done;
}catch{process.stderr.write('psst_mcp_unavailable: native session/configuration check failed; no message was acknowledged.\n');process.exitCode=1;}
finally{if(timer)clearInterval(timer);live=false;await server?.close();await runtime?.stop({closeSession:true});inbox?.close();}
