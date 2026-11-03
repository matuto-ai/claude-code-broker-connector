import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { monitorBudget } from '../src/monitor-budget.mjs';
import { readPrivateJson, writePrivateJson, processIdentity } from '../src/launch-state.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'psst-message-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'message-notice-budget.json');
  const binding = { sessionId: randomUUID(), lifetime: randomUUID(), host: processIdentity(process.pid) };
  return { path, binding, start: () => monitorBudget({ path, binding }) };
}

test('message reservations survive restarts and reserve before emitting without changing inbox status', t => {
  const x = fixture(t), status = { connected: true, pending_id: 'private-message' }, before = structuredClone(status);
  let b = x.start();
  assert.equal(b.next(status, 100), true);
  assert.equal(readPrivateJson(x.path).checkpoint.attempts, 1);
  assert.equal(statSync(x.path).mode & 0o777, 0o600);
  b = x.start(); assert.equal(b.next(status, 101), false);
  assert.equal(b.next(status, 30100), true);
  b = x.start(); assert.equal(b.next(status, 120099), false);
  assert.equal(b.next(status, 120100), true);
  b = x.start(); assert.equal(b.next(status, 1e9), false);
  assert.equal(b.snapshot.attention_required, true);
  assert.equal(b.next({ ...status, connected: false }, 1e9), false);
  b = x.start(); assert.equal(b.next(status, 1e9), false, 'reconnect/restart cannot reset an exhausted head');
  assert.equal(b.next({ ...status, pending_id: 'another-message' }, 1e9), true);
  assert.deepEqual(status, before, 'neither observation nor reservation reads or ACKs the message');
});

test('rolling message rate limit survives a restart between every distinct head', t => {
  const x = fixture(t);
  for (let i = 0; i < 30; i++) assert.equal(x.start().next({ connected: true, pending_id: `message-${i}` }, i), true);
  const b = x.start();
  assert.equal(b.next({ connected: true, pending_id: 'next' }, 30), false);
  assert.equal(b.snapshot.rate_limited, true);
  assert.equal(b.snapshot.next_retry_at, 600000);
  assert.equal(x.start().next({ connected: true, pending_id: 'next' }, 600000), true);
});

test('overlapping monitors cannot reserve against stale in-memory attempts', t => {
  const x = fixture(t), status = { connected: true, pending_id: 'same-message' };
  const monitors = [x.start(), x.start()];
  for (const time of [0, 30000, 120000]) {
    assert.equal(monitors.filter(b => b.next(status, time)).length, 1);
  }
  assert.equal(readPrivateJson(x.path).checkpoint.attempts, 3);
  assert.equal(monitors.some(b => b.next(status, 1e9)), false);
});

test('separate processes serialize message reservations and a killed lock owner cannot strand them', { timeout: 10000 }, async t => {
  const x = fixture(t), module = new URL('../src/monitor-budget.mjs', import.meta.url).href;
  const run = source => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let output = '', error = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => error += data);
    const ended = new Promise(resolve => child.once('exit', code => resolve({ code, output, error })));
    return { child, ended };
  };
  const source = `import { monitorBudget } from ${JSON.stringify(module)}; const b=monitorBudget(${JSON.stringify({path:x.path,binding:x.binding})}); console.log(b.next({connected:true,pending_id:'same-message'},100));`;
  const results = await Promise.all(Array.from({ length: 12 }, () => run(source).ended));
  assert(results.every(r => r.code === 0), JSON.stringify(results));
  assert.equal(results.filter(r => r.output.trim() === 'true').length, 1);
  assert.equal(readPrivateJson(x.path).checkpoint.attempts, 1);
  const owner = run(`import { DatabaseSync } from 'node:sqlite'; const lock=new DatabaseSync(${JSON.stringify(join(x.path, '..', '.message-notice-owner.sqlite'))}); lock.exec('BEGIN EXCLUSIVE'); console.log('locked'); setInterval(()=>{},1000);`);
  await new Promise((resolve, reject) => { owner.child.stdout.once('data', resolve); owner.child.once('exit', () => reject(Error('lock owner exited before ready'))); });
  const b = x.start();
  assert.equal(b.next({ connected: true, pending_id: 'same-message' }, 30100), false);
  assert.notEqual(b.snapshot.state, 'notice_budget_unavailable', 'lock contention is recoverable');
  owner.child.kill('SIGKILL'); await owner.ended;
  assert.equal(b.next({ connected: true, pending_id: 'same-message' }, 30100), true);
  assert.equal(readPrivateJson(x.path).checkpoint.attempts, 2);
});

test('all native owner fields fence valid checkpoint reuse', t => {
  const x = fixture(t), status = { connected: true, pending_id: 'private-message' };
  assert(x.start().next(status, 100));
  const saved = readPrivateJson(x.path);
  const alternatives = [
    { ...x.binding, sessionId: randomUUID() },
    { ...x.binding, lifetime: randomUUID() },
    ...['pid', 'start', 'boot'].map(key => ({ ...x.binding, host: { ...x.binding.host, [key]: key === 'pid' ? x.binding.host.pid + 1 : 'different' } })),
  ];
  for (const binding of alternatives) {
    writePrivateJson(x.path, saved);
    assert(monitorBudget({ path: x.path, binding }).next(status, 101));
    assert.equal(readPrivateJson(x.path).checkpoint.attempts, 1);
  }
});

test('corrupt, unsafe or malformed checkpoint fails closed without overwriting evidence', t => {
  const x = fixture(t), status = { connected: true, pending_id: 'private-message' };
  assert(x.start().next(status, 100));
  const saved = readPrivateJson(x.path);
  for (const content of ['{broken', JSON.stringify({ ...saved, checkpoint: { ...saved.checkpoint, attempts: -1 } }), JSON.stringify({ checkpoint: saved.checkpoint })]) {
    writeFileSync(x.path, content);
    const b = x.start();
    assert.equal(b.next(status, 1e9), false);
    assert.equal(b.snapshot.state, 'notice_budget_unavailable');
    assert.equal(readFileSync(x.path, 'utf8'), content);
  }
  writePrivateJson(x.path, saved); chmodSync(x.path, 0o644);
  const unsafe = x.start();
  assert.equal(unsafe.next(status, 1e9), false);
  assert.equal(unsafe.snapshot.state, 'notice_budget_unavailable');
  assert.equal(statSync(x.path).mode & 0o777, 0o644, 'never silently repair permissions');
});

test('failed checkpoint reservation suppresses stdout permission and remains blocked', t => {
  const x = fixture(t); let writes = 0;
  const b = monitorBudget({ ...x, write() { writes++; throw Error('private path must not escape'); } });
  assert.equal(b.next({ connected: true, pending_id: 'one' }, 0), false);
  assert.equal(b.next({ connected: true, pending_id: 'two' }, 1e9), false);
  assert.equal(writes, 1);
  assert.equal(b.snapshot.state, 'notice_budget_unavailable');
  assert.doesNotMatch(JSON.stringify(b.snapshot), /private path/);
});
