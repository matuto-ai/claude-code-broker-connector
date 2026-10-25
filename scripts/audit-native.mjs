// Optional no-auth/no-model native ABI check. Does not install or configure Claude.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const binary=process.env.CLAUDE_AUDIT_BIN;if(!binary)throw Error('Set CLAUDE_AUDIT_BIN to an existing official Claude executable');
const root=mkdtempSync(join(tmpdir(),'psst-native-audit-'));
try {
 for(const p of ['home','project','plugin/.claude-plugin','plugin/hooks'])mkdirSync(join(root,p),{recursive:true,mode:0o700});
 const log=join(root,'events.jsonl'),probe=join(root,'probe.mjs');
 writeFileSync(probe,`import{appendFileSync,readFileSync}from'node:fs';const role=process.argv[2];const stat=readFileSync('/proc/'+process.ppid+'/stat','utf8');const start=stat.slice(stat.lastIndexOf(') ')+2).trim().split(/\\s+/)[19];const emit=x=>appendFileSync(${JSON.stringify(log)},JSON.stringify(x)+'\\n');emit({role,ppid:process.ppid,start});if(role==='hook'){let s='';for await(const c of process.stdin)s+=c;const e=JSON.parse(s);emit({role:'event',event:e.hook_event_name,session_id:e.session_id});await new Promise(r=>setTimeout(r,500));}else{let b='';process.stdin.on('data',c=>{b+=c;while(b.includes('\\n')){const i=b.indexOf('\\n'),r=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(r.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:r.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'psst-parent-probe',version:'0'}}:r.method==='tools/list'?{tools:[]}:{}})+'\\n');}});}`);
 const json=(p,v)=>writeFileSync(join(root,p),JSON.stringify(v));
 json('plugin/.claude-plugin/plugin.json',{name:'psst-parent-probe',version:'0.0.0'});
 json('plugin/.mcp.json',{mcpServers:{probe:{command:process.execPath,args:[probe,'mcp']}}});
 json('plugin/hooks/hooks.json',{hooks:{SessionStart:[{hooks:[{type:'command',command:process.execPath,args:[probe,'hook']}]}]}});
 const env={PATH:process.env.PATH,HOME:join(root,'home'),LANG:'C.UTF-8'};
 const version=spawnSync(binary,['--version'],{env,encoding:'utf8',timeout:10000});assert.equal(version.status,0,version.stderr);
 const run=spawnSync(binary,['--plugin-dir',join(root,'plugin'),'--debug-file',join(root,'debug.log'),'--init-only'],{cwd:join(root,'project'),env,encoding:'utf8',timeout:20000});assert.equal(run.status,0,run.stderr);
 const rows=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),hook=rows.find(x=>x.role==='hook'),mcp=rows.find(x=>x.role==='mcp'),event=rows.find(x=>x.role==='event');
 assert(hook&&mcp&&event,JSON.stringify(rows)) ;assert.equal(hook.ppid,mcp.ppid);assert.equal(hook.start,mcp.start);assert.equal(event.event,'SessionStart');assert.match(event.session_id,/^[a-f0-9-]+$/i);
 console.log(JSON.stringify({version:version.stdout.trim(),same_native_parent:true,native_session_id_supplied:true,authenticated_model_test:false}));
} finally {if(process.env.PSST_AUDIT_KEEP==='1')console.error(root);else rmSync(root,{recursive:true,force:true});}
