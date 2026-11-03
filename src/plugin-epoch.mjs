import {isNativeBindingCurrent} from './native-binding.mjs';
import { projectMetadata } from './project-metadata.mjs';
import {NativeIncarnation,registrationVersion} from './native-incarnation.mjs';
import { createToolScope } from './tool-scope.mjs';
import { deliveryStatus } from './delivery-status.mjs';
import { PresenceNotices } from './presence-notices.mjs';
import { installationRoot, readSelection, saveSelection, configuredBrokerUrl, enforceConfiguredBroker } from './installation-selection.mjs';
import { connectPairingFile } from './enrollment-support.mjs';
import {switchApproved} from './approval-attachment.mjs';
import {ApprovalSession} from './approval-session.mjs';
import {beginApproval,pollApproval,readApprovalState} from './approval-support.mjs';
import {readSetupContext,saveSetupContext} from './setup-context.mjs';
import { join } from 'node:path';
import { readPrivateJson, writePrivateJson, privateDirectory, processIdentity } from './launch-state.mjs';
import { readPluginConfig, readBinding, verifyBinding, bindingModel, journalName, refreshEnrollment } from './plugin-state.mjs';


/** One verified native binding owns every runtime, callback and admitted operation. */
export function createPluginEpoch({directory,host,binding:expected,nativeConfig,legacyConfig,dependencies}) {
 const {BrokerClient,AdapterRuntime,createTools,createCooperativeInbox}=dependencies;
 const lifetimeScope=createToolScope();
 let retiring=null,ticking=null,revoked=false;
let incarnation,currentClient,expiredConfig,toolScope,connectionAbort,recoveryPromise,runtime,inbox,live=true,tools,connected=false,connecting=false,disabled=false,generation=0,autoAttempted=false;
let notices=null;
let connectedConfig=null,lastNotice=null,lastNoticeAt=0,approvalSession=null,setupContext=null,approvalTransition=null;
const failure=(code,effect='not_applied')=>({error:{code,retryable:true,effect}});
const bound=()=>{if(!live||revoked)return false;if(!verifyBinding(directory,expected)||!isNativeBindingCurrent({nativeConfig,directory,binding:expected,host})){revoked=true;return false;}return true;};
const active=()=>connected&&bound();
// Admission unavailability (including a partial/corrupt authority transaction)
// is not proof that this durable broker incarnation ended.
const ended=()=>{
 try{const p=processIdentity(host.pid);if(p.start!==host.start||p.boot!==host.boot)return true;}catch(error){return error.code==='ENOENT'||error.message==='process_not_alive';}
 try{const b=readBinding(directory);return b?.host?.pid===host.pid&&b.host.start===host.start&&b.host.boot===host.boot&&typeof b.closed==='boolean'&&typeof b.sessionId==='string'&&b.sessionId.length>0&&b.sessionId.length<=256&&!/[\u0000-\u001f\u007f-\u009f]/u.test(b.sessionId)&&typeof b.lifetime==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.lifetime)&&(b.closed===true||b.sessionId!==expected.sessionId||b.lifetime!==expected.lifetime);}catch{return false;}
};
function status(){
 if(!directory||!expected)return;
 const head=connected&&inbox?inbox.head():null;
 const value={host,sessionId:expected.sessionId,lifetime:expected.lifetime,connected:!!active(),pending_id:head?.state==='pending'?head.message_id:null,presence_event_id:notices?.pendingId()??null,setup_state:approvalSession?.status?.state??null,setup_connected:approvalSession?.status?.connected===true};
 const key=JSON.stringify(value),now=Date.now();
 if(key===lastNotice&&now-lastNoticeAt<2000)return;
 writePrivateJson(join(directory,'notice.json'),{...value,updated_at:now});lastNotice=key;lastNoticeAt=now;
}
function monitorAttention(){
 try{const s=readPrivateJson(join(directory,'monitor-state.json'));if(s.sessionId===expected.sessionId&&s.lifetime===expected.lifetime&&s.pending_id===(inbox?.head()?.message_id??null)&&Date.now()-s.updated_at>=0&&Date.now()-s.updated_at<5000)return {attention_required:s.attention_required===true,rate_limited:s.rate_limited===true,next_retry_at:s.next_retry_at};}catch{}
 return {state:'not_observed'};
}
async function stop(closeSession){connected=false;status();connectionAbort?.abort();await notices?.stop();notices=null;await toolScope?.close();await recoveryPromise?.catch(()=>{});recoveryPromise=null;await runtime?.stop({closeSession});incarnation?.close();incarnation=null;inbox=null;currentClient=null;expiredConfig=null;runtime=null;tools=null;}
 const confirm=()=>bound();
 async function connect(config,{allowSavedOrigin=false,validIntent=()=>true,reuseIncarnation=false}={}){
  config=refreshEnrollment(config);if(!allowSavedOrigin)config=enforceConfiguredBroker(config);
  if(connecting)return failure('connection_busy');
  if(!confirm())return failure('session_binding_unavailable');
  if(connected)return connectedConfig.brokerUrl===config.brokerUrl&&connectedConfig.tokenFile===config.tokenFile&&connectedConfig.enrollment?.credentialId===config.enrollment?.credentialId?tools.broker_identity():failure('connection_conflict');
  if(runtime&&!connected&&!reuseIncarnation)await stop(false);
  connecting=true;disabled=false;const epoch=generation;
  try{
   const journal=privateDirectory(join(directory,journalName(expected.lifetime,config)));
   const pin=join(journal,'connection.json');
   // One lifetime cannot silently adopt a different broker or credential path.
   try{const old=readPrivateJson(pin);if(old.brokerUrl!==config.brokerUrl||old.tokenFile!==config.tokenFile) return failure('connection_conflict');}
   catch(e){if(e.code!=='ENOENT')throw e;writePrivateJson(pin,{brokerUrl:config.brokerUrl,tokenFile:config.tokenFile});}
   const selection={directory:journal,scope:{native:expected.sessionId,lifetime:expected.lifetime,broker:config.brokerUrl,tokenFile:config.tokenFile,credential:config.enrollment?.credentialId??null},registrationVersion:registrationVersion(config)};
   if(!reuseIncarnation)incarnation=new NativeIncarnation(selection);
   incarnation.assertSelection(selection);
   inbox=incarnation.inbox;const identity=inbox.identity;
   connectionAbort=new AbortController();toolScope=createToolScope();
   const client=new BrokerClient({url:config.brokerUrl,tokenFile:config.tokenFile,caFile:config.caFile,insecureDevelopment:config.insecureDevelopment===true,inbox,registrationVersion:registrationVersion(config)});
   currentClient=client;expiredConfig=config;
   notices=new PresenceNotices({client,inbox,isAlive:active,signal:connectionAbort.signal,diagnostic:()=>{}});
   runtime=new AdapterRuntime({client,inbox,verifySession:bound,isAlive:bound,closeOnLostSession:false,onDiagnostic:({code})=>{if(['unauthenticated','forbidden','session_closed','session_expired','registration_upgrade_required'].includes(code)){connected=false;status();}process.stderr.write(`psst_${code}\n`);}});
   tools={...createTools({client,inbox,observeMetadata:()=>{const observed=readBinding(directory);if(!bound()||observed.sessionId!==expected.sessionId||observed.lifetime!==expected.lifetime)throw Error('session_changed');return {model:bindingModel(observed),project:projectMetadata(config)};}}),...createCooperativeInbox({inbox,isActive:active}),
    broker_presence_events:()=>notices.read(),
    broker_acknowledge_presence_event:({event_id})=>notices.acknowledge(event_id),
    broker_identity:async()=>{const attention=monitorAttention();return {credential_id:config.enrollment?.credentialId??null,credential_expires_at:config.enrollment?.expiresAt??null,monitor_attention:attention,client_id:identity.client_id,client_type:'claude-code',native_session_id:expected.sessionId,local_mode:'native_monitor_delivery',...deliveryStatus({connected:!!active(),monitorAttention:attention})};}};
   await runtime.start({name:config.name,project:projectMetadata(config),model:bindingModel(expected)});
   if(!bound()||generation!==epoch||disabled||!validIntent())throw Error('session_changed');
   recoveryPromise=client.recoverOutgoing({limit:10,signal:AbortSignal.any([connectionAbort.signal,AbortSignal.timeout(5000)])});
   await recoveryPromise.catch(()=>{});
   if(!bound()||generation!==epoch||disabled||!validIntent())throw Error('session_changed');connected=true;connectedConfig=config;disabled=false;writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:false,config});status();return tools.broker_identity();
  }catch(error){if(error.code==='session_expired'&&bound()){connected=false;await runtime?.stop({closeSession:false});status();return failure('session_expired');}await stop(ended());return failure(generation!==epoch?'connection_cancelled':'connection_failed','unknown');}finally{connecting=false;}
 }
 const names=['broker_list_clients','broker_send','broker_update_metadata','broker_message_status','broker_receive','broker_acknowledge','broker_identity','broker_sent_history','broker_message_content','broker_resend','broker_cancel','broker_presence_events','broker_acknowledge_presence_event'];
 const guarded=Object.fromEntries(names.map(name=>[name,async (args,context)=>{
  if(!active())return failure(expected?'not_connected':'session_binding_unavailable');
  return toolScope.run(async signal=>{const result=await tools[name](args,{...context,signal});status();return result;},context?.signal);
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
 approvalSession=new ApprovalSession({beginApproval,pollApproval:options=>lifetimeScope.run(()=>pollApproval(options)),readApprovalState,isCurrent:()=>bound()&&!disabled,
  onState:updateSetup,onApproved:(result,current)=>lifetimeScope.run(async()=>{
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
  })});
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
 const deliveryReadiness=()=>deliveryStatus({connected:!!active(),monitorAttention:monitorAttention()});
 guarded.broker_setup_status=async()=>{
  if(approvalSession.status.state!=='not_started')return {...approvalSession.status,...deliveryReadiness()};
  try{const context=readSetupContext();if(!context)return {state:active()?'connected':'setup_required',connected:!!active(),...deliveryReadiness()};
   const saved=readApprovalState(setupOptions(context.broker_url));return saved?{state:saved.state,requestId:saved.requestId,requestExpiresAt:saved.requestExpiresAt,connected:!!active(),...deliveryReadiness()}:{state:'setup_required',connected:!!active(),...deliveryReadiness()};
  }catch{return {state:'blocked',error:'invalid_saved_setup',connected:!!active(),...deliveryReadiness()};}
 };
 guarded.broker_setup_cancel=async()=>{approvalSession.cancel();if(approvalTransition&&['stopping','attaching','selecting'].includes(approvalTransition.phase))generation++;if(expected)writePrivateJson(join(directory,'setup-activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,cancelled:true});return {state:'cancelled',existing_connection_retained:!!active()};};
 guarded.broker_recover_expired=async()=>{
  if(connecting||pairing||approvalTransition)return failure('connection_busy');
  if(!bound()||registrationVersion(expiredConfig??{})!==2||!currentClient?.expiredIdentityConfirmed||!incarnation||!expiredConfig)return failure('session_mismatch');
  const epoch=generation,config=expiredConfig;connecting=true;connected=false;status();
  try{
   connectionAbort?.abort();await notices?.stop();notices=null;await toolScope?.close();await recoveryPromise?.catch(()=>{});recoveryPromise=null;await runtime?.stop({closeSession:false});
   const valid=()=>bound()&&generation===epoch&&!disabled;
   if(!valid())throw Error('session_changed');
   await incarnation.replace({client:currentClient,verifySession:valid,signal:AbortSignal.timeout(5000)});
   if(!valid())throw Error('session_changed');
   runtime=null;tools=null;connecting=false;
   return await connect(config,{allowSavedOrigin:true,validIntent:valid,reuseIncarnation:true});
  }catch{await stop(false);return failure('replacement_failed','unknown');}finally{connecting=false;}
 };
 guarded.broker_disconnect=async()=>{approvalSession.cancel();autoAttempted=true;generation++;disabled=true;connected=false;if(expected)writePrivateJson(join(directory,'activation.json'),{sessionId:expected.sessionId,lifetime:expected.lifetime,disabled:true});status();if(connecting)void runtime?.stop({closeSession:false}).catch(()=>{});else await stop(false);return{connected:false,pending_connection_cancelled:connecting||pairing,pending_retained:true,...deliveryReadiness()};};

 const scopedTools=Object.fromEntries(Object.entries(guarded).map(([name,handler])=>[name,(args,context)=>lifetimeScope.run(async signal=>{
  if(!bound())return failure('session_changed');
  return handler(args,{...context,signal});
 },context?.signal)]));
 return Object.freeze({directory,host,binding:expected,tools:scopedTools,isCurrent:bound,
  tick(){
   if(!bound()||ticking)return ticking??Promise.resolve();
   ticking=lifetimeScope.run(async()=>{
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
  if(active()){await notices?.tick();if(active())status();}
   }).finally(()=>{ticking=null;});
   return ticking;
  },
  retire({closeSession=ended()}={}){
   if(retiring)return retiring;
   // Revoke admission and last-mile response eligibility before yielding.
   live=false;generation++;connectionAbort?.abort();approvalSession?.cancel();
   retiring=(async()=>{await lifetimeScope.close();await stop(closeSession);})();
   return retiring;
  }
 });
}
