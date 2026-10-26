// Real broker approval service + form-login HTTP UI + TLS + synthetic native host.
// This proves transport/setup plumbing, NOT authenticated Claude/model acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import https from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {pluginHook,nativeStateConfig} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
import {Inbox,newSessionIdentity} from '../vendor/psst/reference/inbox.mjs';
import {BrokerClient} from '../vendor/psst/reference/client.mjs';
const source=process.env.PSST_APPROVAL_BROKER_ROOT?pathToFileURL(resolve(process.env.PSST_APPROVAL_BROKER_ROOT)+'/'):new URL('../../ai-agent-msg-broker/',import.meta.url);
const [{fixture},{ApprovalService},{AdminUI},{createBrokerServer}]=await Promise.all(['test/helpers.mjs','src/approval.mjs','src/admin.mjs','src/server.mjs'].map(p=>import(new URL(p,source))));
for(const scenario of ['approved-restart-replacement','cancel-late-approval','denied','expired','revoked','cancel-new-registration','disconnect-new-registration','lost-post-response'])test(`URL-only real broker approval: ${scenario}`,{timeout:30000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'claude-approval-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const key=join(root,'tls.key'),cert=join(root,'tls.crt');assert.equal(spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8'}).status,0);
 const f=fixture(t);f.advance(Date.now()-f.now);const approval=await ApprovalService.create({store:f.store,scope:'default'});f.auth.additionalCredentials=()=>approval.credentials();
 const password='synthetic-admin-password-'+randomUUID(),admin=await AdminUI.create({approval,auth:f.auth,password});
 const app=createBrokerServer({store:f.store,auth:f.auth,approval,admin,host:'127.0.0.1',port:0,tls:{keyFile:key,certFile:cert},pollIntervalMs:10});const address=await app.listen();t.after(()=>app.close());const url=`https://127.0.0.1:${address.port}`;
 let holdRegistration=false,releaseRegistration,signalRegistration;const registrationGate=new Promise(r=>releaseRegistration=r),registrationStarted=new Promise(r=>signalRegistration=r);
 let posts=0,gets=0,drop=scenario==='lost-post-response';const handle=app.server.listeners('request')[0];app.server.removeAllListeners('request');app.server.on('request',async(req,res)=>{if(holdRegistration&&req.method==='POST'&&req.url==='/v1/sessions'){holdRegistration=false;signalRegistration();await registrationGate;}if(req.url==='/v1/enrollment-requests'&&req.method==='POST'){posts++;if(drop){drop=false;res.end=()=>{res.destroy();return res;};}}if(req.url.startsWith('/v1/enrollment-requests/')&&req.method==='GET')gets++;return handle(req,res);});
 const http=(path,{method='GET',body,cookie}={})=>new Promise((resolve,reject)=>{const data=body?new URLSearchParams(body).toString():undefined;const req=https.request(url+path,{ca:readFileSync(cert),method,headers:{...(cookie?{Cookie:cookie}:{}),...(data?{Origin:url,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(data)}:{})}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}));});req.on('error',reject);req.end(data);});
 const login=await http('/admin');let cookie=login.cookie,csrf=login.text.match(/name="csrf" value="([^"]+)"/)[1];const authenticated=await http('/admin/login',{method:'POST',cookie,body:{csrf,password}});assert.equal(authenticated.status,303);cookie=authenticated.cookie;
 const decide=async(id,action)=>{const page=await http('/admin',{cookie});assert(page.text.includes(id));csrf=page.text.match(/name="csrf" value="([^"]+)"/)[1];const result=await http(`/admin/requests/${id}/${action}`,{method:'POST',cookie,body:{csrf}});assert.equal(result.status,303);};
 const durable=join(root,'claude-config');let home=join(root,'home'),sessionId=randomUUID(),child,call,ended,stdout='',stderr='';
 const worker=join(root,'native-host.mjs');writeFileSync(worker,`import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {pluginHook,nativeStateConfig} from ${JSON.stringify(pathToFileURL(resolve('src/plugin-state.mjs')).href)};import {processIdentity} from ${JSON.stringify(pathToFileURL(resolve('src/launch-state.mjs')).href)};const session=randomUUID(),owner=processIdentity(process.pid);pluginHook(nativeStateConfig(),{hook_event_name:'SessionStart',session_id:session},owner);const child=spawn(process.execPath,[${JSON.stringify(resolve('bin/plugin-mcp.mjs'))}],{stdio:'inherit'});child.on('exit',code=>{pluginHook(nativeStateConfig(),{hook_event_name:'SessionEnd',session_id:session},owner);process.exitCode=code;});`);
 const startNative=async i=>{
  const process=spawn(globalThis.process.execPath,[worker],{env:{...globalThis.process.env,HOME:join(root,'parallel-'+i),CLAUDE_CONFIG_DIR:durable,PSST_CLAUDE_CONFIG:'',PSST_CONFIG_FILE:'',PSST_PLUGIN_BROKER_URL:url,NODE_EXTRA_CA_CERTS:cert},stdio:['pipe','pipe','pipe']});t.after(()=>{if(process.exitCode===null)process.kill('SIGKILL');});const ended=new Promise(r=>process.once('close',r));let buffer='',id=0;const waiters=new Map();process.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);waiters.get(r.id)?.(r);waiters.delete(r.id);}});
  const ask=(method,params)=>new Promise(r=>{const next=++id;waiters.set(next,r);process.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'parallel-native',version:'0'}});process.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');const call=async(name,args={})=>JSON.parse((await ask('tools/call',{name,arguments:args})).result.content[0].text);return {process,ended,call};
 };
 const start=async()=>{
  pluginHook(nativeStateConfig({HOME:home,CLAUDE_CONFIG_DIR:durable},processIdentity(process.pid),sessionId),{hook_event_name:'SessionStart',session_id:sessionId},processIdentity(process.pid));
  child=spawn(process.execPath,['bin/plugin-mcp.mjs'],{env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:durable,PSST_CLAUDE_CONFIG:'',PSST_CONFIG_FILE:'',PSST_PLUGIN_BROKER_URL:url,NODE_EXTRA_CA_CERTS:cert},stdio:['pipe','pipe','pipe']});const started=child;t.after(()=>{if(started.exitCode===null)started.kill('SIGKILL');});ended=new Promise(r=>child.once('close',r));let buffer='',id=0;const waiters=new Map();child.stdout.on('data',c=>{stdout+=c;buffer+=c;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);waiters.get(r.id)?.(r);waiters.delete(r.id);}});child.stderr.on('data',c=>stderr+=c);
  const ask=(method,params)=>new Promise(r=>{const next=++id;waiters.set(next,r);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-native',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');call=async(name,args={})=>{const result=await ask('tools/call',{name,arguments:args});assert(!result.error,JSON.stringify(result));return JSON.parse(result.result.content[0].text);};
 };
 const identity=async()=>{let value;for(let i=0;i<150;i++){value=await call('broker_identity');if(value.client_id)return value;await delay(25);}assert.fail(JSON.stringify({value,stderr}));};
 await start();await delay(350);assert.equal(posts,0);assert.equal((await call('broker_identity')).error.code,'not_connected');
 const requested=await call('broker_setup');assert.equal(posts,1);const requestId=approval.list()[0].id;
 if(scenario==='lost-post-response'){assert.equal(requested.error.effect,'unknown');child.stdin.end();await ended;await start();await delay(400);assert.equal(posts,1);await decide(requestId,'approve');await identity();assert.equal(posts,1);assert(gets>0);child.stdin.end();assert.equal(await ended,0);return;}
 assert.equal(requested.state,'pending');assert.equal(requested.requestId,requestId);assert.equal((await call('broker_identity')).error.code,'not_connected');
 if(scenario==='cancel-late-approval'){await call('broker_setup_cancel');await decide(requestId,'approve');await delay(2300);assert.equal((await call('broker_identity')).error.code,'not_connected');child.stdin.end();await ended;await start();await delay(500);assert.equal((await call('broker_identity')).error.code,'not_connected');assert.equal(posts,1);child.stdin.end();assert.equal(await ended,0);return;}
 if(['denied','expired'].includes(scenario)){if(scenario==='denied')await decide(requestId,'deny');else f.advance(86400001);for(let i=0;i<120&&(await call('broker_setup_status')).state!==scenario;i++)await delay(25);assert.equal((await call('broker_setup_status')).state,scenario);const before=gets;await delay(2200);assert.equal(gets,before);assert.equal((await call('broker_identity')).error.code,'not_connected');child.stdin.end();assert.equal(await ended,0);return;}
 // Close while pending, approve in admin, then reopen without another setup POST.
 child.stdin.end();assert.equal(await ended,0);await decide(requestId,'approve');await start();const first=await identity();assert.equal(posts,1);
 if(['cancel-new-registration','disconnect-new-registration'].includes(scenario)){
  const originalSelection=readFileSync(join(durable,'psst','selected-installation.json'),'utf8');holdRegistration=true;
  const replacing=await call('broker_setup',{replace:true});await decide(replacing.requestId,'approve');await Promise.race([registrationStarted,delay(5000).then(()=>{throw Error('registration_gate_missing');})]);
  assert.equal((await call('broker_setup',{replace:true})).error.code,'connection_busy');
  await call(scenario==='cancel-new-registration'?'broker_setup_cancel':'broker_disconnect');releaseRegistration();
  if(scenario==='cancel-new-registration'){const restored=await identity();assert.equal(restored.client_id,first.client_id);}else{await delay(500);assert.equal((await call('broker_identity')).error.code,'not_connected');}
  assert.equal(readFileSync(join(durable,'psst','selected-installation.json'),'utf8'),originalSelection);assert.equal(posts,2);child.stdin.end();assert.equal(await ended,0);return;
 }
 if(scenario==='revoked'){
  await decide(requestId,'revoke');for(let i=0;i<160;i++){await call('broker_list_clients');if((await call('broker_identity')).error?.code==='not_connected')break;await delay(25);}
  assert.equal((await call('broker_identity')).error?.code,'not_connected');assert.equal(posts,1);child.stdin.end();assert.equal(await ended,0);return;
 }

 const peerInbox=new Inbox({directory:join(root,'peer'),identity:newSessionIdentity('pi')});t.after(()=>peerInbox.close());const token=join(root,'peer-token');writeFileSync(token,f.a.token,{mode:0o600});const peer=new BrokerClient({url,tokenFile:token,caFile:cert,inbox:peerInbox});await peer.register({name:'peer',model:{provider:null,id:null,source:'unknown'},project:null});
 const oldFile=JSON.parse(readFileSync(join(durable,'psst','selected-installation.json'))).connection_file;
 const monitor=spawn(process.execPath,['bin/plugin-monitor.mjs'],{env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:durable,CLAUDE_PID:String(process.pid),CLAUDE_CODE_SESSION_ID:sessionId},stdio:['ignore','pipe','pipe']});t.after(()=>{if(monitor.exitCode===null)monitor.kill('SIGKILL');});
 // A synthetic host reacts to the real monitor; this is not a native model receipt.
 let notices='',handled=false;const automaticRead=new Promise((resolve,reject)=>monitor.stdout.on('data',chunk=>{notices+=chunk;if(handled)return;handled=true;(async()=>{const incoming=await call('broker_receive');await call('broker_acknowledge',{message_id:incoming.message_id,receipt_token:incoming.receipt_token});return incoming;})().then(resolve,reject);}));
 const message=await peer.sendPrepared(peer.prepareSend({recipient_id:first.client_id,content:{type:'text/plain',text:'untrusted AGENT fixture'}}));
 const incoming=await Promise.race([automaticRead,delay(5000).then(()=>{throw Error('monitor_notification_timeout');})]);assert.equal(incoming.message_id,message.message_id);assert(!notices.includes('untrusted AGENT fixture'));monitor.kill('SIGTERM');
 const unread=await peer.sendPrepared(peer.prepareSend({recipient_id:first.client_id,content:{type:'text/plain',text:'keep old unread'}}));for(let i=0;i<100;i++){if((await peer.messageStatus(unread.message_id)).delivery_state==='delivered')break;await delay(25);}

 const replacement=await call('broker_setup',{replace:true});assert.equal(replacement.state,'pending');assert.notEqual(replacement.requestId,requestId);assert.equal((await call('broker_identity')).client_id,first.client_id);
 const pendingSessions=await Promise.all(Array.from({length:30},(_,i)=>startNative(i)));
 const oldParallel=await Promise.all(pendingSessions.map(async s=>{for(let i=0;i<200;i++){const id=await s.call('broker_identity');if(id.client_id)return id;await delay(25);}throw Error('old_selection_not_retained');}));assert(oldParallel.every(x=>x.credential_id===first.credential_id));
 await decide(replacement.requestId,'approve');let second;for(let i=0;i<150;i++){second=await call('broker_identity');if(second.client_id&&second.client_id!==first.client_id)break;await delay(25);}assert.notEqual(second.client_id,first.client_id);assert(second.client_id);assert.equal(posts,2);
 const pendingIds=await Promise.all(pendingSessions.map(async s=>{for(let i=0;i<250;i++){const id=await s.call('broker_identity');if(id.client_id&&id.credential_id===second.credential_id)return id;await delay(25);}throw Error('parallel_pending_approval_not_applied:'+JSON.stringify(await s.call('broker_setup_status')));}));
 const newFile=JSON.parse(readFileSync(join(durable,'psst','selected-installation.json'))).connection_file;
 await call('broker_disconnect');const restored=await call('broker_connect',{connection_file:oldFile});assert.equal(restored.client_id,first.client_id);assert.equal((await call('broker_receive')).message_id,unread.message_id);
 await call('broker_disconnect');assert.equal((await call('broker_connect',{connection_file:newFile})).client_id,second.client_id);

 child.stdin.end();await ended;rmSync(home,{recursive:true,force:true});home=join(root,'new-home');sessionId=randomUUID();await start();const third=await identity();assert.notEqual(third.client_id,second.client_id);assert.equal(third.credential_id,second.credential_id);assert.equal(posts,2);
 assert(!stdout.includes(password));assert(!stderr.includes(password));child.stdin.end();assert.equal(await ended,0);
 const sessions=pendingSessions;
 const ids=pendingIds;
 assert.equal(new Set(ids.map(x=>x.client_id)).size,30);assert.equal(new Set(ids.map(x=>x.native_session_id)).size,30);assert(ids.every(x=>x.credential_id===second.credential_id));assert.equal(posts,2);
 await sessions[0].call('broker_disconnect');for(let i=1;i<30;i++)assert.equal((await sessions[i].call('broker_identity')).client_id,ids[i].client_id);
 for(const s of sessions)s.process.stdin.end();for(const s of sessions)assert.equal(await s.ended,0);

});
