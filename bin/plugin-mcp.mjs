#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { readPrivateJson, privateDirectory } from '../src/launch-state.mjs';
import { verifyReference } from '../src/reference-pin.mjs';
import { readPluginConfig, hostDirectory, readBinding, verifyBinding, bindingModel } from '../src/plugin-state.mjs';

let server, runtime, inbox, monitor, live=true, closeSessionOnExit=true;
try {
  const root=dirname(dirname(fileURLToPath(import.meta.url))), reference=join(root,'vendor','psst');
  verifyReference(reference);
  const [{Inbox,newSessionIdentity},{BrokerClient},{AdapterRuntime},{createTools},{createCooperativeInbox},{serveStdio}]=await Promise.all([
    import('../vendor/psst/reference/inbox.mjs'),import('../vendor/psst/reference/client.mjs'),import('../vendor/psst/reference/runtime.mjs'),import('../vendor/psst/reference/tools.mjs'),import('../src/cooperative-inbox.mjs'),import('../src/cooperative-stdio.mjs')]);
  const config=readPluginConfig(),{directory,host}=hostDirectory(config);
  let expected=null, started=false;
  const active=()=>live && expected && verifyBinding(directory,expected);
  const unavailable=()=>({error:{code:'session_binding_unavailable',retryable:true,effect:'not_applied',message:'Psst awaits the native SessionStart hook. Restart Claude after installing/configuring the plugin.'}});
  let tools=null;
  // Initialize MCP immediately; tools have no effect until native hook confirmation.
  const names=['broker_list_clients','broker_send','broker_update_metadata','broker_message_status','broker_receive','broker_acknowledge','broker_identity'];
  const guarded=Object.fromEntries(names.map(name=>[name,async args=>{
    if(!started || !active()) return unavailable();
    return tools[name](args);
  }]));
  server=serveStdio({input:process.stdin,output:process.stdout,tools:guarded,onClose:async()=>{closeSessionOnExit=!active();live=false;await runtime?.stop({closeSession:closeSessionOnExit});},onDiagnostic:()=>{}});
  const deadline=Date.now()+30000;
  while(live && !expected) {
    try { const binding=readBinding(directory);if(binding.host.pid===host.pid && verifyBinding(directory,binding)) expected=binding; } catch { /* Hook and MCP startup ordering can vary. */ }
    if(!expected) {if(Date.now()>=deadline) throw new Error('session_confirmation_timeout');await delay(25);}
  }
  if(!live) throw new Error('mcp_closed');
  const journal=privateDirectory(join(directory,`inbox-${expected.lifetime}`));
  const identityFile=join(journal,'identity.json');
  try {writeFileSync(identityFile,JSON.stringify(newSessionIdentity('claude-code'))+'\n',{mode:0o600,flag:'wx'});} catch(error) {if(error.code!=='EEXIST')throw error;}
  const identity=readPrivateJson(identityFile);
  inbox=new Inbox({directory:journal,identity});
  const client=new BrokerClient({url:config.brokerUrl,tokenFile:config.tokenFile,caFile:config.caFile,insecureDevelopment:config.insecureDevelopment===true,inbox});
  runtime=new AdapterRuntime({client,inbox,verifySession:active,isAlive:active,onDiagnostic:({code})=>process.stderr.write(`psst_${code}\n`)});
  tools={...createTools({client,inbox,observeMetadata:()=>({model:bindingModel(readBinding(directory))})}),...createCooperativeInbox({inbox,isActive:active}),
    broker_identity:async()=>({client_id:identity.client_id,client_type:'claude-code',native_session_id:expected.sessionId,local_mode:'cooperative_pull',automatic_wakeup:false})};
  await runtime.start({name:config.name,project:config.project??null,model:bindingModel(expected)});
  if(!active()) throw new Error('session_changed');
  started=true;
  monitor=setInterval(()=>{if(!active()){live=false;void server.close();}},250);
  await server.done;
} catch {
  process.stderr.write('psst_mcp_unavailable: check Node 24, private config/token, HTTPS access, and restart Claude with the native plugin. No pending message was implicitly acknowledged.\n');
  process.exitCode=1;
} finally {
  live=false;if(monitor)clearInterval(monitor);
  await server?.close();await runtime?.stop({closeSession:closeSessionOnExit});inbox?.close();
}
