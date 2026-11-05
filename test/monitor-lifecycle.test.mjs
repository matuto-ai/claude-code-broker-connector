import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMonitorLifecycle } from '../src/monitor-lifecycle.mjs';
import { processIdentity, readPrivateJson, writePrivateJson } from '../src/launch-state.mjs';
import { nativeStateConfig, pluginHook, hostDirectory } from '../src/plugin-state.mjs';
import { resolveNativeBinding, associateNativeBinding, isNativeBindingCurrent } from '../src/native-binding.mjs';
import { monitorBudget } from '../src/monitor-budget.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'psst-monitor-transition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const host = processIdentity(process.pid), nativeConfig = { stateRoot: root };
  const directory = hostDirectory(nativeConfig, host).directory;
  let time = 1000, alive = true;
  const output = [];
  const resolve = () => {
    const found = resolveNativeBinding({ nativeConfig, host, legacyConfig: null });
    return found ? { ...found, nativeConfig } : null;
  };
  const start = (sessionId = randomUUID(), commit = true) => {
    pluginHook(nativeConfig, { hook_event_name: 'SessionStart', session_id: sessionId }, host);
    if (commit) associateNativeBinding({ nativeConfig, host, sessionId });
    return sessionId;
  };
  const notice = (pending_id = 'message', presence_event_id = null) => {
    const { binding } = resolve();
    writePrivateJson(join(directory, 'notice.json'), { ...binding, connected: true, pending_id, presence_event_id, updated_at: time });
  };
  const options = { hostAlive: () => alive, resolve, isCurrent: isNativeBindingCurrent,
    emit: text => output.push(text), now: () => time };
  return { root, host, nativeConfig, directory, output, start, notice, resolve, options,
    advance: n => { time += n; }, depart: () => { alive = false; } };
}

test('real SessionStart authority permits delayed startup and A → gap → B without monitor restart', t => {
  const f = fixture(t), monitor = createMonitorLifecycle(f.options);
  assert.equal(monitor.tick(), true); assert.deepEqual(f.output, []);
  const a = f.start(); f.notice('a-head'); monitor.tick();
  assert.equal(f.output.length, 1);
  const old = readPrivateJson(join(f.directory, 'monitor-state.json'));
  pluginHook(f.nativeConfig, { hook_event_name: 'SessionEnd', session_id: a }, f.host);
  assert.equal(monitor.tick(), true); assert.equal(f.output.length, 1);
  const b = f.start(undefined, false); monitor.tick();
  assert.equal(f.output.length, 1, 'partial authority does not admit B');
  associateNativeBinding({ nativeConfig: f.nativeConfig, host: f.host, sessionId: b });
  monitor.tick(); assert.equal(f.output.length, 1, 'old A status never emits for B');
  assert.deepEqual(readPrivateJson(join(f.directory, 'monitor-state.json')), old);
  f.notice('b-head'); monitor.tick(); assert.equal(f.output.length, 2);
  const current = readPrivateJson(join(f.directory, 'monitor-state.json'));
  assert.equal(current.sessionId, b); assert.notEqual(current.lifetime, old.lifetime);
  assert.equal(current.attempts, 1, 'B starts its own budget, not A mailbox state');
  f.depart(); assert.equal(monitor.tick(), false);
});

test('same-session restart/compact and overlapping monitors retain bounded message and presence reservations', t => {
  const f = fixture(t), a = f.start(); f.notice('head', 'presence');
  const first = createMonitorLifecycle(f.options); first.tick(); assert.equal(f.output.length, 2);
  f.start(a); const second = createMonitorLifecycle(f.options);
  second.tick(); first.tick(); assert.equal(f.output.length, 2);
  for (const elapsed of [30000, 90000, 90000]) {
    f.advance(elapsed); f.notice('head', 'presence'); second.tick(); first.tick();
  }
  assert.equal(f.output.length, 6, 'three notices of each kind across both instances');
});

test('transition during reservation fences stdout and monitor observation', t => {
  const f = fixture(t); f.start(); f.notice();
  let switched = false;
  const monitor = createMonitorLifecycle({ ...f.options, createBudget(options) {
    const budget = monitorBudget(options);
    return { next(status, now) {
      const result = budget.next(status, now);
      if (!switched) { switched = true; f.start(); }
      return result;
    }, get snapshot() { return budget.snapshot; } };
  } });
  monitor.tick(); assert.equal(f.output.length, 0);
  assert.throws(() => readPrivateJson(join(f.directory, 'monitor-state.json')), { code: 'ENOENT' });
  f.notice('new'); monitor.tick(); assert.equal(f.output.length, 1);
});

test('corrupt authority, stale/future status and missing status never announce readiness; recover without exit', t => {
  const f = fixture(t); const a = f.start(), monitor = createMonitorLifecycle(f.options);
  assert.equal(monitor.tick(), true);
  f.notice(); f.advance(5000); monitor.tick(); assert.equal(f.output.length, 0);
  f.notice(); f.advance(-1); monitor.tick(); assert.equal(f.output.length, 0);
  writeFileSync(join(f.directory, 'native-authority.json'), '{broken', { mode: 0o600 });
  assert.equal(monitor.tick(), true); assert.equal(f.output.length, 0);
  associateNativeBinding({ nativeConfig: f.nativeConfig, host: f.host, sessionId: a });
  f.notice(); monitor.tick(); assert.equal(f.output.length, 1);
});

test('failed checkpoint remains blocked for the current epoch, without losing or reading inbox data', t => {
  const f = fixture(t); f.start(); f.notice();
  const monitor = createMonitorLifecycle({ ...f.options, createBudget: options => monitorBudget({ ...options, write() { throw Error('disk_failure'); } }) });
  monitor.tick(); monitor.tick(); assert.equal(f.output.length, 0);
  assert.equal(readPrivateJson(join(f.directory, 'monitor-state.json')).state, 'notice_budget_unavailable');
});

test('host-scoped root lookup ignores stale startup session only when resolving verified current ownership', t => {
  const root = mkdtempSync(join(tmpdir(), 'psst-monitor-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const host = processIdentity(process.pid), sessionId = randomUUID();
  const env = { HOME: root, CLAUDE_CONFIG_DIR: join(root, 'config'), CLAUDE_CODE_SESSION_ID: 'stale-startup' };
  const legacy = { stateRoot: join(root, '.config', 'psst', 'native') };
  pluginHook(legacy, { hook_event_name: 'SessionStart', session_id: sessionId }, host);
  associateNativeBinding({ nativeConfig: legacy, host, sessionId });
  assert.notEqual(nativeStateConfig(env, host).stateRoot, legacy.stateRoot);
  const current = nativeStateConfig(env, host, null);
  assert.equal(current.stateRoot, legacy.stateRoot);
  assert.equal(resolveNativeBinding({ nativeConfig: current, host }).binding.sessionId, sessionId);
});

test('upgrade reuses existing same-lifetime checkpoint, never mutating or resetting it', t => {
  const f = fixture(t); f.start(); f.notice('head');
  const legacyPath = join(f.directory, 'message-notice-budget.json');
  const old = monitorBudget({ path: legacyPath, binding: f.resolve().binding });
  assert.equal(old.next({ connected: true, pending_id: 'head' }, 1000), true);
  const before = readPrivateJson(legacyPath);
  const monitor = createMonitorLifecycle(f.options); monitor.tick(); assert.equal(f.output.length, 0);
  f.advance(30000); f.notice('head'); monitor.tick(); assert.equal(f.output.length, 1);
  assert.deepEqual(readPrivateJson(legacyPath), before);
  const restarted = createMonitorLifecycle(f.options); restarted.tick(); assert.equal(f.output.length, 1);
});
