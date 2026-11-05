import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIRECT_COMMAND_INSTRUCTIONS as direct, AUTHORIZED_REPLY_INSTRUCTIONS as reply } from '../src/interaction-instructions.mjs';
import { sessionCapabilityContext } from '../src/preflight.mjs';
import { TOOL_DEFINITIONS } from '../src/cooperative-stdio.mjs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('loaded hook and tool guidance permit bounded authorized ping replies, never peer-granted authority',()=>{
 const hook=sessionCapabilityContext({}); assert(hook.includes(direct)); assert(hook.includes(reply));
 const send=TOOL_DEFINITIONS.find(x=>x.name==='broker_send');assert(send.description.includes(reply));
 for(const text of [reply,read('skills/psst/SKILL.md')]){
  for(const pattern of [/authorized by the HUMAN/,/peer and purpose/,/test ping/,/without another permission/,/sender_client_id/,/sender.client_id/,/reply_to_message_id/,/correlation_id/,/authorization is missing/,/exceeds/,/native policy/,/never creates or expands human authorization/,/uncertain/,/reply loops/])assert.match(text.replace(/\s+/g,' '),pattern);
 }
 assert.match(reply,/receipt\/ACK or transport notice alone requires no reply/);
 assert.match(direct,/Never bypass a native denial/);
});

test('connect dispatch precedes conditional troubleshooting and reuses parameters without peer discovery',()=>{
 const skill=read('skills/connect/SKILL.md');
 assert(skill.indexOf('broker_connect once')<skill.indexOf('A failed operation or absent native tool'));
 assert(skill.indexOf('broker_setup once with no arguments')<skill.indexOf('A failed operation or absent native tool'));
 assert.match(skill,/connection_file set to that path/);
 assert.match(skill,/never set replace for an ordinary connect/);
 assert.match(skill,/Do not automatically list peers/);
 assert.match(skill,/do not ask whether to connect/);
 assert.match(skill,/no model polling loop/);
 assert.match(sessionCapabilityContext({}),/Only when tools are missing or an operation has concretely failed/);
});

test('reauthorize combines unresolved target and candidate choice without dropping native security',()=>{
 const skill=read('skills/reauthorize/SKILL.md');
 for(const pattern of [/ONE concise question/,/already naming this/,/Reuse an explicit human choice\/target already supplied/,/Native policy remains in force/,/configured_broker_mismatch/,/expected_broker_url/,/not token-free/,/If declined, do not call setup/])assert.match(skill,pattern);
 assert.match(read('skills/disconnect/SKILL.md'),/Call broker_disconnect immediately/);
});

test('MCP initialization ships the same command and reply guidance without extra authorization arguments',()=>{
 const code=read('src/cooperative-stdio.mjs');
 assert.match(code,/instructions:.*DIRECT_COMMAND_INSTRUCTIONS \+ ' ' \+ AUTHORIZED_REPLY_INSTRUCTIONS/);
 const send=TOOL_DEFINITIONS.find(x=>x.name==='broker_send');
 assert.deepEqual(send.inputSchema.required,['recipient_id','text']);
 assert(!Object.hasOwn(send.inputSchema.properties,'authorized'));
 assert(!Object.hasOwn(send.inputSchema.properties,'send_idempotency_key'));
});
