// Actual official Claude in ONE process. Account-free loopback provider, not user acceptance.
// Run ONLY inside reviewed Docker --network none isolation; never emulate lifecycle hooks.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir,networkInterfaces} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {httpFixture} from '../test/retention-fixture.mjs';
import {hostDirectory,readBinding} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
const version='2.1.310',binary='/opt/claude/package/claude';
assert(Object.values(networkInterfaces()).flat().every(x=>x.internal),'loopback-only network required');
assert(!readFileSync('/proc/net/route','utf8').trim().split('\n').slice(1).some(x=>x.trim()),'no outbound route permitted');
assert.equal(JSON.parse(readFileSync('/opt/claude/package/package.json')).version,version);
const root=mkdtempSync(join(tmpdir(),'psst-native-lifecycle-')),cleanup=[];
let child,closedChild,gateway,timeout,fatal,stderr='',bytes=0;
const kill=()=>{if(child?.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}};
const rows=[],waiters=[];
function fail(error){fatal??=error;for(const w of waiters.splice(0))w.reject(error);kill();}
function received(row){rows.push(row);for(const w of [...waiters])if(w.predicate(row)){waiters.splice(waiters.indexOf(w),1);w.resolve(row);}}
function waitFor(predicate,start){if(fatal)return Promise.reject(fatal);const match=rows.slice(start).find(predicate);if(match)return Promise.resolve(match);return new Promise((resolve,reject)=>waiters.push({predicate,resolve,reject}));}
const json=(path,data)=>writeFileSync(path,JSON.stringify(data),{mode:0o600});
try {
 const f=await httpFixture({after:fn=>cleanup.push(fn)},{requireRegistrationV2:true});f.advance(Date.now()-f.now);
 const plugin=join(root,'plugin'),home=join(root,'home'),log=join(root,'native.jsonl');mkdirSync(home);
 const source=resolve(fileURLToPath(new URL('..',import.meta.url)));
 cpSync(source,plugin,{recursive:true,filter:p=>!p.split('/').some(part=>['.git','node_modules'].includes(part))});
 const config={brokerUrl:f.base,tokenFile:join(root,'token'),stateRoot:join(root,'state'),name:'native-lifecycle-fixture',insecureDevelopment:true,registrationVersion:2};
 writeFileSync(config.tokenFile,f.b.token,{mode:0o600});const configFile=join(root,'config.json');json(configFile,config);
 // These observers log native inputs/PIDs only. The production hooks and MCP execute unchanged.
 const observer=join(root,'observe.mjs');writeFileSync(observer,`import fs from 'node:fs';let text='';for await(const c of process.stdin){text+=c;if(text.length>262144)throw Error('oversize');}const e=JSON.parse(text);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'native_hook',event:e.hook_event_name,session:e.session_id,source:e.source,reason:e.reason,tool:e.tool_name,toolUseId:e.tool_use_id,agent:e.agent_id})+'\\n');`);
 const trace=join(root,'trace.mjs');writeFileSync(trace,`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'mcp_start',pid:process.pid,ppid:process.ppid})+'\\n');`);
 const hooks=JSON.parse(readFileSync(join(plugin,'hooks/hooks.json')));
 for(const event of ['SessionStart','SessionEnd','PreToolUse'])hooks.hooks[event].push({...(event==='PreToolUse'?{matcher:'mcp__.*psst.*__broker_.*'}:{}),hooks:[{type:'command',command:process.execPath,args:[observer],timeout:5}]});
 json(join(plugin,'hooks/hooks.json'),hooks);
 json(join(plugin,'.mcp.json'),{mcpServers:{psst:{command:process.execPath,args:['--import',trace,join(plugin,'bin/plugin-mcp.mjs')]}}});
 // Disable autonomous monitor for deterministic account-free protocol qualification;
 // this fixture makes no monitor-delivery or authenticated-model acceptance claim.
 rmSync(join(plugin,'monitors'),{recursive:true,force:true});
 const manifest=JSON.parse(readFileSync(join(plugin,'.claude-plugin/plugin.json')));delete manifest.monitors;json(join(plugin,'.claude-plugin/plugin.json'),manifest);
 const toolName='mcp__plugin_psst_psst__broker_identity';
 let phase='startup',requestCount=0,toolSequence=0,currentCall=null;
 const calls=[],catalogs=[];
 gateway=createServer(async(req,res)=>{try{
  assert.equal(req.headers['x-api-key'],'fixture-only');let body='';for await(const c of req){body+=c;assert(body.length<=2*1024*1024);}
  const input=JSON.parse(body),route=req.url.split('?')[0];
  if(route==='/v1/messages/count_tokens'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"input_tokens":2000}');return;}
  assert.equal(route,'/v1/messages');assert(++requestCount<=24,'bounded loopback provider');
  const tools=input.tools??[];catalogs.push({phase,identity:tools.some(t=>t.name===toolName)});
  const result=input.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(b=>b.type==='tool_result'&&b.tool_use_id===currentCall?.id);
  if(result&&!currentCall.result){currentCall.result=result;calls.push(currentCall);}
  const invoke=phase.startsWith('identity-')&&!currentCall;
  if(invoke){assert(tools.some(t=>t.name===toolName),'native catalog lost broker_identity');currentCall={phase,id:'toolu_lifecycle_'+(++toolSequence)};}
  const summary='Fixture summary: this is an isolated local lifecycle qualification. Preserve no user secrets. The previous conversation exercised a harmless local identity read. '.repeat(12);
  const text=phase==='compact'?summary:'Local identity check completed. '+summary;
  const block=invoke?{type:'tool_use',id:currentCall.id,name:toolName,input:{}}:{type:'text',text:''};
  const message={id:'msg_'+requestCount,type:'message',role:'assistant',model:input.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:2000,output_tokens:0}};
  const events=[['message_start',{type:'message_start',message}],['content_block_start',{type:'content_block_start',index:0,content_block:block}],['content_block_delta',{type:'content_block_delta',index:0,delta:invoke?{type:'input_json_delta',partial_json:'{}'}:{type:'text_delta',text}}],['content_block_stop',{type:'content_block_stop',index:0}],['message_delta',{type:'message_delta',delta:{stop_reason:invoke?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:300}}],['message_stop',{type:'message_stop'}]];
  res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [name,data]of events)res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);res.end();
 }catch(e){res.writeHead(400);res.end('fixture contract failure');fail(e);}});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,CLAUDE_CONFIG_DIR:join(home,'config'),PSST_CLAUDE_CONFIG:configFile,ANTHROPIC_BASE_URL:`http://127.0.0.1:${gateway.address().port}`,ANTHROPIC_API_KEY:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ENABLE_TOOL_SEARCH:'false'};
 const args=['--plugin-dir',plugin,'--setting-sources','','-p','--verbose','--input-format','stream-json','--output-format','stream-json','--model','claude-sonnet-4-6','--max-turns','4','--tools','','--allowedTools',toolName];
 child=spawn(binary,args,{env,cwd:root,stdio:['pipe','pipe','pipe'],detached:true});
 closedChild=new Promise(r=>child.once('close',r));
 const pid=child.pid;child.on('error',fail);child.stdin.on('error',fail);child.on('exit',(code,signal)=>{if(phase!=='finished')fail(Error(`native host exited ${code}/${signal}; ${stderr.slice(-2000)}`));kill();});
 timeout=setTimeout(()=>fail(Error(`native lifecycle timeout in ${phase}; ${stderr.slice(-2000)}; events=${JSON.stringify(rows.slice(-3)).slice(-3000)}`)),65000);
 child.stderr.on('data',c=>{stderr+=c;bytes+=c.length;if(bytes>2*1024*1024)fail(Error('native output overflow'));});
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{bytes+=line.length;if(bytes>2*1024*1024)return fail(Error('native output overflow'));try{received(JSON.parse(line));}catch(e){fail(e);}});
 async function prompt(text,nextPhase){phase=nextPhase;currentCall=null;const start=rows.length;child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:''})+'\n');const result=await waitFor(r=>r.type==='result',start);assert.equal(result.subtype,'success',JSON.stringify(result).slice(0,3000));assert.equal(child.pid,pid);assert.equal(child.exitCode,null);return {result,start};}
 const events=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 function binding(){return readBinding(hostDirectory(config,processIdentity(pid)).directory);}
 async function identity(label){
  for(let attempt=0;attempt<3;attempt++){
   const {start}=await prompt('Read the local Psst identity exactly once.',`identity-${label}-${attempt}`);
   const call=calls.at(-1);assert(call&&call.phase===phase,'native host did not return correlated MCP result');
   // Parse the correlated native stream result, not the provider copy augmented with reminders.
   const nativeResult=rows.slice(start).filter(r=>r.type==='user').flatMap(r=>Array.isArray(r.message?.content)?r.message.content:[]).filter(b=>b.type==='tool_result'&&b.tool_use_id===call.id);
   assert.equal(nativeResult.length,1,'exactly one correlated native MCP result required');
   const content=nativeResult[0].content;const text=typeof content==='string'?content:content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
   let id;try{id=JSON.parse(text);}catch{assert.fail('MCP identity result was not JSON: '+text.slice(0,2000));}
   if(id.client_id){assert(!nativeResult[0].is_error,JSON.stringify(nativeResult[0]));return id;}
   assert.equal(id.error?.code,'not_connected',JSON.stringify(id));
   // Permit one bounded production auto-connect tick; completion still requires a real identity.
   await delay(250);
  }
  assert.fail('native identity did not connect');
 }
 const first=await identity('before-clear'),before=binding();
 assert.equal(first.native_session_id,before.sessionId);assert.equal(before.closed,false);
 const init=rows.find(r=>r.type==='system'&&r.subtype==='init');assert(init,'native init required');assert(init.slash_commands?.includes('clear'),'actual native clear command required');
 const clearStart=events().length;
 await prompt('/clear','clear');
 const second=await identity('after-clear'),after=binding();
 assert.notEqual(after.sessionId,before.sessionId,'actual clear must create a new native session');assert.notEqual(after.lifetime,before.lifetime,'clear must replace lifetime');assert.notEqual(second.client_id,first.client_id,'clear must not reuse old mailbox');assert.equal(second.native_session_id,after.sessionId);
 const transition=events().slice(clearStart);
 assert(transition.some(e=>e.event==='SessionEnd'&&e.session===before.sessionId&&e.reason==='clear'),'actual native clear SessionEnd missing');
 assert(transition.some(e=>e.event==='SessionStart'&&e.session===after.sessionId&&e.source==='clear'),'actual native clear SessionStart missing');
 const compact=await prompt('/compact','compact');
 assert(rows.slice(compact.start).some(r=>r.type==='system'&&r.subtype==='compact_boundary'),'native compact must actually run, not report insufficient context');
 const third=await identity('after-compact'),compacted=binding();
 assert.equal(compacted.sessionId,after.sessionId);assert.equal(compacted.lifetime,after.lifetime);assert.equal(third.client_id,second.client_id);assert.equal(third.native_session_id,second.native_session_id);
 const startups=events().filter(e=>e.kind==='mcp_start');assert.equal(startups.length,1,'MCP must survive lifecycle transition, not restart');assert.equal(startups[0].ppid,pid);process.kill(startups[0].pid,0);
 for(const call of calls)assert(events().some(e=>e.event==='PreToolUse'&&e.toolUseId===call.id&&e.tool===toolName&&!e.agent),'every native call requires its actual main-session hook');
 console.log(JSON.stringify({qualification:'official-native-same-process-clear-compact',cli:version,provider:'loopback-fixture-only',authenticated_model:false,monitor_delivery_tested:false,one_host_process:true,one_mcp_process:true,clear_new_session_lifetime_mailbox:true,compact_preserves_session_lifetime_mailbox:true,native_hook_calls:calls.length,catalogs:catalogs.filter(x=>x.phase.startsWith('identity-')).length,negative_stale_child_cases:'covered separately by production protocol tests, not this native probe'}));
 phase='finished';child.stdin.end();kill();
} catch(e){console.error(JSON.stringify({qualification:'official-native-same-process-clear-compact',phase:'failed',error:e.message,stderr:stderr.slice(-2000),last_events:rows.slice(-3)}));throw e;}
finally{clearTimeout(timeout);kill();await closedChild;if(gateway){gateway.closeAllConnections();await new Promise(r=>gateway.close(r));}for(const fn of cleanup.reverse())await fn();rmSync(root,{recursive:true,force:true});}
