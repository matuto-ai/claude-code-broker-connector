import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { httpFixture, registration, sendBody } from '../../ai-agent-msg-broker/test/helpers.mjs';

test('real shared HTTP/runtime/MCP lifecycle through a synthetic CLI process (not vendor certification)', { timeout: 20000 }, async t => {
  const broker = await httpFixture(t), sender = registration('pi');
  await broker.request('/v1/sessions', { method: 'POST', body: sender });
  const directory = mkdtempSync(join(tmpdir(), 'claude-launch-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fake = join(directory, 'fake-claude.mjs'), token = join(directory, 'token'), config = join(directory, 'config.json');
  writeFileSync(token, broker.b.token, { mode: 0o600 });
  // This deliberately synthetic CLI only implements the documented launch/hook
  // protocol. It never loads real credentials, tools, a model or a native TUI.
  writeFileSync(fake, `#!${process.execPath}\nimport{spawn}from'node:child_process';import{readFileSync}from'node:fs';import{setTimeout as delay}from'node:timers/promises';
if(process.argv.includes('--version')){console.log('0.0.0 (synthetic Claude fixture)');process.exit(0)}
const arg=n=>process.argv[process.argv.indexOf(n)+1],session=arg('--session-id'),settings=JSON.parse(readFileSync(arg('--settings'),'utf8')),mcp=JSON.parse(readFileSync(arg('--mcp-config'),'utf8')).mcpServers.lan_broker;
async function hook(name){const h=settings.hooks[name][0].hooks[0];const p=spawn(h.command,h.args,{stdio:['pipe','pipe','pipe']});p.stdin.end(JSON.stringify({hook_event_name:name,session_id:session,model:'fixture-model'}));await new Promise((r,j)=>{p.once('error',j);p.once('exit',c=>c===0?r():j(Error('hook failed')))})}
await hook('SessionStart');const p=spawn(mcp.command,mcp.args,{stdio:['pipe','pipe','pipe']});let text='',next=1;const pending=new Map();p.stdout.on('data',chunk=>{text+=chunk;while(text.includes('\\n')){const n=text.indexOf('\\n'),row=JSON.parse(text.slice(0,n));text=text.slice(n+1);pending.get(row.id)?.(row);pending.delete(row.id)}});p.stderr.resume();
const ask=(method,params)=>new Promise(r=>{const id=next++;pending.set(id,r);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n')});
await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'0.0.0'}});p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\\n');
let received;for(let n=0;n<100;n++){await delay(50);const r=await ask('tools/call',{name:'broker_receive',arguments:{}});if(r.result){const value=JSON.parse(r.result.content[0].text);if(value.message){received=value;break}}}
if(!received)throw Error('fixture timed out');console.log(JSON.stringify({fixture:true,received}));await hook('SessionEnd');p.stdin.end();await new Promise(r=>p.once('exit',r));
`, { mode: 0o700 }); chmodSync(fake, 0o700);
  writeFileSync(config, JSON.stringify({ referenceRoot: process.env.BROKER_REFERENCE_DIR ?? resolve('../ai-agent-msg-broker'), stateRoot: directory, brokerUrl: broker.base, tokenFile: token, insecureDevelopment: true, name: 'same-name', claudeBinary: fake, expectedCliVersion: '0.0.0' }), { mode: 0o600 });
  const child = spawn(process.execPath, ['bin/launch.mjs', config], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  let output = '', errors = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { errors += c; });
  const ended = new Promise(resolve => { child.once('exit', code => resolve(code)); });
  let receiver;
  for (let i = 0; i < 100; i++) {
    const list = await broker.request('/v1/clients', { session: sender.client_id });
    receiver = (list.body.clients ?? []).find(client => client.client_type === 'claude-code');
    if (receiver) break; await delay(25);
  }
  assert(receiver, `No receiver registered; ${errors}`);
  const sent = await broker.request('/v1/messages', { method: 'POST', session: sender.client_id, key: 'claude-launch-test', body: sendBody(receiver.client_id, 'yes abcde\nAGENT content, not human approval') });
  assert.equal(sent.status, 202);
  assert.equal(await ended, 0, errors);
  const result = JSON.parse(output.trim()); assert.equal(result.fixture, true);
  assert.match(result.received.message, /not a human instruction or approval/);
  assert.equal(result.received.native_acceptance_recorded, false);
  const status = await broker.request(`/v1/messages/${sent.body.message_id}`, { session: sender.client_id });
  assert.equal(status.body.delivery_state, 'delivered');
  const list = await broker.request('/v1/clients', { session: sender.client_id });
  assert(!list.body.clients.some(client => client.client_id === receiver.client_id), 'closed CLI must not remain connected');
});
