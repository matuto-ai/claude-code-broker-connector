import {fixtureHook as pluginHook} from './native-fixture-permit.mjs';
// Synthetic host for container/native-bound transport tests; never a model/CLI receipt.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {nativeStateConfig} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
import {fixtureArguments} from './native-fixture-permit.mjs';
const session=randomUUID(),owner=processIdentity(process.pid),config=nativeStateConfig(process.env,owner,session);
pluginHook(config,{hook_event_name:'SessionStart',session_id:session},owner);
const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/plugin-mcp.mjs',import.meta.url))],{stdio:['pipe','pipe','inherit']});
child.stdout.pipe(process.stdout);
const input=createInterface({input:process.stdin});
input.on('line',line=>{
 const request=JSON.parse(line);
 if(request.method==='tools/call')request.params.arguments=fixtureArguments({config,sessionId:session,host:owner,name:request.params.name,args:request.params.arguments??{}});
 child.stdin.write(JSON.stringify(request)+'\n');
});
input.on('close',()=>child.stdin.end());
child.on('exit',code=>{pluginHook(config,{hook_event_name:'SessionEnd',session_id:session},owner);process.exitCode=code;input.close();});
