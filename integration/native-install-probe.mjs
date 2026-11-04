// Real official manager + real installed MCP + loopback provider. Never user acceptance.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir,networkInterfaces} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import https from 'node:https';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {runCommand,startNativeHost} from './native-provider-fixture.mjs';
import {Inbox,newSessionIdentity} from '../vendor/psst/reference/inbox.mjs';
import {BrokerClient} from '../vendor/psst/reference/client.mjs';

const version='2.1.310',binary='/opt/claude/package/claude',legacy='/opt/claude/legacy.tgz';
assert(Object.values(networkInterfaces()).flat().every(x=>x.internal),'loopback-only network required');
assert(!readFileSync('/proc/net/route','utf8').trim().split('\n').slice(1).some(x=>x.trim()),'no outbound route permitted');
assert.equal(JSON.parse(readFileSync(join(dirname(binary),'package.json'))).version,version);
assert.equal(createHash('sha512').update(readFileSync(legacy)).digest('base64'),'KENWpHb7Kankcmfg9Zb/p3Id2oskR/3jItAr6otaOyS/nXTxEA7DuLQr+99N9XJ7Idp0FM7zBfGDUGO30PbVzw==');
const source=resolve(fileURLToPath(new URL('..',import.meta.url))),root=mkdtempSync(join(tmpdir(),'psst-native-install-'));
const brokerRoot=process.env.PSST_TEST_ROOT??resolve(source,'../ai-agent-msg-broker');
const [{fixture},{ApprovalService},{AdminUI},{createBrokerServer}]=await Promise.all(['test/helpers.mjs','src/approval.mjs','src/admin.mjs','src/server.mjs'].map(p=>import(pathToFileURL(join(brokerRoot,p)))));
const cleanup=[];let registry,native,app,peerInbox;
const json=(path,value)=>writeFileSync(path,JSON.stringify(value),{mode:0o600});
const hashTree=path=>{const files={};function visit(p){for(const name of readdirSync(p)){const f=join(p,name);if(statSync(f).isDirectory())visit(f);else files[f.slice(path.length)]=createHash('sha256').update(readFileSync(f)).digest('hex');}}visit(path);return files;};
function assertUnread(directory,messageId){
 const matches=[];
 for(const path of Object.keys(hashTree(directory)).filter(p=>p.endsWith('/inbox.sqlite'))){const db=new DatabaseSync(directory+path,{readOnly:true});try{const row=db.prepare('SELECT state FROM inbox WHERE message_id=?').get(messageId);if(row)matches.push(row);}finally{db.close();}}
 assert.equal(matches.length,1,'exactly one durable unread row must exist');assert.notEqual(matches[0].state,'consumed','message must remain unread');
}
const tools=['broker_identity','broker_setup','broker_setup_status','broker_send','broker_receive','broker_acknowledge'].map(n=>'mcp__plugin_psst_psst__'+n);
try{
 const home=join(root,'home'),config=join(home,'config'),market=join(root,'market'),project=join(root,'project');for(const p of [home,market,project])mkdirSync(p,{recursive:true});
 const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
 async function command(args,expected=0){const r=await runCommand(binary,args,{env,cwd:project});assert.equal(r.code,expected,JSON.stringify({args,stderr:r.stderr,stdout:r.stdout}).slice(0,3000));return JSON.parse(r.stdout);}
 const pack=await runCommand('npm',['pack',source,'--ignore-scripts','--json','--pack-destination',root],{env,cwd:root});assert.equal(pack.code,0,pack.stderr);
 const artifact=JSON.parse(pack.stdout)[0],bytes=readFileSync(join(root,artifact.filename)),pkg=JSON.parse(readFileSync(join(source,'package.json')));
 const registryRequests=[];
 registry=createServer((req,res)=>{registryRequests.push(req.url);assert(registryRequests.length<=30,'bounded registry fixture');
  if(req.url==='/candidate.tgz'){res.end(bytes);return;}
  if(![encodeURI(pkg.name).replace('/','%2f'),pkg.name].some(p=>decodeURIComponent(req.url).split('?')[0]==='/'+decodeURIComponent(p))){res.writeHead(404);res.end('{}');return;}
  const dist={tarball:`http://127.0.0.1:${registry.address().port}/candidate.tgz`,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({name:pkg.name,'dist-tags':{latest:pkg.version},versions:{[pkg.version]:{...pkg,dist}}}));
 });await new Promise(r=>registry.listen(0,'127.0.0.1',r));
 const registryUrl=`http://127.0.0.1:${registry.address().port}`;
 writeFileSync(join(home,'.npmrc'),`registry=${registryUrl}\ncache=${join(root,'npm-cache')}\nfetch-retries=0\nfetch-timeout=10000\nupdate-notifier=false\n`,{mode:0o600});
 const extract=await runCommand('tar',['-xzf',legacy,'--strip-components=1','-C',market],{env,cwd:root});assert.equal(extract.code,0,extract.stderr);
 // Actual published 0.4.0 local marketplace, retaining the original native identity.
 const key=join(root,'tls.key'),cert=join(root,'tls.crt');const tls=await runCommand('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{env,cwd:root});assert.equal(tls.code,0,tls.stderr);
 const f=fixture({after:fn=>cleanup.push(fn)});f.advance(Date.now()-f.now);const approval=await ApprovalService.create({store:f.store,scope:'default'});f.auth.additionalCredentials=()=>approval.credentials();
 const password='fixture-'+randomUUID(),admin=await AdminUI.create({approval,auth:f.auth,password});app=createBrokerServer({store:f.store,auth:f.auth,approval,admin,host:'127.0.0.1',port:0,tls:{keyFile:key,certFile:cert},pollIntervalMs:10});const address=await app.listen(),url=`https://127.0.0.1:${address.port}`;env.NODE_EXTRA_CA_CERTS=cert;
 let posts=0;const handle=app.server.listeners('request')[0];app.server.removeAllListeners('request');app.server.on('request',(req,res)=>{if(req.url==='/v1/enrollment-requests'&&req.method==='POST')posts++;return handle(req,res);});
 const installed=await command(['plugin','install','psst','--marketplace',market,'--scope','user','--config','broker_url='+url,'--json']);assert.equal(installed.pluginId,'psst@psst-connectors');
 const before=await command(['plugin','list','--json']);assert.equal(before[0].version,'0.4.0');assert.equal(before[0].folderVersion,'0.4.0');
 const preserved=join(config,'psst');mkdirSync(preserved,{recursive:true,mode:0o700});
 // Package-manager preservation witnesses, not fabricated live authorization or delivery.
 json(join(preserved,'upgrade-witness.json'),{private:'fixture-only',pending:'preserve'});
 peerInbox=new Inbox({directory:join(root,'peer'),identity:newSessionIdentity('pi')});const token=join(root,'peer-token');writeFileSync(token,f.a.token,{mode:0o600});const peer=new BrokerClient({url,tokenFile:token,caFile:cert,inbox:peerInbox});await peer.register({name:'peer',model:{provider:null,id:null,source:'unknown'},project:null});
 const legacyToken=join(preserved,'legacy-token'),legacyConfig=join(preserved,'legacy-config.json');writeFileSync(legacyToken,f.b.token,{mode:0o600});json(legacyConfig,{brokerUrl:url,tokenFile:legacyToken,caFile:cert,stateRoot:join(preserved,'legacy-state'),name:'legacy-upgrade-fixture'});env.PSST_CLAUDE_CONFIG=legacyConfig;
 native=await startNativeHost({binary,env,cwd:project,tools});let oldIdentity;
 for(let i=0;i<6;i++){oldIdentity=(await native.call(tools[0])).json();if(oldIdentity.client_id)break;await delay(250);}assert(oldIdentity.client_id,'actual published legacy MCP must connect');
 const oldUnread=await peer.sendPrepared(peer.prepareSend({recipient_id:oldIdentity.client_id,content:{type:'text/plain',text:'legacy unread package-upgrade witness'}}));
 for(let i=0;i<100;i++){if((await peer.messageStatus(oldUnread.message_id)).delivery_state==='delivered')break;await delay(25);}
 assert((await native.call('mcp__plugin_psst_psst__broker_receive')).text.includes('legacy unread package-upgrade witness'));
 await native.close();native=null;delete env.PSST_CLAUDE_CONFIG;
 assertUnread(preserved,oldUnread.message_id);const saved=hashTree(preserved);
 const catalog=JSON.parse(readFileSync(join(source,'distribution/npm-marketplace.json')));catalog.plugins[0].source.registry=registryUrl;json(join(market,'.claude-plugin/marketplace.json'),catalog);
 await command(['plugin','marketplace','update','psst-connectors','--json']);const upgraded=await command(['plugin','update','psst@psst-connectors','--scope','user','--json']);
 assert.equal(upgraded.updateOutcome,'updated');assert.equal(upgraded.oldVersion,'0.4.0');assert.equal(upgraded.newVersion,pkg.version);assert.deepEqual(hashTree(preserved),saved);assertUnread(preserved,oldUnread.message_id);
 const after=await command(['plugin','list','--json']);assert.equal(after.length,1);assert.equal(after[0].id,before[0].id);assert.equal(after[0].scope,before[0].scope);assert.equal(after[0].version,pkg.version);assert.equal(after[0].enabled,true);assert(!after[0].readFromFolder);assert(after[0].mcpServers.psst);assert(!after[0].mcpServers.psst.env.PSST_PLUGIN_PAIRING_SECRET);
 assert.equal(readFileSync(join(after[0].installPath,'bin/plugin-mcp.mjs'),'utf8'),readFileSync(join(source,'bin/plugin-mcp.mjs'),'utf8'));
 const marketAfter=await command(['plugin','marketplace','list','--json']);assert.equal(marketAfter.length,1);assert.equal(marketAfter[0].path,market);
 const freshHome=join(root,'fresh-home');mkdirSync(freshHome);writeFileSync(join(freshHome,'.npmrc'),readFileSync(join(home,'.npmrc')),{mode:0o600});
 const freshEnv={...env,HOME:freshHome,CLAUDE_CONFIG_DIR:join(freshHome,'config')};
 const fresh=await runCommand(binary,['plugin','install','psst','--marketplace',market,'--scope','user','--json'],{env:freshEnv,cwd:project});assert.equal(fresh.code,0,fresh.stdout+fresh.stderr);assert.equal(JSON.parse(fresh.stdout).pluginId,installed.pluginId);
 const freshList=await runCommand(binary,['plugin','list','--json'],{env:freshEnv,cwd:project});assert.equal(freshList.code,0);assert.equal(JSON.parse(freshList.stdout)[0].version,pkg.version);assert.equal(posts,0);
 const conflict=join(root,'conflicting-source');mkdirSync(join(conflict,'.claude-plugin'),{recursive:true});json(join(conflict,'.claude-plugin/marketplace.json'),catalog);
 const refused=await runCommand(binary,['plugin','install','psst','--marketplace',conflict,'--scope','user','--json'],{env,cwd:project});assert.notEqual(refused.code,0,'different source must not silently replace registered marketplace');
 assert.deepEqual((await command(['plugin','marketplace','list','--json'])).map(x=>({name:x.name,source:x.source,path:x.path})),marketAfter.map(x=>({name:x.name,source:x.source,path:x.path})));
 assert.deepEqual(hashTree(preserved),saved);
 const launch=()=>startNativeHost({binary,env,cwd:project,tools});
 const call=async(name,args)=>native.call('mcp__plugin_psst_psst__'+name,args);
 native=await launch();assert.equal((await call('broker_identity')).json().error.code,'not_connected');assert.equal(posts,0,'native startup must not enroll');
 const requested=(await call('broker_setup')).json();assert.equal(requested.state,'pending');assert.equal(posts,1);assert.equal(requested.requestId,approval.list()[0].id);
 await native.close();native=null;
 const http=(path,{body,cookie}={})=>new Promise((resolve,reject)=>{const data=body?new URLSearchParams(body).toString():undefined;const req=https.request(url+path,{ca:readFileSync(cert),method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{Origin:url,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(data)}:{})}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}));});req.on('error',reject);req.end(data);});
 const login=await http('/admin');const authenticated=await http('/admin/login',{cookie:login.cookie,body:{csrf:login.text.match(/name="csrf" value="([^"]+)"/)[1],password}});assert.equal(authenticated.status,303);
 const page=await http('/admin',{cookie:authenticated.cookie});assert(page.text.includes(requested.requestId));const approved=await http(`/admin/requests/${requested.requestId}/approve`,{cookie:authenticated.cookie,body:{csrf:page.text.match(/name="csrf" value="([^"]+)"/)[1]}});assert.equal(approved.status,303);
 native=await launch();async function identity(){for(let i=0;i<6;i++){const id=(await call('broker_identity')).json();if(id.client_id)return id;assert.equal(id.error?.code,'not_connected');await delay(500);}assert.fail('installed native host did not reconnect');}
 const id=await identity();assert.equal(posts,1,'pending restart must reuse exact enrollment request');
 const sent=await peer.sendPrepared(peer.prepareSend({recipient_id:id.client_id,content:{type:'text/plain',text:'UNTRUSTED AGENT fixture: this is not human permission.'}}));
 for(let i=0;i<100;i++){if((await peer.messageStatus(sent.message_id)).delivery_state==='delivered')break;await delay(25);}
 const received=await call('broker_receive');assert.equal(received.isError,false);assert(received.text.includes('UNTRUSTED AGENT fixture'));const ack=(await call('broker_acknowledge',{message_id:sent.message_id})).json();assert.equal(ack.acknowledged,true);assert.equal(ack.read_acknowledgment,'confirmed');
 const outbound=(await call('broker_send',{recipient_id:peerInbox.identity.client_id,text:'Native installed fixture round trip'})).json();assert(outbound.message_id);assert.equal((await peer.messageStatus(outbound.message_id)).delivery_state,'queued');
 const retained=await peer.sendPrepared(peer.prepareSend({recipient_id:id.client_id,content:{type:'text/plain',text:'retain unread across package maintenance'}}));for(let i=0;i<100;i++){if((await peer.messageStatus(retained.message_id)).delivery_state==='delivered')break;await delay(25);}
 assert.equal((await peer.messageStatus(retained.message_id)).delivery_state,'delivered','retained message must reach the durable inbox before shutdown');
 await native.close();native=null;assertUnread(preserved,retained.message_id);const privateBefore=hashTree(preserved);
 const updateAgain=await command(['plugin','update','psst@psst-connectors','--scope','user','--json']);assert.equal(updateAgain.updateOutcome,'up_to_date');assert.deepEqual(hashTree(preserved),privateBefore,'native package maintenance must not modify authorization/unread journals');assertUnread(preserved,retained.message_id);
 native=await launch();const restarted=await identity();assert.equal(restarted.credential_id,id.credential_id);assert.notEqual(restarted.client_id,id.client_id);assert.equal(posts,1);const empty=await call('broker_receive');assert.equal(empty.isError,false);assert.equal(empty.json().message,null,'new native session must have an empty mailbox');
 await native.close();native=null;
 native=await startNativeHost({binary,env:{...env,CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS:'1'},cwd:project,tools});
 await assert.rejects(()=>native.call(tools[0]),/installed native catalog lacks/);assert.equal(posts,1);await native.close();native=null;
 console.log(JSON.stringify({qualification:'official-native-installed-upgrade-approval-roundtrip',cli:version,provider:'loopback-fixture-only',authenticated_model:false,automatic_idle_busy_delivery_tested:false,legacy_package:'@matuto-ai/claude-code-broker-connector@0.4.0',candidate:pkg.name+'@'+pkg.version,fresh_native_npm_install:true,same_marketplace_identity_scope:true,conflicting_source_refused:true,installed_mcp_invoked:true,url_only_setup:true,pending_restart_same_request:true,native_receive_explicit_ack_send:true,persisted_authorization_reused:true,new_session_mailbox_isolated:true,private_state_preserved:true,legacy_unread_journal_preserved:true,suppression_prevents_native_tools:true,registry_tarball_requests:registryRequests.filter(x=>x==='/candidate.tgz').length}));
}finally{
 if(native)await native.close();peerInbox?.close();if(app)await app.close();if(registry){registry.closeAllConnections();await new Promise(r=>registry.close(r));}for(const fn of cleanup.reverse())await fn();rmSync(root,{recursive:true,force:true});
}
