#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { readPrivateJson, writePrivateJson, privateDirectory } from '../src/launch-state.mjs';
import { verifyReference } from '../src/reference-pin.mjs';
import { readPluginConfig, nativeStateConfig, hostDirectory, readBinding, verifyBinding, bindingModel } from '../src/plugin-state.mjs';

let server,runtime,inbox,timer,live=true,expected,directory,host,tools,connected=false,connecting=false,disabled=false;
let legacyConfig=null,connectedConfig=null;
const failure=(code,effect='not_applied')=>({error:{code,retryable:true,effect}});
const bound=()=>live&&expected&&verifyBinding(directory,expected);
const active=()=>connected&&bound();
async function stop(closeSession){connected=false;await runtime?.stop({closeSession});inbox?.close();runtime=null;inbox=null;tools=null;}
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
  if(connecting)return failure('connection_busy');
  if(!confirm())return failure('session_binding_unavailable');
  if(connected)return connectedConfig.brokerUrl===config.brokerUrl&&connectedConfig.tokenFile===config.tokenFile?tools.broker_identity():failure('connection_conflict');
  connecting=true;
  try{
   const journal=privateDirectory(join(directory,`inbox-${expected.lifetime}`));
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
    broker_identity:async()=>({client_id:identity.client_id,client_type:'claude-code',native_session_id:expected.sessionId,local_mode:'cooperative_pull',automatic_wakeup:false,native_acceptance_recorded:false})};
   await runtime.start({name:config.name,project:config.project??null,model:bindingModel(expected)});
   if(!bound())throw Error('session_changed');connected=true;connectedConfig=config;disabled=false;writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:false,config});return tools.broker_identity();
  }catch{await stop(false);return failure('connection_failed','unknown');}finally{connecting=false;}
 }
 const names=['broker_list_clients','broker_send','broker_update_metadata','broker_message_status','broker_receive','broker_acknowledge','broker_identity'];
 const guarded=Object.fromEntries(names.map(name=>[name,async args=>{
  if(!active())return failure(expected?'not_connected':'session_binding_unavailable');
  return tools[name](args);
 }]));
 guarded.broker_connect=async({connection_file})=>{try{return await connect(readPluginConfig(connection_file));}catch{return failure('invalid_connection_file');}};
 guarded.broker_disconnect=async()=>{if(connecting)return failure('connection_busy');disabled=true;if(expected)writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:true});await stop(false);return{connected:false,pending_retained:true,native_acceptance_recorded:false};};
 server=serveStdio({tools:guarded,onClose:async()=>{const closeSession=!bound();live=false;await stop(closeSession);},onDiagnostic:()=>{}});
 // Stay available while disconnected. Never retry failed enrollment/auth indefinitely.
 let autoAttempted=false;
 timer=setInterval(()=>{void(async()=>{
  if(expected&&!bound()){live=false;await server.close();return;}
  if(!expected)confirm();
  if(expected&&!autoAttempted&&!disabled){
   autoAttempted=true;let config=legacyConfig;
   try{const a=readPrivateJson(join(directory,'activation.json'));if(a.sessionId===expected.sessionId&&a.lifetime===expected.lifetime){disabled=a.disabled===true;config=a.config??null;}}catch{}
   if(config&&!disabled)await connect(config);
  }
 })().catch(()=>{live=false;void server.close();});},250);
 await server.done;
}catch{process.stderr.write('psst_mcp_unavailable: native session/configuration check failed; no message was acknowledged.\n');process.exitCode=1;}
finally{if(timer)clearInterval(timer);live=false;await server?.close();await runtime?.stop({closeSession:true});inbox?.close();}
