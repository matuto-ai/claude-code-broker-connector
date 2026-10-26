// Synthetic host for container/native-bound transport tests; never a model/CLI receipt.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pluginHook,nativeStateConfig} from '../src/plugin-state.mjs';
import {processIdentity} from '../src/launch-state.mjs';
const session=randomUUID(),owner=processIdentity(process.pid);
pluginHook(nativeStateConfig(),{hook_event_name:'SessionStart',session_id:session},owner);
const child=spawn(process.execPath,['bin/plugin-mcp.mjs'],{stdio:'inherit'});
child.on('exit',code=>{pluginHook(nativeStateConfig(),{hook_event_name:'SessionEnd',session_id:session},owner);process.exitCode=code;});
