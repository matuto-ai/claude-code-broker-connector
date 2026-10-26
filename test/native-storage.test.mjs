import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeStateConfig,pluginHook,hostDirectory,readBinding} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
test('new native lifetimes persist under Claude volume; only a verified live legacy binding retains its old journal',t=>{
 const root=mkdtempSync(join(tmpdir(),'claude-native-store-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const env={HOME:join(root,'old-home'),CLAUDE_CONFIG_DIR:join(root,'volume')},host=processIdentity(process.pid),legacy={stateRoot:join(env.HOME,'.config','psst','native')};
 assert.equal(nativeStateConfig(env,host).stateRoot,join(env.CLAUDE_CONFIG_DIR,'psst','native'));
 pluginHook(legacy,{hook_event_name:'SessionStart',session_id:'live'},host);const directory=hostDirectory(legacy,host).directory,first=readBinding(directory),unread=join(directory,'unread-sentinel');writeFileSync(unread,'preserve');
 assert.equal(nativeStateConfig(env,host,'live').stateRoot,legacy.stateRoot);pluginHook(nativeStateConfig(env,host,'live'),{hook_event_name:'SessionStart',session_id:'live'},host);assert.equal(readBinding(directory).lifetime,first.lifetime);assert(existsSync(unread));
 assert.equal(nativeStateConfig(env,host,'new-session').stateRoot,join(env.CLAUDE_CONFIG_DIR,'psst','native'));
 pluginHook(legacy,{hook_event_name:'SessionEnd',session_id:'live'},host);assert.equal(nativeStateConfig(env,host).stateRoot,join(env.CLAUDE_CONFIG_DIR,'psst','native'));assert(existsSync(unread));
 const override=join(root,'explicit');assert.equal(nativeStateConfig({...env,PSST_CLAUDE_NATIVE_STATE_ROOT:override},host).stateRoot,override);assert.throws(()=>nativeStateConfig({...env,PSST_CLAUDE_NATIVE_STATE_ROOT:'relative'},host));
});
