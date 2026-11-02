// Account-free official CLI contract probe. Run only in Docker --network none.
// A loopback protocol fixture, NOT an authenticated model or native TUI acceptance test.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir,networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const VERSION='2.1.310', binary='/opt/claude/package/claude';
assert(Object.values(networkInterfaces()).flat().every(x=>x.internal),'loopback-only network required');
assert(!readFileSync('/proc/net/route','utf8').trim().split('\n').slice(1).some(x=>x.trim()),'no outbound route permitted');
assert.equal(JSON.parse(readFileSync('/opt/claude/package/package.json')).version,VERSION);
const root=mkdtempSync(join(tmpdir(),'psst-native-dispatch-'));
const boundedRun=(args,env,cwd)=>new Promise((resolve,reject)=>{
 const child=spawn(binary,args,{env,cwd,stdio:['ignore','pipe','pipe'],detached:true});let stdout='',stderr='',settled=false;
 const terminate=()=>{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
 const timer=setTimeout(terminate,25000);
 const collect=(field,chunk)=>{if(field==='stdout')stdout+=chunk;else stderr+=chunk;if(stdout.length+stderr.length>1024*1024)terminate();};
 child.stdout.on('data',c=>collect('stdout',c));child.stderr.on('data',c=>collect('stderr',c));
 child.on('exit',terminate);
 child.on('error',e=>{clearTimeout(timer);if(!settled){settled=true;reject(e);}});
 child.on('close',(code,signal)=>{clearTimeout(timer);if(!settled){settled=true;resolve({code,signal,stdout,stderr});}});
});
try {
 const summaries=[];let qualifiedToolName=null;
 for(const mode of ['allow-forged','allow-absent','deny']){
  const dir=join(root,mode),plugin=join(dir,'plugin'),home=join(dir,'home'),log=join(dir,'events.jsonl');
  mkdirSync(join(plugin,'.claude-plugin'),{recursive:true});mkdirSync(join(plugin,'hooks'));mkdirSync(home);
  const token='fixture-hook-'+randomUUID(),original={text:'fixture',details:{z:1,a:['unicode ✓',null,true]}};
  const json=(path,data)=>writeFileSync(path,JSON.stringify(data));
  json(join(plugin,'.claude-plugin/plugin.json'),{name:'psst-probe',version:'0.0.0'});
  writeFileSync(join(plugin,'hook.mjs'),`import fs from 'node:fs';let s='';for await(const c of process.stdin){s+=c;if(s.length>131072)throw Error('oversize');}const e=JSON.parse(s);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'hook',session:e.session_id,tool:e.tool_name,toolUseId:e.tool_use_id,input:e.tool_input})+'\\n');console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',updatedInput:{...e.tool_input,_psst_permit:${JSON.stringify(token)}}}}));`);
  json(join(plugin,'hooks/hooks.json'),{hooks:{PreToolUse:[{matcher:'mcp__.*',hooks:[{type:'command',command:process.execPath,args:[join(plugin,'hook.mjs')]}]}]}});
  writeFileSync(join(plugin,'mcp.mjs'),`import fs from 'node:fs';import readline from 'node:readline';for await(const line of readline.createInterface({input:process.stdin})){if(line.length>131072)throw Error('oversize');const r=JSON.parse(line);if(r.id===undefined)continue;let result={};if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'0'}};if(r.method==='tools/list')result={tools:[{name:'probe',description:'Local contract probe only',inputSchema:{type:'object',properties:{text:{type:'string'},details:{type:'object'},_psst_permit:{type:'string'}},required:['text','details'],additionalProperties:false}}]};if(r.method==='tools/call'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'dispatch',params:r.params})+'\\n');result={content:[{type:'text',text:'fixture accepted'}]};}console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));}`);
  json(join(plugin,'.mcp.json'),{mcpServers:{probe:{command:process.execPath,args:[join(plugin,'mcp.mjs')]}}});
  let turns=0,toolName=qualifiedToolName??'mcp__plugin_psst-probe_probe__probe',observedTool=false,correlatedResult=false,toolResultSummary=null;
  const gateway=createServer(async(req,res)=>{
   try{
    assert.equal(req.headers['x-api-key'],'fixture-only');let body='';for await(const c of req){body+=c;assert(body.length<=1024*1024);}
    const input=JSON.parse(body),route=req.url.split('?')[0];
    if(route==='/v1/messages/count_tokens'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"input_tokens":10}');return;}
    assert.equal(route,'/v1/messages');assert(++turns<=3,'bounded model fixture');
    const supplied=input.tools?.find(t=>t.name.endsWith('__probe'));if(supplied){assert.equal(supplied.name,toolName,'exact fixture tool alias');observedTool=true;}
    const results=input.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='tool_result'&&b.tool_use_id==='toolu_fixture_dispatch');
    correlatedResult ||= results.length>0;
    if(results.length)toolResultSummary=JSON.stringify(results).slice(0,2000);
    const tool=turns===1,block=tool?{type:'tool_use',id:'toolu_fixture_dispatch',name:toolName,input:{}}:{type:'text',text:''};
    const args={...original,...(mode==='allow-absent'?{}:{_psst_permit:'MODEL_FAKE'})};
    const delta=tool?{type:'input_json_delta',partial_json:JSON.stringify(args)}:{type:'text_delta',text:'fixture completed'};
    const message={id:'msg_fixture_'+turns,type:'message',role:'assistant',model:input.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}};
    const events=[['message_start',{type:'message_start',message}],['content_block_start',{type:'content_block_start',index:0,content_block:block}],['content_block_delta',{type:'content_block_delta',index:0,delta}],['content_block_stop',{type:'content_block_stop',index:0}],['message_delta',{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:1}}],['message_stop',{type:'message_stop'}]];
    res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [name,data]of events)res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);res.end();
   }catch{res.writeHead(400);res.end('fixture contract failure');}
  });
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,CLAUDE_CONFIG_DIR:join(home,'config'),ANTHROPIC_BASE_URL:`http://127.0.0.1:${gateway.address().port}`,ANTHROPIC_API_KEY:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ENABLE_TOOL_SEARCH:'false'};
  try{
   const version=await boundedRun(['--version'],env,dir);assert.equal(version.stdout.trim(),VERSION+' (Claude Code)');assert.equal(version.code,0);
   const args=['--plugin-dir',plugin,'--setting-sources','','-p','--output-format','json','--model','claude-sonnet-4-6','--max-turns','3','--tools',''];
   // Permissions apply only to this account-free disposable fixture, never the user's host.
   if(mode==='deny')args.push('--disallowedTools',toolName);else args.push('--allowedTools',toolName);
   args.push('--','Perform the local fixture probe once.');
   const result=await boundedRun(args,env,dir);
   assert.equal(result.code,0,JSON.stringify({signal:result.signal,stderr:result.stderr.slice(-1500),stdout:result.stdout.slice(-1500)}));
   const rows=existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
   const dispatch=rows.filter(r=>r.kind==='dispatch'),hooks=rows.filter(r=>r.kind==='hook');
   if(mode==='deny'){assert.equal(dispatch.length,0,'native deny must prevent MCP dispatch');assert(turns>=2&&correlatedResult,'native host must return a correlated result for the forbidden tool request');}
   else{
    assert(observedTool,'plugin tool must be advertised by actual native CLI');assert(correlatedResult,'native host must feed correlated tool result back');assert.equal(hooks.length,1);assert.equal(dispatch.length,1,JSON.stringify({mode,tool:toolName,hook_count:hooks.length,tool_result:toolResultSummary,stderr:result.stderr.slice(-1500)}));
    assert(hooks[0].session&&hooks[0].toolUseId);assert.equal(hooks[0].tool,toolName);assert.deepEqual(hooks[0].input,{...original,...(mode==='allow-absent'?{}:{_psst_permit:'MODEL_FAKE'})});
    qualifiedToolName=toolName;assert.equal(dispatch[0].params.name,'probe');assert.deepEqual(dispatch[0].params.arguments,{...original,_psst_permit:token});
   }
   summaries.push({mode,cli:VERSION,tool:toolName,hook_count:hooks.length,dispatch_count:dispatch.length,updated_input_without_permission_decision:mode!=='deny',native_permission_deny_preserved:mode==='deny'});
  }finally{gateway.closeAllConnections();await new Promise(r=>gateway.close(r));}
 }
 console.log(JSON.stringify({qualification:'native-hook-to-mcp-input',provider:'loopback-fixture-only',authenticated_model:false,interactive_clear_compact:false,results:summaries}));
}finally{rmSync(root,{recursive:true,force:true});}
