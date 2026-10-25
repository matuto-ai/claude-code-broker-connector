import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pluginHook, hostDirectory, readBinding, verifyBinding, bindingModel, readPluginConfig, configPath } from '../src/plugin-state.mjs';
import { processIdentity } from '../src/launch-state.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'psst-plugin-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const config={brokerUrl:'https://broker.example.invalid',stateRoot:root,tokenFile:join(root,'token'),name:'claude'};const host=processIdentity(process.pid);return{config,host,root,directory:hostDirectory(config,host).directory};}
test('native hooks bind same host/session, preserve compact lifetime and close exact session',t=>{
 const f=fixture(t), id=randomUUID();
 const event={hook_event_name:'SessionStart',session_id:id,model:'observed'};
 pluginHook(f.config,event,f.host);const binding=readBinding(f.directory);
 assert(verifyBinding(f.directory,binding));assert.equal(bindingModel(binding).source,'observed');
 pluginHook(f.config,{...event,source:'compact'},f.host);assert.equal(readBinding(f.directory).lifetime,binding.lifetime);
 pluginHook(f.config,{hook_event_name:'PreToolUse',session_id:id},f.host);
 const deny=pluginHook(f.config,{hook_event_name:'PreToolUse',session_id:id,agent_id:'child'},f.host);
 assert.equal(deny.hookSpecificOutput.permissionDecision,'deny');
 assert.equal(pluginHook(f.config,{hook_event_name:'PreToolUse',session_id:randomUUID()},f.host).hookSpecificOutput.permissionDecision,'deny');
 pluginHook(f.config,{hook_event_name:'SessionEnd',session_id:randomUUID()},f.host);assert(verifyBinding(f.directory,binding));
 pluginHook(f.config,{hook_event_name:'SessionEnd',session_id:id},f.host);assert(!verifyBinding(f.directory,binding));
 pluginHook(f.config,event,f.host);assert.notEqual(readBinding(f.directory).lifetime,binding.lifetime);
});
test('native session switch invalidates old binding; no model or name authority',t=>{
 const f=fixture(t);pluginHook(f.config,{hook_event_name:'SessionStart',session_id:'native-a'},f.host);
 const old=readBinding(f.directory);pluginHook(f.config,{hook_event_name:'SessionStart',session_id:'native-b'},f.host);
 assert(!verifyBinding(f.directory,old));assert.equal(bindingModel(readBinding(f.directory)).source,'unknown');
 pluginHook(f.config,{hook_event_name:'PostModelSwitch',session_id:'native-b',to_model:'new-model'},f.host);
 assert.equal(bindingModel(readBinding(f.directory)).id,'new-model');
 assert(!verifyBinding(f.directory,{...readBinding(f.directory),host:{...f.host,start:'0'}}));
});
test('private config and broker bundle are validated without reading credentials',t=>{
 const f=fixture(t),path=join(f.root,'config.json');writeFileSync(path,JSON.stringify(f.config),{mode:0o600});
 assert.deepEqual(readPluginConfig(path),f.config);
 const bundle={format:'broker-client-bundle-v1',protocol_version:'1',broker_url:'https://broker.example.invalid',token_file:'token',file_paths_relative_to:'connection_file_directory',authorization_header:'Authorization',authorization_scheme:'Bearer',allowed_client_types:['claude-code'],scope:'psst',insecure_development:false};
 writeFileSync(path,JSON.stringify(bundle));assert.equal(readPluginConfig(path).tokenFile,join(f.root,'token'));
 writeFileSync(path,JSON.stringify({...bundle,allowed_client_types:['pi']}));assert.throws(()=>readPluginConfig(path),/incompatible_client_bundle/);
 writeFileSync(path,JSON.stringify({...f.config,brokerUrl:'https://user:secret@example.invalid'}));assert.throws(()=>readPluginConfig(path),/https_broker_required/);
 writeFileSync(path,JSON.stringify({...f.config,token:'secret'}));assert.throws(()=>readPluginConfig(path),/invalid_plugin_config/);
 assert.equal(configPath({PSST_CONFIG_FILE:'/bundle',PSST_CLAUDE_CONFIG:'/override'}),'/override');
 assert.equal(configPath({PSST_CONFIG_FILE:'/bundle'}),'/bundle');
});
