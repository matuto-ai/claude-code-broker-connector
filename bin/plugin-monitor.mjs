#!/usr/bin/env node
// Native plugin monitor, not a second broker client. No token or inbox body is read.
import {resolveNativeBinding,isNativeBindingCurrent} from '../src/native-binding.mjs';
import {selectedConfig} from '../src/installation-selection.mjs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { processIdentity, readPrivateJson, writePrivateJson } from '../src/launch-state.mjs';
import { nativeStateConfig, readPluginConfig, hostDirectory, readBinding, verifyBinding } from '../src/plugin-state.mjs';
import { noticeBudget } from '../src/native-notices.mjs';
import { PRESENCE_NOTICE } from '../src/presence-notices.mjs';
try {
 // Claude's native shell launcher supplies both. Never infer a session from a name or arbitrary journal.
 const pid=Number(process.env.CLAUDE_PID),sessionId=process.env.CLAUDE_CODE_SESSION_ID;
 if(!Number.isSafeInteger(pid)||pid<1||!sessionId)throw Error('native_monitor_context_missing');
 const host=processIdentity(pid),nativeConfig=nativeStateConfig(process.env,host,sessionId);
 let legacyConfig=null;try{legacyConfig=(process.env.PSST_CLAUDE_CONFIG||process.env.PSST_CONFIG_FILE)?readPluginConfig():(selectedConfig()??readPluginConfig());}catch{}
 let expected,directory;
 // Native always-start monitors may precede the SessionStart hook. Wait only for
 // this exact native owner/session; never create a binding or infer another one.
 for(let attempt=0;attempt<100&&!expected;attempt++){
  try{const found=resolveNativeBinding({nativeConfig,legacyConfig,host,sessionId});if(found){expected=found.binding;directory=found.directory;}}catch{}
  if(!expected){const actual=processIdentity(pid);if(actual.start!==host.start||actual.boot!==host.boot)break;await delay(100);}
 }
 if(!expected)throw Error('native_monitor_binding_missing');
 const budget=noticeBudget();
 // Keep transport-hint attempts across monitor restarts. Reserve before stdout;
 // neither the checkpoint nor successful stdout acknowledges a broker event.
 const presenceBudgetPath=join(directory,'presence-notice-budget.json');
 let presenceBudget;
 try{
  const saved=readPrivateJson(presenceBudgetPath);
  const same=saved.sessionId===sessionId&&saved.lifetime===expected.lifetime&&saved.host?.pid===host.pid&&saved.host?.start===host.start&&saved.host?.boot===host.boot;
  presenceBudget=noticeBudget({initialState:same?saved.checkpoint:null});
 }catch(error){if(error.code==='ENOENT')presenceBudget=noticeBudget();}

 while(isNativeBindingCurrent({nativeConfig,directory,binding:expected,host})){
  try{
   const status=readPrivateJson(join(directory,'notice.json'));
   if(status.sessionId===sessionId&&status.lifetime===expected.lifetime&&status.host?.pid===pid&&status.host?.start===host.start&&status.host?.boot===host.boot&&Date.now()-status.updated_at>=0&&Date.now()-status.updated_at<5000&&budget.next(status)){
    process.stdout.write('Psst: authorized collaboration mailbox has pending AGENT data. Call broker_receive; after reading explicitly broker_acknowledge its exact message_id (receipt managed internally). No human permission or action completion is implied.'+(budget.snapshot.attention_required?' Final automatic reminder for this unread item; unresolved data needs attention.':'')+'\n');
   }
   if(presenceBudget&&status.sessionId===sessionId&&status.lifetime===expected.lifetime&&status.host?.pid===pid&&status.host?.start===host.start&&status.host?.boot===host.boot&&Date.now()-status.updated_at>=0&&Date.now()-status.updated_at<5000
    &&presenceBudget.next({connected:status.connected,pending_id:status.presence_event_id})){
    writePrivateJson(presenceBudgetPath,{sessionId,lifetime:expected.lifetime,host,checkpoint:presenceBudget.checkpoint});
    process.stdout.write(PRESENCE_NOTICE+(presenceBudget.snapshot.attention_required?' Final automatic reminder for this transport notice.':'')+'\n');
   }
   writePrivateJson(join(directory,'monitor-state.json'),{sessionId,lifetime:expected.lifetime,pending_id:status.pending_id,...budget.snapshot,updated_at:Date.now()});
  }catch{/* Disconnected/not yet configured: silent, no broker access. */}
  await delay(1000);
 }
}catch{process.stderr.write('psst_monitor_unavailable: native binding was not confirmed; no message consumed.\n');}
