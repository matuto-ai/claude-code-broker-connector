#!/usr/bin/env node
import { installationRoot, readSelection, selectedConfig, saveSelection, configuredBrokerUrl, enforceConfiguredBroker } from '../src/installation-selection.mjs';
import { connectPairingFile } from '../src/enrollment-support.mjs';
import {switchApproved} from '../src/approval-attachment.mjs';
import {ApprovalSession} from '../src/approval-session.mjs';
import {beginApproval,pollApproval,readApprovalState} from '../src/approval-support.mjs';
import {readSetupContext,saveSetupContext} from '../src/setup-context.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { readPrivateJson, writePrivateJson, privateDirectory } from '../src/launch-state.mjs';
import { verifyReference } from '../src/reference-pin.mjs';
import { readPluginConfig, nativeStateConfig, hostDirectory, readBinding, verifyBinding, bindingModel, journalName, refreshEnrollment } from '../src/plugin-state.mjs';

let server,runtime,inbox,timer,live=true,expected,directory,host,tools,connected=false,connecting=false,disabled=false,generation=0,autoAttempted=false;
let legacyConfig=null,connectedConfig=null,lastNotice=null,lastNoticeAt=0,approvalSession=null,setupContext=null,approvalTransition=null;
const failure=(code,effect='not_applied')=>({error:{code,retryable:true,effect}});
const bound=()=>live&&expected&&verifyBinding(directory,expected);
const active=()=>connected&&bound();
function status(){
 if(!directory||!expected)return;
 const head=connected&&inbox?inbox.head():null;
 const value={host,sessionId:expected.sessionId,lifetime:expected.lifetime,connected:!!active(),pending_id:head?.state==='pending'?head.message_id:null,setup_state:approvalSession?.status?.state??null,setup_connected:approvalSession?.status?.connected===true};
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
 try{legacyConfig=(process.env.PSST_CLAUDE_CONFIG||process.env.PSST_CONFIG_FILE)?readPluginConfig():(selectedConfig()??readPluginConfig());}catch(error){
  if(error.code!=='ENOENT')process.stderr.write('psst_default_config_invalid: staying disconnected; provide a valid private connection file.\n');
 }
 const native=hostDirectory(nativeStateConfig());({directory,host}=native);
 function confirm(){
  if(expected)return bound();
  for(const candidate of [...legacyConfig?[hostDirectory(legacyConfig,host).directory]:[],native.directory]){
   try{const b=readBinding(candidate);if(b.host.pid===host.pid&&verifyBinding(candidate,b)){directory=candidate;expected=b;return true;}}catch{}
  }return false;
 }
 async function connect(config,{allowSavedOrigin=false,validIntent=()=>true}={}){
  config=refreshEnrollment(config);if(!allowSavedOrigin)config=enforceConfiguredBroker(config);
  if(connecting)return failure('connection_busy');
  if(!confirm())return failure('session_binding_unavailable');
  if(connected)return connectedConfig.brokerUrl===config.brokerUrl&&connectedConfig.tokenFile===config.tokenFile&&connectedConfig.enrollment?.credentialId===config.enrollment?.credentialId?tools.broker_identity():failure('connection_conflict');
  if(runtime&&!connected)await stop(false);
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
   runtime=new AdapterRuntime({client,inbox,verifySession:bound,isAlive:bound,onDiagnostic:({code})=>{if(['unauthenticated','forbidden','session_closed'].includes(code)){connected=false;status();}process.stderr.write(`psst_${code}\n`);}});
   tools={...createTools({client,inbox,observeMetadata:()=>({model:bindingModel(readBinding(directory))})}),...createCooperativeInbox({inbox,isActive:active}),
    broker_identity:async()=>({credential_id:config.enrollment?.credentialId??null,credential_expires_at:config.enrollment?.expiresAt??null,monitor_attention:monitorAttention(),client_id:identity.client_id,client_type:'claude-code',native_session_id:expected.sessionId,local_mode:'cooperative_read_with_bounded_monitor_notices',automatic_wakeup:'bounded_monitor_when_interactive',native_acceptance_recorded:false})};
   await runtime.start({name:config.name,project:config.project??null,model:bindingModel(expected)});
   if(!bound()||generation!==epoch||disabled||!validIntent())throw Error('session_changed');connected=true;connectedConfig=config;disabled=false;writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:false,config});status();return tools.broker_identity();
  }catch{await stop(!bound());return failure(generation!==epoch?'connection_cancelled':'connection_failed','unknown');}finally{connecting=false;}
 }
 const names=['broker_list_clients','broker_send','broker_update_metadata','broker_message_status','broker_receive','broker_acknowledge','broker_identity'];
 const guarded=Object.fromEntries(names.map(name=>[name,async args=>{
  if(!active())return failure(expected?'not_connected':'session_binding_unavailable');
  const result=await tools[name](args);status();return result;
 }]));
 let pairing=false;
 const explicitConnect=async({connection_file})=>{
  approvalSession?.cancel();
  // Explicit user intent supersedes deferred startup resume, including failed attempts.
  autoAttempted=true;
  if(pairing||connecting||approvalTransition)return failure('connection_busy');
  if(!confirm())return failure('session_binding_unavailable');
  try{
   let selectionRevision=null,selectionReadable=true;const selectionEpoch=generation;
   try{selectionRevision=readSelection()?.revision??null;}catch{selectionReadable=false;}
   const remember=(result,file)=>{if(!result?.client_id||!active()||selectionEpoch!==generation)return result;let selection;
    if(!selectionReadable)selection={saved:false,reason:'installation_selection_invalid_or_unreadable'};
    else try{selection=saveSelection(file,selectionRevision,installationRoot(),connectedConfig);}catch{selection={saved:false,reason:'installation_selection_unavailable'};}
    return {...result,installation_selection:selection};};
   const input=readPrivateJson(connection_file);
   if(input?.format==='psst-pairing-v1'){
    if(connected)return failure('disconnect_before_pairing');
    pairing=true;const epoch=generation;
    const options={directory:join(installationRoot(),'enrollment'),clientType:'claude-code',brokerUrl:configuredBrokerUrl()??undefined};
    const result=await connectPairingFile({...options,pairingFile:connection_file});
    if(epoch!==generation||!bound())return failure('connection_cancelled','unknown');
    return remember(await connect(readPluginConfig(result.connectionFile)),result.connectionFile);
   }
   return remember(await connect(readPluginConfig(connection_file)),connection_file);
  }catch(error){if(error.message==='configured_broker_mismatch'||error.message==='broker_origin_mismatch')return failure('configured_broker_mismatch');return failure(error.effect==='unknown'?'enrollment_or_connection_uncertain':'invalid_connection_file',error.effect==='unknown'?'unknown':'not_applied');}
  finally{pairing=false;}
 };
 guarded.broker_connect=args=>explicitConnect(args);
 const setupOptions=brokerUrl=>({brokerUrl,directory:installationRoot(),clientType:'claude-code',label:'Claude Code installation'});
 const updateSetup=state=>{
  if(!setupContext||!state.requestId)return;
  try{
   const latest=readSetupContext(),nextState=state.connected?'applied':state.state;
   if(latest?.broker_url===setupContext.broker_url&&latest.selection_revision===setupContext.selection_revision&&latest.request_id===state.requestId){
    setupContext=latest;if(latest.state===nextState||latest.state==='applied')return status();
   }
   setupContext=saveSetupContext({...setupContext,request_id:state.requestId,state:nextState},setupContext.revision);
  }
  catch{/* A competing explicit choice owns selection; never overwrite it. */}
  status();
 };
 approvalSession=new ApprovalSession({beginApproval,pollApproval,readApprovalState,isCurrent:()=>bound()&&!disabled,
  onState:updateSetup,onApproved:async(result,current)=>{
   const context=readSetupContext();
   if(!current()||!context||context.broker_url!==setupContext?.broker_url||context.selection_revision!==setupContext?.selection_revision||(context.revision!==setupContext?.revision&&context.request_id!==result.requestId)||(context.request_id&&context.request_id!==result.requestId))return {connected:false,error:'setup_context_changed'};
   const selection=readSelection();if((selection?.revision??null)!==context.selection_revision&&selection?.connection_file!==result.connectionFile)return {connected:false,error:'installation_selection_changed'};
   const config=readPluginConfig(result.connectionFile),previous=connected?connectedConfig:null;
   if(new URL(config.brokerUrl).origin!==context.broker_url)return {connected:false,error:'configured_broker_mismatch'};
   const transaction={phase:'stopping'};approvalTransition=transaction;
   const restoreAllowed=()=>approvalTransition===transaction&&bound()&&!disabled;
   return switchApproved({previous,stop:()=>stop(false),
    connect:(old,{restore,isCurrent})=>connect(restore?old:config,{allowSavedOrigin:restore,validIntent:isCurrent}),
    select:()=>current()?saveSelection(result.connectionFile,context.selection_revision,installationRoot(),connectedConfig):{saved:false,reason:'connection_cancelled'},
    isCurrent:()=>current()&&approvalTransition===transaction,canRestore:restoreAllowed,
    onPhase:phase=>{
     if(approvalTransition!==transaction)return;
     transaction.phase=phase;
     if(phase==='finished'){
      if(!connected&&expected)writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:true});
      approvalTransition=null;
     }
    }});
  }});
 guarded.broker_setup=async({replace=false}={})=>{
  autoAttempted=true;if(pairing||connecting||approvalSession.busy||approvalTransition)return failure('connection_busy');
  if(!confirm())return failure('session_binding_unavailable');
  try{
   const brokerUrl=configuredBrokerUrl();if(!brokerUrl)return failure('native_setup_configuration_required');
   const old=readSetupContext();
   if(old&&old.broker_url===brokerUrl&&['requested','pending','approved'].includes(old.state)&&!replace){setupContext=old;}
   else setupContext=saveSetupContext({broker_url:brokerUrl,selection_revision:readSelection()?.revision??null,request_id:null,state:'requested'},old?.revision??null);
   disabled=false;writePrivateJson(join(directory,'setup-activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,cancelled:false});
   return await approvalSession.start(setupOptions(brokerUrl),{replace});
  }catch(error){
   // A failed POST may have durable local candidate state. Later startup may GET
   // it, but never invent a new request or retry POST automatically.
   return {...failure(error.retryable?'approval_temporarily_unavailable':'approval_setup_blocked',error.effect??'not_applied'),...(Number.isFinite(error.retryAfterMs)?{retry_after_ms:Math.max(1000,Math.min(300000,error.retryAfterMs))}:{})};
  }
 };
 guarded.broker_setup_status=async()=>{
  if(approvalSession.status.state!=='not_started')return {...approvalSession.status};
  try{const context=readSetupContext();if(!context)return {state:active()?'connected':'setup_required',connected:!!active()};
   const saved=readApprovalState(setupOptions(context.broker_url));return saved?{state:saved.state,requestId:saved.requestId,requestExpiresAt:saved.requestExpiresAt,connected:!!active()}:{state:'setup_required',connected:!!active()};
  }catch{return {state:'blocked',error:'invalid_saved_setup',connected:!!active()};}
 };
 guarded.broker_setup_cancel=async()=>{approvalSession.cancel();if(approvalTransition&&['stopping','attaching','selecting'].includes(approvalTransition.phase))generation++;if(expected)writePrivateJson(join(directory,'setup-activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,cancelled:true});return {state:'cancelled',existing_connection_retained:!!active()};};
 guarded.broker_disconnect=async()=>{approvalSession.cancel();autoAttempted=true;generation++;disabled=true;connected=false;if(expected)writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:true});status();if(connecting)void runtime?.stop({closeSession:false}).catch(()=>{});else await stop(false);return{connected:false,pending_connection_cancelled:connecting||pairing,pending_retained:true,native_acceptance_recorded:false};};
 server=serveStdio({tools:guarded,onClose:async()=>{const closeSession=!bound();approvalSession?.cancel();generation++;live=false;await stop(closeSession);},onDiagnostic:()=>{}});
 // Stay available while disconnected. Never retry failed enrollment/auth indefinitely.
 timer=setInterval(()=>{void(async()=>{
  if(expected&&!bound()){live=false;await server.close();return;}
  if(!expected)confirm();
  if(expected&&!autoAttempted&&!disabled){
   autoAttempted=true;let config=legacyConfig;
   try{const a=readPrivateJson(join(directory,'activation.json'));if(a.sessionId===expected.sessionId&&a.lifetime===expected.lifetime){disabled=a.disabled===true;config=a.config??null;}}catch{}
   let resumeOptions=null;
   try{
    const saved=readSetupContext(),cancel=(()=>{try{return readPrivateJson(join(directory,'setup-activation.json'));}catch{return null;}})();
    if(saved&&['requested','pending','approved'].includes(saved.state)&&!(cancel?.sessionId===expected.sessionId&&cancel?.lifetime===expected.lifetime&&cancel?.cancelled)&&!disabled){
     const local=readApprovalState(setupOptions(saved.broker_url));
     if(local&&(!saved.request_id||saved.request_id===local.requestId)){setupContext=saved;resumeOptions=setupOptions(saved.broker_url);}
    }
   }catch{process.stderr.write('psst_setup_resume_unavailable: existing request state is invalid; no new request created.\n');}
   if(config&&!disabled){
    try{const result=await connect(config,{allowSavedOrigin:!!resumeOptions&&setupContext.selection_revision===(readSelection()?.revision??null)});if(result?.error)process.stderr.write('psst_autoconnect_unavailable: saved installation could not attach; use explicit connect after correcting configuration.\n');}
    catch{process.stderr.write('psst_autoconnect_unavailable: saved installation or configured broker is invalid; use explicit connect after correcting configuration.\n');}
   }
   if(resumeOptions&&!disabled)await approvalSession.resume(resumeOptions);
  }
  if(active())status();
 })().catch(()=>{live=false;void server.close();});},250);
 await server.done;
}catch{process.stderr.write('psst_mcp_unavailable: native session/configuration check failed; no message was acknowledged.\n');process.exitCode=1;}
finally{approvalSession?.cancel();if(timer)clearInterval(timer);live=false;await server?.close();await runtime?.stop({closeSession:true});inbox?.close();}
