#!/usr/bin/env node
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {processIdentity} from '../src/launch-state.mjs';
import {readPluginConfig,nativeStateConfig} from '../src/plugin-state.mjs';
import {selectedConfig} from '../src/installation-selection.mjs';
import {resolveNativeBinding} from '../src/native-binding.mjs';
import {consumeNativePermit} from '../src/native-call-permit.mjs';
import {createNativeEpochManager} from '../src/native-epoch-manager.mjs';
import {createPluginEpoch} from '../src/plugin-epoch.mjs';
import {serveStdio,TOOL_DEFINITIONS} from '../src/cooperative-stdio.mjs';
import {NATIVE_RECEIVE_RESPONSE_BYTES} from '../src/receive-presentation.mjs';
import {verifyReference} from '../src/reference-pin.mjs';

let server,timer,manager,closed=false;
try {
 const root=dirname(dirname(fileURLToPath(import.meta.url)));verifyReference(join(root,'vendor','psst'));
 const [{BrokerClient},{AdapterRuntime},{createTools},{createCooperativeInbox}]=await Promise.all([
  import('../vendor/psst/reference/client.mjs'),import('../vendor/psst/reference/runtime.mjs'),import('../vendor/psst/reference/tools.mjs'),import('../src/cooperative-inbox.mjs')]);
 const dependencies={BrokerClient,AdapterRuntime,createTools,createCooperativeInbox};
 const host=processIdentity(process.ppid);
 const loadLegacy=()=>{try{return (process.env.PSST_CLAUDE_CONFIG||process.env.PSST_CONFIG_FILE)?readPluginConfig():(selectedConfig()??readPluginConfig());}
 catch(error){if(error.code!=='ENOENT')process.stderr.write('psst_default_config_invalid: staying disconnected; provide a valid private connection file.\n');return null;}};
 const hostAlive=()=>{try{const now=processIdentity(host.pid);return now.start===host.start&&now.boot===host.boot;}catch{return false;}};
 manager=createNativeEpochManager({hostAlive,
  resolve(){const legacyConfig=loadLegacy(),nativeConfig=nativeStateConfig(process.env,host,null);const found=resolveNativeBinding({nativeConfig,legacyConfig,host});return found?{...found,nativeConfig,legacyConfig,dependencies}:null;},
  create:createPluginEpoch
 });
 const synchronize=manager.synchronize;
 const nativeAdmission=async(name,args)=>{
  const epoch=await synchronize();
  if(!epoch?.isCurrent())throw Error('session_binding_unavailable');
  const permit=consumeNativePermit({directory:epoch.directory,binding:epoch.binding,toolName:name,args});
  if(!epoch.isCurrent())throw Error('session_changed');
  return {arguments:permit.arguments,tools:epoch.tools,isCurrent:()=>manager.isCurrent(epoch)};
 };
 const advertised=Object.fromEntries(TOOL_DEFINITIONS.map(({name})=>[name,()=>{throw Error('native_admission_required');}]));
 const close=async()=>{closed=true;clearInterval(timer);await manager.close();};
 server=serveStdio({tools:advertised,nativeAdmission,readableNativeReceive:true,maxReceiveResponseBytes:NATIVE_RECEIVE_RESPONSE_BYTES,onClose:close,onDiagnostic:()=>{}});
 let ticking=false,blockedNotice=false;
 timer=setInterval(()=>{if(ticking||closed)return;ticking=true;void(async()=>{const epoch=await synchronize();await epoch?.tick();blockedNotice=false;})().catch(error=>{if(error.message==='native_host_departed'){void server.close();return;}if(!blockedNotice){blockedNotice=true;process.stderr.write('psst_native_binding_unavailable: catalog retained; no new lifetime admitted.\n');}}).finally(()=>{ticking=false;});},250);
 await server.done;
}catch{process.stderr.write('psst_mcp_unavailable: native session/configuration check failed; no message was acknowledged.\n');process.exitCode=1;}
finally{closed=true;clearInterval(timer);await server?.close();await manager?.close();}
