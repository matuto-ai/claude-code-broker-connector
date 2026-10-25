// Real TLS broker + synthetic enrollment handler/native parent; not vendor or production issuance certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,unlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from '../../ai-agent-msg-broker/test/helpers.mjs';
import {createBrokerServer} from '../../ai-agent-msg-broker/src/server.mjs';
import {Inbox,newSessionIdentity} from '../vendor/psst/reference/inbox.mjs';
import {BrokerClient} from '../vendor/psst/reference/client.mjs';
import {pluginHook} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
for(const scenario of ['native-setup','native-disconnect','normal','broker-mismatch','persistent-store','auto-resume-race','disconnect','eof','sessionend','registration-disconnect','resume-marker','resume-receipt'])test(`private pairing TLS fixture: ${scenario}`,  {timeout:30000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'claude-pairing-tls-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const resumeGate=join(root,'resume-gate'),resumeTick=join(root,'resume-tick'),preload=join(root,'clock.mjs');
 if(scenario==='auto-resume-race')writeFileSync(preload,`import {existsSync,writeFileSync} from 'node:fs';
 const interval=globalThis.setInterval;
 globalThis.setInterval=(fn,ms,...args)=>ms===250?interval(()=>{if(existsSync(${JSON.stringify(resumeGate)})){fn(...args);writeFileSync(${JSON.stringify(resumeTick)},'tick');}},10):interval(fn,ms,...args);`);
 const key=join(root,'tls.key'),cert=join(root,'tls.crt');
 const ssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8'});assert.equal(ssl.status,0,ssl.stderr);
 const f=fixture(t),app=createBrokerServer({store:f.store,auth:f.auth,host:'127.0.0.1',port:0,tls:{keyFile:key,certFile:cert},pollIntervalMs:10});const address=await app.listen();t.after(()=>app.close());const url=`https://127.0.0.1:${address.port}`;
 let releaseIssuance,startedIssuance;const issuanceStarted=new Promise(r=>startedIssuance=r),issuanceGate=new Promise(r=>releaseIssuance=r);
 const grants=new Map(),issued=[];const handler=app.server.listeners('request')[0];app.server.removeAllListeners('request');
 app.server.on('request',async(req,res)=>{
  if(req.url!=='/v1/enrollments'){
   if(scenario==='auto-resume-race'&&req.url==='/v1/sessions'&&req.method==='POST'&&issued.length===2){
    // Force the deferred startup/resume tick while explicit reconnect is registering.
    writeFileSync(resumeGate,'ready');
    for(let i=0;i<500&&!existsSync(resumeTick);i++)await delay(10);
    assert(existsSync(resumeTick),'startup timer did not reach the controlled interleaving');
   }
   if(scenario==='registration-disconnect'&&req.url==='/v1/sessions'&&req.method==='POST'&&req.headers.authorization!==`Bearer ${f.a.token}`){startedIssuance();await issuanceGate;}
   return handler(req,res);
  }
  const grant=grants.get(req.headers.authorization);assert(grant);let raw='';for await(const c of req)raw+=c;
  if(scenario!=='registration-disconnect')startedIssuance();if(['native-disconnect','disconnect','eof','sessionend'].includes(scenario))await issuanceGate;
  const input=JSON.parse(raw);assert.equal(input.client_type,'claude-code');assert.match(input.token_sha256,/^[0-9a-f]{64}$/);
  if(!grant.response){const id=`enrolled-${randomUUID()}`,adapter=`installation-${randomUUID()}`;grant.request=input;grant.response={credential_id:id,adapter_id:adapter,client_type:'claude-code',scopes:['default'],expires_at:new Date(Date.now()+3600000).toISOString(),protocol_version:'1'};issued.push({credential_id:id,token_sha256:input.token_sha256,principal_id:'fixture-owner',adapter_id:adapter,client_types:['claude-code'],scopes:['default']});f.writeCreds([f.a.entry,f.b.entry,f.c.entry,...issued]);}else assert.deepEqual(input,grant.request);
  res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify(grant.response));
 });
 const pairfiles=[];for(let i=0;i<2;i++){const secret=randomBytes(32).toString('base64url');grants.set(`Pairing ${secret}`,{});const path=join(root,`pair${i}.json`);writeFileSync(path,JSON.stringify({format:'psst-pairing-v1',broker_url:url,pairing_secret:secret,client_type:'claude-code',expires_at:new Date(Date.now()+60000).toISOString()}),{mode:0o600});pairfiles.push(path);}
 const nativeSecret=JSON.parse(readFileSync(pairfiles[0])).pairing_secret;
 const durable=scenario==='persistent-store'||scenario==='native-setup';
 const peerInbox=new Inbox({directory:join(root,'peer'),identity:newSessionIdentity('pi')});t.after(()=>peerInbox.close());const token=join(root,'peer-token');writeFileSync(token,f.a.token,{mode:0o600});const peer=new BrokerClient({url,tokenFile:token,caFile:cert,inbox:peerInbox});await peer.register({name:'peer',model:{provider:null,id:null,source:'unknown'},project:null});
 const sessionId=randomUUID(),binding={stateRoot:join(root,'.config','psst','native')};pluginHook(binding,{hook_event_name:'SessionStart',session_id:sessionId},processIdentity(process.pid));
 let child,ended,call,stdout,stderr;
 let selectedHome=root;const durableConfig=join(root,'durable-claude');
 async function start(){
 child=spawn(process.execPath,[...scenario==='auto-resume-race'?['--import',preload]:[],'bin/plugin-mcp.mjs'],{env:{...process.env,HOME:selectedHome,PSST_CLAUDE_CONFIG:durable?'':join(root,'absent'),PSST_CONFIG_FILE:'',NODE_EXTRA_CA_CERTS:cert,...(durable?{CLAUDE_CONFIG_DIR:durableConfig}:{}),...(scenario.startsWith('native-')?{PSST_PLUGIN_BROKER_URL:url,PSST_PLUGIN_PAIRING_SECRET:nativeSecret}:{}),...(scenario==='broker-mismatch'?{PSST_PLUGIN_BROKER_URL:'https://wrong-broker.invalid'}:{})},stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});ended=new Promise(r=>child.once('exit',r));stdout='';stderr='';let buffer='',id=0;const waiters=new Map();child.stderr.on('data',c=>stderr+=c);child.stdout.on('data',c=>{stdout+=c;buffer+=c;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);waiters.get(r.id)?.(r);waiters.delete(r.id);}});
 const ask=(method,params)=>new Promise(r=>{const next=++id;waiters.set(next,r);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});
 await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 call=async(name,args={})=>{const r=await ask('tools/call',{name,arguments:args});assert(!r.error,JSON.stringify(r));return JSON.parse(r.result.content[0].text);};
 }
 await start();
 if(['native-disconnect','disconnect','eof','sessionend','registration-disconnect'].includes(scenario)){
  const pendingConnect=scenario==='native-disconnect'?call('broker_setup'):call('broker_connect',{connection_file:pairfiles[0]});await issuanceStarted;
  if(!['eof','sessionend'].includes(scenario)){const stopped=await call('broker_disconnect');assert.equal(stopped.connected,false);assert.equal(stopped.pending_connection_cancelled,true);}else if(scenario==='eof')child.stdin.end();else pluginHook(binding,{hook_event_name:'SessionEnd',session_id:sessionId},processIdentity(process.pid));
  releaseIssuance();
  if(!['eof','sessionend'].includes(scenario)){assert.equal((await pendingConnect).error.code,'connection_cancelled');assert.equal((await call('broker_identity')).error.code,'not_connected');if(scenario==='registration-disconnect'){const retry=await call('broker_connect',{connection_file:pairfiles[0]});assert(retry.client_id,JSON.stringify(retry));await call('broker_disconnect');}child.stdin.end();}
  assert.equal(await ended,0,stderr);assert.equal(issued.length,1);
  const bundles=readdirSync(join(root,'.config','psst','enrollment'),{recursive:true}).filter(x=>x.endsWith('/connection.json'));assert.equal(bundles.length,1);
  assert.equal((await peer.listClients({})).clients.filter(c=>c.client_type==='claude-code').length,scenario==='registration-disconnect'?1:0);return;
 }
 if(scenario==='broker-mismatch'){
  const rejected=await call('broker_connect',{connection_file:pairfiles[0]});assert.equal(rejected.error.effect,'not_applied');assert.equal(issued.length,0);assert([...grants.values()].every(grant=>!grant.response));
  child.stdin.end();assert.equal(await ended,0,stderr);return;
 }
 if(scenario==='native-setup'){await delay(400);assert.equal(issued.length,0);assert.equal((await call('broker_identity')).error.code,'not_connected');}
 const first=scenario==='native-setup'?await call('broker_setup'):await call('broker_connect',{connection_file:pairfiles[0]});assert(first.client_id,JSON.stringify(first));assert(first.credential_id);
 if(durable){
  const selected=JSON.parse(readFileSync(join(durableConfig,'psst','selected-installation.json')));
  assert(selected.connection_file.startsWith(join(durableConfig,'psst','enrollment')+'/'));
  child.stdin.end();assert.equal(await ended,0,stderr);
  for(const file of pairfiles)unlinkSync(file); // Initial one-use inputs are not needed again.
  selectedHome=join(root,'replacement-home');const newBinding={stateRoot:join(selectedHome,'.config','psst','native')},newSession=randomUUID();
  pluginHook(newBinding,{hook_event_name:'SessionStart',session_id:newSession},processIdentity(process.pid));
  await start();let auto;for(let i=0;i<100;i++){auto=await call('broker_identity');if(auto.client_id)break;await delay(25);}
  assert(auto.client_id,JSON.stringify(auto));assert.notEqual(auto.client_id,first.client_id);assert.equal(auto.credential_id,first.credential_id);assert.equal(issued.length,1);
  if(scenario==='native-setup'){assert(!stdout.includes(nativeSecret));assert(!stderr.includes(nativeSecret));assert.equal((await call('broker_setup')).error.code,'disconnect_before_pairing');}
  pluginHook(newBinding,{hook_event_name:'SessionEnd',session_id:newSession},processIdentity(process.pid));assert.equal(await ended,0,stderr);return;
 }
 if(scenario.startsWith('resume-')){
  child.stdin.end();assert.equal(await ended,0,stderr);
  const base=join(root,'.config','psst','enrollment'),relative=readdirSync(base,{recursive:true}).find(x=>x.endsWith('/connection.json')),file=join(base,relative);
  if(scenario==='resume-marker'){const value=JSON.parse(readFileSync(file));delete value.enrollment_receipt_file;writeFileSync(file,JSON.stringify(value));}else unlinkSync(file.replace(/connection.json$/,'enrollment.json'));
  await start();await delay(600);assert.equal((await call('broker_identity')).error.code,'not_connected');
  child.stdin.end();assert.equal(await ended,0,stderr);
  assert.equal((await peer.listClients({})).clients.filter(c=>c.client_type==='claude-code').length,1);return;
 }
 const sent=await peer.sendPrepared(peer.prepareSend({recipient_id:first.client_id,content:{type:'text/plain',text:'old credential pending'}}));let pending;for(let i=0;i<100;i++){pending=await call('broker_receive');if(pending.message)break;await delay(25);}assert.equal(pending.message_id,sent.message_id);
 assert.equal((await call('broker_connect',{connection_file:pairfiles[1]})).error.code,'disconnect_before_pairing');assert.equal(issued.length,1);
 await call('broker_disconnect');const second=await call('broker_connect',{connection_file:pairfiles[1]});assert(second.client_id,JSON.stringify(second));assert.notEqual(second.client_id,first.client_id);assert.notEqual(second.credential_id,first.credential_id);assert.equal((await call('broker_receive')).message,null);
 await call('broker_disconnect');const resumed=await call('broker_connect',{connection_file:pairfiles[0]});assert.equal(resumed.client_id,first.client_id);assert.equal((await call('broker_receive')).receipt_token,pending.receipt_token);assert.equal(issued.length,2);
 const tokens=readdirSync(join(root,'.config','psst','enrollment'),{recursive:true}).filter(x=>x.endsWith('/token')).map(x=>readFileSync(join(root,'.config','psst','enrollment',x),'utf8').trim());
 for(const secret of [...grants.keys()].map(x=>x.slice(8)).concat(tokens)){assert(!stdout.includes(secret));assert(!stderr.includes(secret));}
 pluginHook(binding,{hook_event_name:'SessionEnd',session_id:sessionId},processIdentity(process.pid));assert.equal(await ended,0,stderr);
});
