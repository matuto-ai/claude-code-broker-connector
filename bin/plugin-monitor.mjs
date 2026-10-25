#!/usr/bin/env node
// Native plugin monitor, not a second broker client. No token or inbox body is read.
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { processIdentity, readPrivateJson, writePrivateJson } from '../src/launch-state.mjs';
import { nativeStateConfig, readPluginConfig, hostDirectory, readBinding, verifyBinding } from '../src/plugin-state.mjs';
import { noticeBudget } from '../src/native-notices.mjs';
try {
 // Claude's native shell launcher supplies both. Never infer a session from a name or arbitrary journal.
 const pid=Number(process.env.CLAUDE_PID),sessionId=process.env.CLAUDE_CODE_SESSION_ID;
 if(!Number.isSafeInteger(pid)||pid<1||!sessionId)throw Error('native_monitor_context_missing');
 const host=processIdentity(pid),candidates=[];
 try{candidates.push(hostDirectory(readPluginConfig(),host).directory);}catch{}
 candidates.push(hostDirectory(nativeStateConfig(),host).directory);
 let expected,directory;
 // Native always-start monitors may precede the SessionStart hook. Wait only for
 // this exact native owner/session; never create a binding or infer another one.
 for(let attempt=0;attempt<100&&!expected;attempt++){
  for(const candidate of candidates){try{const b=readBinding(candidate);if(b.sessionId===sessionId&&b.host.pid===pid&&verifyBinding(candidate,b)){expected=b;directory=candidate;break;}}catch{}}
  if(!expected){const actual=processIdentity(pid);if(actual.start!==host.start||actual.boot!==host.boot)break;await delay(100);}
 }
 if(!expected)throw Error('native_monitor_binding_missing');
 const budget=noticeBudget();
 while(verifyBinding(directory,expected)){
  try{
   const status=readPrivateJson(join(directory,'notice.json'));
   if(status.sessionId===sessionId&&status.lifetime===expected.lifetime&&status.host?.pid===pid&&status.host?.start===host.start&&status.host?.boot===host.boot&&Date.now()-status.updated_at>=0&&Date.now()-status.updated_at<5000&&budget.next(status)){
    process.stdout.write('Psst: authorized collaboration mailbox has pending AGENT data. Call broker_receive; after reading explicitly broker_acknowledge its exact receipt. No human permission or action completion is implied.'+(budget.snapshot.attention_required?' Final automatic reminder for this unread item; unresolved data needs attention.':'')+'\n');
   }
   writePrivateJson(join(directory,'monitor-state.json'),{sessionId,lifetime:expected.lifetime,pending_id:status.pending_id,...budget.snapshot,updated_at:Date.now()});
  }catch{/* Disconnected/not yet configured: silent, no broker access. */}
  await delay(1000);
 }
}catch{process.stderr.write('psst_monitor_unavailable: native binding was not confirmed; no message consumed.\n');}
