// Official-host protocol fixture, not an authenticated model or automatic-delivery test.
// The caller must provide a disposable HOME and externally enforced offline isolation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

export function runCommand(binary,args,{env,cwd,timeout=20000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{env,cwd,stdio:['ignore','pipe','pipe'],detached:true});let stdout='',stderr='',error;
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')error??=e;}};
  const timer=setTimeout(()=>{error=Error('native fixture command timed out');kill();},timeout);
  child.on('error',e=>{error=e;});
  const read=(key,c)=>{if(key==='stdout')stdout+=c;else stderr+=c;if(stdout.length+stderr.length>2*1024*1024){error=Error('native fixture output exceeded limit');kill();}};
  child.stdout.on('data',c=>read('stdout',c));child.stderr.on('data',c=>read('stderr',c));
  child.on('close',code=>{clearTimeout(timer);kill();error?reject(error):resolve({code,stdout,stderr});});
 });
}

export async function startNativeHost({binary,env,cwd,tools,timeout=20000}){
 let child,closed,stopping=false,fatal,active,requests=0,sequence=0,bytes=0,stderr='';const rows=[],catalogs=[];
 const kill=()=>{if(child?.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}};
 const fail=e=>{fatal??=e;active?.reject(e);kill();};
 const gateway=createServer(async(req,res)=>{try{
  assert.equal(req.headers['x-api-key'],'fixture-only');let body='';for await(const c of req){body+=c;assert(body.length<=2*1024*1024);}
  const input=JSON.parse(body),route=req.url.split('?')[0];
  if(route==='/v1/messages/count_tokens'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"input_tokens":100}');return;}
  assert.equal(route,'/v1/messages');assert(++requests<=100,'bounded loopback provider');assert(active,'unexpected provider request');
  const names=(input.tools??[]).map(t=>t.name);catalogs.push(names);assert(names.includes(active.name),'installed native catalog lacks '+active.name);
  const invoke=!active.invoked;if(invoke)active.invoked=true;
  const block=invoke?{type:'tool_use',id:active.id,name:active.name,input:{}}:{type:'text',text:''};
  const message={id:'msg_fixture_'+requests,type:'message',role:'assistant',model:input.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}};
  const events=[['message_start',{type:'message_start',message}],['content_block_start',{type:'content_block_start',index:0,content_block:block}],['content_block_delta',{type:'content_block_delta',index:0,delta:invoke?{type:'input_json_delta',partial_json:JSON.stringify(active.arguments)}:{type:'text_delta',text:'Isolated fixture tool call completed.'}}],['content_block_stop',{type:'content_block_stop',index:0}],['message_delta',{type:'message_delta',delta:{stop_reason:invoke?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:30}}],['message_stop',{type:'message_stop'}]];
  res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [name,data]of events)res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);res.end();
 }catch(e){res.writeHead(400);res.end('fixture contract failure');fail(e);}});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 try{
  child=spawn(binary,['--setting-sources','user','-p','--verbose','--input-format','stream-json','--output-format','stream-json','--model','claude-sonnet-4-6','--max-turns','4','--tools','','--allowedTools',...tools],{env:{...env,ANTHROPIC_BASE_URL:`http://127.0.0.1:${gateway.address().port}`,ANTHROPIC_API_KEY:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ENABLE_TOOL_SEARCH:'false'},cwd,stdio:['pipe','pipe','pipe'],detached:true});
  closed=new Promise(r=>child.once('close',r));child.on('error',fail);child.stdin.on('error',e=>{if(!stopping)fail(e);});
  child.on('exit',(code,signal)=>{if(!stopping)fail(Error(`native host exited ${code}/${signal}: ${stderr.slice(-2000)}`));});
  child.stderr.on('data',c=>{stderr+=c;bytes+=c.length;if(bytes>2*1024*1024)fail(Error('native output overflow'));});
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{bytes+=line.length;if(bytes>2*1024*1024)return fail(Error('native output overflow'));try{
   const row=JSON.parse(line);rows.push(row);if(row.type==='result'&&active){assert.equal(row.subtype,'success',JSON.stringify(row).slice(0,1000));active.resolve(row);}
  }catch(e){fail(e);}});
  return {
   pid:child.pid,rows,catalogs,
   async call(name,args={}){
    if(fatal)throw fatal;assert(!active,'native fixture calls must be sequential');const start=rows.length;
    let timer;const done=new Promise((resolve,reject)=>{active={name,arguments:args,id:'toolu_fixture_'+(++sequence),invoked:false,resolve,reject};timer=setTimeout(()=>fail(Error('native tool timeout: '+name+'; '+stderr.slice(-1000))),timeout);});
    try{child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:'Perform the single authorized fixture tool call.'},parent_tool_use_id:null,session_id:''})+'\n');await done;
     const results=rows.slice(start).filter(r=>r.type==='user').flatMap(r=>Array.isArray(r.message?.content)?r.message.content:[]).filter(b=>b.type==='tool_result'&&b.tool_use_id===active.id);
     assert.equal(results.length,1,'exactly one correlated native result required');const result=results[0];
     const text=typeof result.content==='string'?result.content:result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
     return {text,isError:!!result.is_error,json(){return JSON.parse(text);}};
    }finally{clearTimeout(timer);active=null;}
   },
   async close(){stopping=true;child.stdin.end();kill();await closed;gateway.closeAllConnections();await new Promise(r=>gateway.close(r));},
  };
 }catch(e){stopping=true;kill();if(closed)await closed;gateway.closeAllConnections();await new Promise(r=>gateway.close(r));throw e;}
}
