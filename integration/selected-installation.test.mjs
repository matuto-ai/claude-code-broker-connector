import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {httpFixture} from '../../ai-agent-msg-broker/test/helpers.mjs';
import {readSelection} from '../src/installation-selection.mjs';

test('one in-session selection survives fresh HOME; 30 native hosts auto-connect with isolated IDs and local disconnect', {timeout:60000},async t=>{
 const b=await httpFixture(t),root=mkdtempSync(join(tmpdir(),'claude-selected-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const configDir=join(root,'durable-claude'),store=join(configDir,'psst');mkdirSync(store,{recursive:true,mode:0o700});
 const file=join(store,'connection.json'),token=join(store,'token');writeFileSync(token,b.b.token,{mode:0o600});
 writeFileSync(file,JSON.stringify({brokerUrl:b.base,tokenFile:token,stateRoot:join(store,'old-state'),name:'shared-installation',insecureDevelopment:true}),{mode:0o600});
 const host=join(root,'host.mjs');writeFileSync(host,`import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {pluginHook,nativeStateConfig} from ${JSON.stringify(pathToFileURL(resolve('src/plugin-state.mjs')).href)};import {processIdentity} from ${JSON.stringify(pathToFileURL(resolve('src/launch-state.mjs')).href)};const session=randomUUID(),owner=processIdentity(process.pid);pluginHook(nativeStateConfig(),{hook_event_name:'SessionStart',session_id:session},owner);const m=spawn(process.execPath,[${JSON.stringify(resolve('bin/plugin-mcp.mjs'))}],{stdio:'inherit'});m.on('exit',code=>{pluginHook(nativeStateConfig(),{hook_event_name:'SessionEnd',session_id:session},owner);process.exitCode=code;});`);
 let counter=0;
 async function start({legacyDefault=false,overrideUrl=null}={}){
  const home=join(root,`ephemeral-${++counter}`);mkdirSync(home,{mode:0o700});
  if(legacyDefault){mkdirSync(join(home,'.config','psst'),{recursive:true,mode:0o700});writeFileSync(join(home,'.config','psst','claude.json'),readFileSync(file),{mode:0o600});}
  const env={...process.env,HOME:home,CLAUDE_CONFIG_DIR:configDir};for(const k of ['PSST_CLAUDE_CONFIG','PSST_CONFIG_FILE','PSST_BROKER_URL','PSST_PLUGIN_BROKER_URL'])delete env[k];if(overrideUrl)env.PSST_PLUGIN_BROKER_URL=overrideUrl;
  const child=spawn(process.execPath,[host],{env,stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let buffer='',stderr='',id=0;const waiters=new Map();child.stderr.on('data',x=>stderr+=x);child.stdout.on('data',x=>{buffer+=x;while(buffer.includes('\n')){const end=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);waiters.get(r.id)?.(r);waiters.delete(r.id);}});const ended=new Promise(r=>child.on('exit',r));
  const ask=(method,params)=>new Promise(r=>{const next=++id;waiters.set(next,r);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});
  await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-native-host',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const call=async(name,args={})=>{const r=await ask('tools/call',{name,arguments:args});assert(!r.error,JSON.stringify(r));return JSON.parse(r.result.content[0].text);};
  return {home,child,ended,call,get stderr(){return stderr;}};
 }
 const initial=await start();assert(['not_connected','session_binding_unavailable'].includes((await initial.call('broker_identity')).error.code));
 const first=await initial.call('broker_connect',{connection_file:file});assert(first.client_id,JSON.stringify(first));assert.equal(first.installation_selection.saved,true);
 initial.child.stdin.end();assert.equal(await initial.ended,0,initial.stderr);rmSync(initial.home,{recursive:true,force:true});
 assert.equal(readSelection(store).connection_file,file);
 const sessions=await Promise.all(Array.from({length:30},()=>start()));
 const identities=await Promise.all(sessions.map(async s=>{for(let i=0;i<300;i++){const identity=await s.call('broker_identity');if(identity.client_id)return identity;await delay(20);}throw Error('autoconnect did not complete');}));
 assert.equal(new Set(identities.map(x=>x.client_id)).size,30);assert.equal(new Set(identities.map(x=>x.native_session_id)).size,30);assert(!identities.some(x=>x.client_id===first.client_id));
 const selectionBefore=readFileSync(join(store,'selected-installation.json'),'utf8');
 await sessions[0].call('broker_disconnect');assert.equal((await sessions[0].call('broker_identity')).error.code,'not_connected');
 for(let i=1;i<30;i++)assert.equal((await sessions[i].call('broker_identity')).client_id,identities[i].client_id);
 assert.equal(readFileSync(join(store,'selected-installation.json'),'utf8'),selectionBefore);
 for(const session of sessions)session.child.stdin.end();for(const session of sessions)assert.equal(await session.ended,0,session.stderr);
 let requests=0;b.app.server.on('request',()=>requests++);
 const mismatch=await start({overrideUrl:'https://wrong-broker.invalid'});await delay(700);
 assert.equal((await mismatch.call('broker_identity')).error.code,'not_connected');assert.equal(requests,0);assert.equal(mismatch.child.exitCode,null);
 assert.equal((mismatch.stderr.match(/psst_autoconnect_unavailable/g)||[]).length,1);
 mismatch.child.stdin.end();assert.equal(await mismatch.ended,0);
 writeFileSync(join(store,'selected-installation.json'),'{invalid',{mode:0o600});
 const invalid=await start({legacyDefault:true});await delay(700);
 assert.equal((await invalid.call('broker_identity')).error.code,'not_connected');assert.equal(requests,0);assert.equal(invalid.child.exitCode,null);
 assert.equal((invalid.stderr.match(/psst_default_config_invalid/g)||[]).length,1);
 const recovery=await invalid.call('broker_connect',{connection_file:file});assert(recovery.client_id,JSON.stringify(recovery));assert.equal(recovery.installation_selection.saved,false);assert.equal(recovery.installation_selection.reason,'installation_selection_invalid_or_unreadable');
 assert.equal(readFileSync(join(store,'selected-installation.json'),'utf8'),'{invalid');
 invalid.child.stdin.end();assert.equal(await invalid.ended,0);
 
});
