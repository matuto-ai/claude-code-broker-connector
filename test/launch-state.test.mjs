import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { launchFiles, readPrivateJson, writePrivateJson, processIdentity, verifyLaunch, applyHook, observedModel, validateConfig } from '../src/launch-state.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'claude-binding-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = { referenceRoot: resolve('../ai-agent-msg-broker'), stateRoot: directory, brokerUrl: 'https://broker.example.invalid', tokenFile: join(directory, 'not-a-real-token'), name: 'same-name', expectedCliVersion: '0.0.0' };
  const result = launchFiles({ config, runDirectory: join(directory, 'run'), adapterRoot: resolve('.') });
  writePrivateJson(join(directory, 'run', 'host.json'), processIdentity(process.pid));
  return { directory, run: join(directory, 'run'), config, ...result };
}

test('launch adds session ID and local hooks, no trust/permission/channel overrides', t => {
  const f = fixture(t), settings = readPrivateJson(join(f.run, 'settings.json')), mcp = readPrivateJson(join(f.run, 'mcp.json'));
  assert.equal(f.args[0], '--session-id'); assert.equal(f.args[1], f.launch.sessionId);
  assert(!JSON.stringify({ settings, args: f.args }).includes('skip-permissions'));
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].args[1], f.run);
  assert.equal(mcp.mcpServers.lan_broker.type, 'stdio'); assert(!JSON.stringify(mcp).includes('token='));
  assert.equal(verifyLaunch(f.run, f.launch), false, 'no native SessionStart yet');
});

test('native confirmation, PID/start identity, lifetime and model switching are exact', t => {
  const f = fixture(t); applyHook(f.run, { hook_event_name: 'SessionStart', session_id: f.launch.sessionId });
  assert.equal(verifyLaunch(f.run, f.launch), true); assert.equal(observedModel(f.run).source, 'unknown');
  applyHook(f.run, { hook_event_name: 'PostModelSwitch', session_id: f.launch.sessionId, to_model: 'observed-model' });
  assert.equal(observedModel(f.run).id, 'observed-model');
  assert.equal(verifyLaunch(f.run, { ...f.launch, lifetime: randomUUID() }), false);
  writePrivateJson(join(f.run, 'host.json'), { ...processIdentity(process.pid), start: '0' });
  assert.equal(verifyLaunch(f.run, f.launch), false, 'PID without exact start identity is insufficient');
});

test('different native session and SessionEnd close irrevocably', t => {
  const f = fixture(t); applyHook(f.run, { hook_event_name: 'SessionStart', session_id: f.launch.sessionId });
  applyHook(f.run, { hook_event_name: 'SessionStart', session_id: randomUUID() });
  applyHook(f.run, { hook_event_name: 'SessionStart', session_id: f.launch.sessionId });
  assert.equal(verifyLaunch(f.run, f.launch), false);
});

test('native pretool guard only denies wrong session/subagent; never approves yes', t => {
  const f = fixture(t); applyHook(f.run, { hook_event_name: 'SessionStart', session_id: f.launch.sessionId });
  const base = { hook_event_name: 'PreToolUse', session_id: f.launch.sessionId, tool_input: { text: 'yes abcde' } };
  assert.equal(applyHook(f.run, base), null);
  assert.equal(applyHook(f.run, { ...base, agent_id: 'subagent' }).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(applyHook(f.run, { ...base, session_id: randomUUID() }).hookSpecificOutput.permissionDecision, 'deny');
});

test('no permissions, model credential or arbitrary flags enter launch config', t => {
  const f = fixture(t);
  for (const change of [{ token: 'secret' }, { flags: ['--dangerously-skip-permissions'] }, { expectedCliVersion: '*' }, { tokenFile: 'relative' }]) {
    assert.throws(() => validateConfig({ ...f.config, ...change }));
  }
  chmodSync(join(f.run, 'launch.json'), 0o644); assert.throws(() => readPrivateJson(join(f.run, 'launch.json')));
});
