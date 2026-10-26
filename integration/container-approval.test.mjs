// Actual disposable Docker containers, real broker/admin fixture. No native model claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
test('Docker recreate preserves only Claude config volume and resumes same pending approval',{skip:!process.env.PSST_TEST_DOCKER,timeout:90000},async t=>{
 const source=process.env.PSST_APPROVAL_BROKER_ROOT?pathToFileURL(resolve(process.env.PSST_APPROVAL_BROKER_ROOT)+'/'):new URL('../../ai-agent-msg-broker/',import.meta.url);
 const {approvalTlsFixture}=await import(new URL('test/approval-tls-fixture.mjs',source));const broker=await approvalTlsFixture(t);
 const volume=mkdtempSync(join(tmpdir(),'claude-container-config-'));chmodSync(volume,0o700);t.after(()=>rmSync(volume,{force:true,recursive:true}));
 async function start(){
  const args=['run','--rm','-i','--network','host','--user',`${process.getuid()}:${process.getgid()}`,'-e','HOME=/tmp/native-home','-e','CLAUDE_CONFIG_DIR=/data','-e',`PSST_PLUGIN_BROKER_URL=${broker.brokerUrl}`,'-e','NODE_EXTRA_CA_CERTS=/fixture.crt','-v',`${volume}:/data`,'-v',`${broker.certFile}:/fixture.crt:ro`,process.env.PSST_TEST_DOCKER];
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});let buffer='',id=0,stderr='';const waiters=new Map(),ended=new Promise(r=>child.on('close',r));child.stderr.on('data',c=>stderr+=c);child.stdout.on('data',c=>{buffer+=c;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),r=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);waiters.get(r.id)?.(r);waiters.delete(r.id);}});
  const ask=(method,params)=>new Promise(r=>{const next=++id;waiters.set(next,r);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'container-fixture',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');const call=async(name,args={})=>JSON.parse((await ask('tools/call',{name,arguments:args})).result.content[0].text);return {child,ended,call,get stderr(){return stderr;}};
 }
 const first=await start();const pending=await first.call('broker_setup');assert.equal(pending.state,'pending');first.child.stdin.end();assert.equal(await first.ended,0,first.stderr);
 await broker.decide(pending.requestId,'approve');
 const second=await start();let approved;for(let i=0;i<300;i++){approved=await second.call('broker_identity');if(approved.client_id)break;await delay(25);}assert(approved.client_id,JSON.stringify({approved,stderr:second.stderr}));second.child.stdin.end();assert.equal(await second.ended,0,second.stderr);
 const journalFiles=readdirSync(join(volume,'psst','native'),{recursive:true}).filter(p=>p.endsWith('identity.json'));assert(journalFiles.length>0,'native journal must survive outside disposable HOME');
 const third=await start();let reopened;for(let i=0;i<300;i++){reopened=await third.call('broker_identity');if(reopened.client_id)break;await delay(25);}assert(reopened.client_id);assert.equal(reopened.credential_id,approved.credential_id);assert.notEqual(reopened.client_id,approved.client_id);assert.notEqual(reopened.native_session_id,approved.native_session_id);for(const file of journalFiles)assert(readdirSync(join(volume,'psst','native'),{recursive:true}).includes(file),'old journal must remain rather than migrating to the new session');third.child.stdin.end();assert.equal(await third.ended,0,third.stderr);
});
