import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { processIdentity, readPrivateJson, writePrivateJson } from '../src/launch-state.mjs';
import { pluginHook, hostDirectory, readBinding } from '../src/plugin-state.mjs';
import { associateNativeBinding } from '../src/native-binding.mjs';
import { createPluginEpoch } from '../src/plugin-epoch.mjs';

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'saved-connect-')),epochs=[];
 const keys=['HOME','CLAUDE_CONFIG_DIR','PSST_CONFIG_FILE','PSST_CLAUDE_CONFIG','PSST_BROKER_URL','PSST_PLUGIN_BROKER_URL'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 keys.forEach(k=>delete process.env[k]); process.env.HOME=root; process.env.CLAUDE_CONFIG_DIR=join(root,'config');
 t.after(async()=>{for(const epoch of epochs)await epoch.retire();for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];rmSync(root,{recursive:true,force:true});});
 const nativeConfig={stateRoot:join(root,'native')},host=processIdentity(process.pid),sessionId=randomUUID();
 pluginHook(nativeConfig,{hook_event_name:'SessionStart',session_id:sessionId},host);associateNativeBinding({nativeConfig,host,sessionId});
 const {directory}=hostDirectory(nativeConfig,host),binding=readBinding(directory),starts=[];
 let fail=false;
 class BrokerClient {constructor(options){starts.push(options);}async recoverOutgoing(){} }
 class AdapterRuntime {async start(){if(fail)throw Error('unauthenticated');}async stop(){} }
 const config={brokerUrl:'https://broker.invalid',tokenFile:join(root,'token'),stateRoot:join(root,'legacy'),name:'legacy',project:null};
 const create=legacyConfig=>{const epoch=createPluginEpoch({directory,binding,host,nativeConfig,legacyConfig,dependencies:{BrokerClient,AdapterRuntime,createTools:()=>({}),createCooperativeInbox:()=>({})}});epochs.push(epoch);return epoch;};
 return {root,directory,starts,config,create,fail:()=>{fail=true;}};
}

test('saved legacy reconnect without broker_url never enters enrollment; disconnect reconnect retains identity',async t=>{
 const f=fixture(t),epoch=f.create(f.config);
 const first=await epoch.tools.broker_connect({});assert(first.client_id);assert.equal(f.starts.length,1);
 await epoch.tools.broker_disconnect({});const second=await epoch.tools.broker_connect({});
 assert.equal(second.client_id,first.client_id);assert.equal(f.starts.length,2);
 assert.throws(()=>readPrivateJson(join(f.root,'config','psst','setup-context.json')),{code:'ENOENT'});
 assert.equal(second.error,undefined);
});

test('approved selected legacy configuration is reused without receipt or URL and without resaving selection',async t=>{
 const f=fixture(t),root=join(f.root,'config','psst');mkdirSync(root,{recursive:true,mode:0o700});
 const file=join(f.root,'saved.json');writePrivateJson(file,f.config);
 const selected={format:'psst-selected-installation-v1',revision:randomUUID(),connection_file:file};
 writePrivateJson(join(root,'selected-installation.json'),selected);
 const epoch=f.create(null);const result=await epoch.tools.broker_connect({});
 assert(result.client_id);assert.deepEqual(readPrivateJson(join(root,'selected-installation.json')),selected);
 assert.throws(()=>readPrivateJson(join(root,'setup-context.json')),{code:'ENOENT'});
});

test('only genuine absence yields setup_required; malformed or explicit missing saved files block enrollment fallback',async t=>{
 const f=fixture(t),epoch=f.create(null);
 assert.deepEqual(await epoch.tools.broker_connect({}),{state:'setup_required',connected:false});
 process.env.PSST_CONFIG_FILE=join(f.root,'missing-explicit.json');
 assert.equal((await epoch.tools.broker_connect({})).error.code,'invalid_saved_connection');delete process.env.PSST_CONFIG_FILE;
 writeFileSync(join(f.directory,'activation.json'),'{bad',{mode:0o600});
 assert.equal((await epoch.tools.broker_connect({})).error.code,'invalid_saved_connection');assert.equal(f.starts.length,0);
});

test('failed saved transport and changed broker origin do not fall through to setup',async t=>{
 const f=fixture(t),epoch=f.create(f.config);
 process.env.PSST_PLUGIN_BROKER_URL='https://different.invalid';
 assert.equal((await epoch.tools.broker_connect({})).error.code,'configured_broker_mismatch');assert.equal(f.starts.length,0);
 delete process.env.PSST_PLUGIN_BROKER_URL;f.fail();
 assert.equal((await epoch.tools.broker_connect({})).error.code,'connection_failed');assert.equal(f.starts.length,1);
 assert.throws(()=>readPrivateJson(join(f.root,'config','psst','setup-context.json')),{code:'ENOENT'});
});
