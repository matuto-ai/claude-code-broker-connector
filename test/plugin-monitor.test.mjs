import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fixtureHook as pluginHook} from '../integration/native-fixture-permit.mjs';
import {hostDirectory,readBinding} from '../src/plugin-state.mjs';
import {processIdentity,writePrivateJson} from '../src/launch-state.mjs';
test('monitor fixture is session-fenced, body-free, silent on disconnect and exits on SessionEnd (not native certification)',async t=>{
 const home=mkdtempSync(join(tmpdir(),'psst-monitor-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const config={stateRoot:join(home,'.config','psst','native')},host=processIdentity(process.pid),sessionId='fixture-native-session';
 pluginHook(config,{hook_event_name:'SessionStart',session_id:sessionId},host);
 const {directory}=hostDirectory(config,host),binding=readBinding(directory);
 const publish=(connected,pending_id)=>writePrivateJson(join(directory,'notice.json'),{...binding,connected,pending_id,updated_at:Date.now()});
 publish(true,'message-one');
 const child=spawn(process.execPath,['bin/plugin-monitor.mjs'],{env:{...process.env,HOME:home,PSST_CLAUDE_CONFIG:join(home,'absent'),CLAUDE_PID:String(process.pid),CLAUDE_CODE_SESSION_ID:sessionId},stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let output='';child.stdout.on('data',c=>output+=c);
 const ended=new Promise(resolve=>child.once('exit',resolve));
 for(let i=0;i<40&&!output;i++)await delay(25);
 assert.match(output,/broker_receive/);assert(!output.includes('message-one'));const before=output;
 publish(false,'message-two');await delay(1100);assert.equal(output,before);
 publish(true,'message-two');await delay(1100);assert(output.length>before.length);
 pluginHook(config,{hook_event_name:'SessionEnd',session_id:sessionId},host);assert.equal(await ended,0);
});

test('always-start monitor waits silently for delayed exact native binding, never synthesizes it',{timeout:15000},async t=>{
 const home=mkdtempSync(join(tmpdir(),'psst-monitor-start-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const config={stateRoot:join(home,'.config','psst','native')},host=processIdentity(process.pid),sessionId='delayed-native-session';
 const child=spawn(process.execPath,['bin/plugin-monitor.mjs'],{env:{...process.env,HOME:home,PSST_CLAUDE_CONFIG:join(home,'absent'),CLAUDE_PID:String(process.pid),CLAUDE_CODE_SESSION_ID:sessionId},stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);const ended=new Promise(r=>child.once('exit',r));
 await delay(300);assert.equal(output,'');assert.equal(errors,'');assert.equal(child.exitCode,null);
 pluginHook(config,{hook_event_name:'SessionStart',session_id:sessionId},host);const {directory}=hostDirectory(config,host),binding=readBinding(directory);
 writePrivateJson(join(directory,'notice.json'),{...binding,connected:false,pending_id:'private-item',updated_at:Date.now()});await delay(1100);assert.equal(output,'');
 writePrivateJson(join(directory,'notice.json'),{...binding,connected:true,pending_id:'private-item',updated_at:Date.now()});for(let i=0;i<60&&!output;i++)await delay(25);
 assert.match(output,/broker_receive/);assert(!output.includes('private-item'));assert.equal(errors,'');
 pluginHook(config,{hook_event_name:'SessionEnd',session_id:sessionId},host);assert.equal(await ended,0);
});

test('transport notices are independent, body-free and durably budgeted across monitor restart (synthetic host)',{timeout:12000},async t=>{
 const home=mkdtempSync(join(tmpdir(),'psst-presence-monitor-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const config={stateRoot:join(home,'.config','psst','native')},host=processIdentity(process.pid),sessionId='presence-native-session';
 pluginHook(config,{hook_event_name:'SessionStart',session_id:sessionId},host);
 const {directory}=hostDirectory(config,host),binding=readBinding(directory);
 const publish=(presence_event_id,pending_id=null)=>writePrivateJson(join(directory,'notice.json'),{...binding,connected:true,pending_id,presence_event_id,updated_at:Date.now()});
 const start=()=>{
  const child=spawn(process.execPath,['bin/plugin-monitor.mjs'],{env:{...process.env,HOME:home,PSST_CLAUDE_CONFIG:join(home,'absent'),CLAUDE_PID:String(process.pid),CLAUDE_CODE_SESSION_ID:sessionId},stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let output='';child.stdout.on('data',c=>output+=c);
  const ended=new Promise(resolve=>child.once('exit',resolve));return {child,ended,get output(){return output;}};
 };
 publish('event-private-one','message-private');let m=start();
 for(let i=0;i<80&&!m.output.includes('broker_presence_events');i++)await delay(25);
 assert.match(m.output,/broker_presence_events/);assert.match(m.output,/broker_receive/);assert.doesNotMatch(m.output,/event-private|message-private/);
 m.child.kill('SIGTERM');await m.ended;
 publish('event-private-one');m=start();await delay(1100);assert.equal(m.output,'','same event is not re-announced on immediate restart');
 publish('event-private-two');for(let i=0;i<80&&!m.output;i++)await delay(25);
 assert.match(m.output,/broker_presence_events/);assert.doesNotMatch(m.output,/broker_receive/);
 pluginHook(config,{hook_event_name:'SessionEnd',session_id:sessionId},host);assert.equal(await m.ended,0);
});
