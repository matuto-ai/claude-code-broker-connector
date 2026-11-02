// Synthetic trusted hook input for transport tests; NOT an authenticated native host proof.
import {randomUUID} from 'node:crypto';
import {hostDirectory,readBinding} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
import {issueNativePermit} from '../src/native-call-permit.mjs';
export function fixtureArguments({config,sessionId,host=processIdentity(process.pid),name,args={}}){
 const {directory}=hostDirectory(config,host),binding=readBinding(directory);
 return issueNativePermit({directory,binding,event:{session_id:sessionId,tool_use_id:'synthetic_'+randomUUID(),tool_name:'mcp__plugin_psst_psst__'+name,tool_input:args}}).arguments;
}
// Complete the trusted SessionStart transaction in synthetic host fixtures.
import {pluginHook} from '../src/plugin-state.mjs';
import {resolveNativeBinding,associateNativeBinding} from '../src/native-binding.mjs';
export function fixtureHook(config,event,host=processIdentity(process.pid)){
 let previous;try{previous=resolveNativeBinding({nativeConfig:config,host,sessionId:event.session_id});}catch(error){if(event.hook_event_name!=='SessionStart'||event.source==='compact')throw error;}
 const result=pluginHook(config,event,host);
 if(event.hook_event_name==='SessionStart'&&!event.agent_id)associateNativeBinding({nativeConfig:config,legacyConfig:previous?{stateRoot:previous.authorityRoot}:null,host,sessionId:event.session_id});
 return result;
}
