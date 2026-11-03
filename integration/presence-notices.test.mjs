import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { httpFixture, registration } from '../../ai-agent-msg-broker/test/helpers.mjs';
import { fixtureHook as pluginHook } from './native-fixture-permit.mjs';
import { hostDirectory, readBinding } from '../src/plugin-state.mjs';
import { processIdentity, readPrivateJson } from '../src/launch-state.mjs';
import { issueNativePermit } from '../src/native-call-permit.mjs';

// Actual broker HTTP, SQLite journals and MCP/monitor processes. Native hook and
// tool-boundary input is synthetic: not authenticated Claude/model acceptance.
test('prolonged-offline native tools preserve pending mail, explicit event ACK, restart and lifetime fence', { timeout: 25000 }, async t => {
  const broker = await httpFixture(t); broker.advance(Date.now() - broker.now);
  const recipient = registration('pi');
  assert.equal((await broker.request('/v1/sessions', { method: 'POST', body: recipient })).status, 200);
  const root = mkdtempSync(join(tmpdir(), 'claude-presence-http-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const token = join(root, 'token'), configPath = join(root, 'config.json');
  writeFileSync(token, broker.b.token, { mode: 0o600 });
  const config = { brokerUrl: broker.base, tokenFile: token, stateRoot: root, name: 'presence-fixture', insecureDevelopment: true };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const host = processIdentity(process.pid), sessionId = randomUUID(), directory = hostDirectory(config, host).directory;
  const hook = hook_event_name => pluginHook(config, { hook_event_name, session_id: sessionId }, host);
  hook('SessionStart');
  const permit = (name, args = {}) => issueNativePermit({ directory, binding: readBinding(directory), event: {
    hook_event_name: 'PreToolUse', session_id: sessionId, tool_use_id: 'fixture_' + randomUUID(), tool_name: 'mcp__plugin_psst_psst__' + name, tool_input: args,
  } }).arguments;
  async function start() {
    const child = spawn(process.execPath, ['bin/plugin-mcp.mjs'], { env: { ...process.env, HOME: root, PSST_CLAUDE_CONFIG: configPath }, stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let buffer = '', stderr = '', next = 0;
    const pending = new Map(), ended = new Promise(resolve => child.once('exit', resolve));
    child.stderr.on('data', chunk => stderr += chunk);
    child.stdout.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        pending.get(message.id)?.(message); pending.delete(message.id);
      }
    });
    const ask = (method, params) => new Promise(resolve => {
      const id = ++next; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-presence-native', version: '0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const call = async (name, args = {}) => {
      const response = await ask('tools/call', { name, arguments: permit(name, args) });
      assert(!response.error, JSON.stringify(response));
      return response.result.structuredContent ?? JSON.parse(response.result.content[0].text);
    };
    let identity;
    for (let attempt = 0; attempt < 100; attempt++) {
      identity = await call('broker_identity'); if (identity.client_id) break; await delay(25);
    }
    assert(identity.client_id, stderr);
    return { child, ended, ask, call, identity, get stderr() { return stderr; } };
  }
  let m = await start();
  const sender = m.identity.client_id;
  const sent = await m.call('broker_send', { recipient_id: recipient.client_id, text: 'PRIVATE MESSAGE CONTENT, never a presence notice', ttl_seconds: 3600 });
  assert(sent.message_id);
  assert.deepEqual((await m.call('broker_presence_events')).events, []);
  broker.advance(599999);
  await broker.request(`/v1/sessions/${sender}/heartbeat`, { method: 'POST', token: broker.b.token, session: sender, body: {} });
  assert.deepEqual((await m.call('broker_presence_events')).events, []);
  broker.advance(1);
  const remote = await broker.request('/v1/presence-events', { token: broker.b.token, session: sender });
  const id = remote.body.events[0].event_id;
  assert.equal((await m.call('broker_acknowledge_presence_event', { event_id: id })).error.code, 'receipt_required');
  const observed = await m.call('broker_presence_events');
  assert.equal(observed.events[0].event_id, id);
  assert.equal(observed.events[0].messages[0].message_id, sent.message_id);
  assert.doesNotMatch(JSON.stringify(observed), /PRIVATE MESSAGE CONTENT|receipt_token|tokenFile/);
  const visible = await m.ask('tools/call', { name: 'broker_presence_events', arguments: permit('broker_presence_events') });
  assert.match(visible.result.content[0].text, /^Psst · transport notice/);
  assert.match(visible.result.content[0].text, /not an agent instruction/);
  assert.equal(readPrivateJson(join(directory, 'notice.json')).presence_event_id, id);
  const monitor = spawn(process.execPath, ['bin/plugin-monitor.mjs'], { env: { ...process.env, HOME: root, PSST_CLAUDE_CONFIG: configPath, CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: sessionId }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (monitor.exitCode === null) monitor.kill('SIGKILL'); });
  const monitorEnded = new Promise(resolve => monitor.once('exit', resolve)); let output = '';
  monitor.stdout.on('data', chunk => output += chunk);
  for (let attempt = 0; attempt < 80 && !output; attempt++) await delay(25);
  assert.match(output, /broker_presence_events/); assert.doesNotMatch(output, /PRIVATE MESSAGE CONTENT/);
  assert(!output.includes(id));
  assert.equal((await m.call('broker_presence_events')).events[0].event_id, id, 'stdout and reads do not ACK');
  m.child.stdin.end(); assert.equal(await m.ended, 0, m.stderr);
  m = await start(); assert.equal(m.identity.client_id, sender);
  assert.equal((await m.call('broker_presence_events')).events[0].event_id, id);
  assert.deepEqual(await m.call('broker_acknowledge_presence_event', { event_id: id }), { event_id: id, acknowledged: true });
  assert.deepEqual(await m.call('broker_acknowledge_presence_event', { event_id: id }), { event_id: id, acknowledged: true });
  assert.deepEqual((await m.call('broker_presence_events')).events, []);
  assert.equal((await m.call('broker_message_status', { message_id: sent.message_id })).delivery_state, 'queued');
  assert.equal((await m.call('broker_receive')).message, null, 'transport notices never enter the message inbox');
  const stale = permit('broker_presence_events');
  hook('SessionEnd');
  const refused = await m.ask('tools/call', { name: 'broker_presence_events', arguments: stale });
  assert(refused.error || refused.result?.isError); assert(!JSON.stringify(refused).includes(id));
  m.child.stdin.end(); assert.equal(await m.ended, 0, m.stderr); assert.equal(await monitorEnded, 0);
});
