#!/usr/bin/env node
import {dirname} from 'node:path';
import {resolveNativeBinding,associateNativeBinding} from '../src/native-binding.mjs';
import {issueNativePermit} from '../src/native-call-permit.mjs';
import {selectedConfig} from '../src/installation-selection.mjs';
import {processIdentity} from '../src/launch-state.mjs';
import { readPluginConfig, nativeStateConfig, pluginHook } from '../src/plugin-state.mjs';
try {
  let size=0; const chunks=[];
  for await (const chunk of process.stdin) { size+=chunk.length; if(size>256*1024) throw new Error('hook_too_large'); chunks.push(chunk); }
  const event=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const host=processIdentity(process.ppid),nativeConfig=nativeStateConfig(process.env,host,event.session_id);
  let result;
  if(event.hook_event_name==='PreToolUse'){
    let legacyConfig=null;try{legacyConfig=(process.env.PSST_CLAUDE_CONFIG||process.env.PSST_CONFIG_FILE)?readPluginConfig():(selectedConfig()??readPluginConfig());}catch{}
    const resolved=resolveNativeBinding({nativeConfig,legacyConfig,host,sessionId:event.session_id});
    if(!resolved)throw Error('native_binding_unavailable');
    result=pluginHook({stateRoot:dirname(resolved.directory)},event,host);
    if(!result){const issued=issueNativePermit({...resolved,event});result={hookSpecificOutput:{hookEventName:'PreToolUse',updatedInput:issued.arguments}};}
  }else{
    let legacyConfig=null;try{legacyConfig=(process.env.PSST_CLAUDE_CONFIG||process.env.PSST_CONFIG_FILE)?readPluginConfig():(selectedConfig()??readPluginConfig());}catch{}
    // Resolve the previously committed owner BEFORE modifying canonical state.
    let previous;try{previous=resolveNativeBinding({nativeConfig,legacyConfig,host,sessionId:event.session_id});}catch(error){if(event.hook_event_name!=='SessionStart'||event.source==='compact')throw error;}
    if(event.hook_event_name==='SessionStart'&&event.source==='compact'&&!previous)throw Error('compact_authority_unavailable');
    result=pluginHook(nativeConfig,event,host);
    const chosen=previous?{stateRoot:previous.authorityRoot}:legacyConfig;
    if(chosen&&chosen.stateRoot!==nativeConfig.stateRoot)pluginHook(chosen,event,host);
    if(event.hook_event_name==='SessionStart'&&!event.agent_id)associateNativeBinding({nativeConfig,legacyConfig:chosen,host,sessionId:event.session_id});
  }
  if(result) process.stdout.write(JSON.stringify(result)+'\n');
} catch {
  process.stderr.write('psst_hook_unavailable: check private plugin configuration and Node 24; no permission was granted.\n');
  process.exitCode=2;
}
