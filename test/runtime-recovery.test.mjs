import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
// Psst candidate 92f84f1 regression checks, with only vendor import paths adapted.
import { Inbox, newSessionIdentity } from '../vendor/psst/reference/inbox.mjs';
import { AdapterRuntime } from '../vendor/psst/reference/runtime.mjs';
import { BrokerClient, BrokerError } from '../vendor/psst/reference/client.mjs';
import { LocalError } from '../vendor/psst/reference/errors.mjs';

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const failure = () => new LocalError('request_failed', { effect: 'unknown', retryable: true });
const stale = () => new BrokerError(409, { error: { code: 'stale_lease_epoch', effect: 'not_applied' } });
function clock() {
  let time = Date.now(); const timers = new Set();
  return { now: () => time,
    sleep(ms, _, { signal }) { return new Promise((resolve, reject) => {
      const timer = { at: time + ms, done() { timers.delete(timer); signal.removeEventListener('abort', abort); resolve(); } };
      const abort = () => { timers.delete(timer); reject(new LocalError('request_aborted')); };
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true }); timers.add(timer);
    }); },
    async advance(ms) { time += ms; for (const timer of [...timers]) if (timer.at <= time) timer.done(); await flush(); },
  };
}
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-recovery-')), time = clock();
  const inbox = new Inbox({ directory, identity: newSessionIdentity('opencode'), now: time.now });
  const calls = [], health = [], diagnostics = []; let poll;
  const client = { inbox, attachment: { lease_epoch: 0 }, policy: { heartbeat_seconds: 60 }, now: time.now,
    registrationVersion: 2, serverNow: time.now, online: true, stale: false, failures: 0,
    async register() { calls.push('register'); this.attachment.lease_epoch = 1; },
    async heartbeat() { calls.push('heartbeat'); if (!this.online) throw failure(); if (this.stale) throw stale(); },
    async reconnect({ verifySession }) { calls.push('reconnect'); assert.equal(await verifySession(inbox.identity), true);
      if (this.failures-- > 0) throw failure(); this.stale = false; this.attachment.lease_epoch++; },
    async claim(_, { signal }) { calls.push('claim'); return new Promise((resolve, reject) => {
      const abort = () => reject(new LocalError('request_aborted'));
      signal.addEventListener('abort', abort, { once: true });
      poll = { resolve: value => { signal.removeEventListener('abort', abort); resolve(value); }, reject: error => { signal.removeEventListener('abort', abort); reject(error); } };
      if (signal.aborted) abort();
    }); },
    async complete(id, result) { assert.ok(inbox.head()); calls.push(['complete', id, result]); },
    async closeSession() { calls.push('close'); },
  };
  const runtime = new AdapterRuntime({ client, verifySession: () => true, isAlive: () => true,
    sleep: time.sleep, random: () => 0.5, onHealthChange: value => health.push(value), onDiagnostic: value => diagnostics.push(value) });
  t.after(async () => { await runtime.stop(); inbox.close(); rmSync(directory, { recursive: true, force: true }); });
  await runtime.start({}); await flush();
  return { runtime, client, inbox, calls, health, diagnostics, time, poll: () => poll };
}

test('outage stays supervised, exhausted reconciliation round retries later and stores once in the same inbox', async t => {
  const f = await fixture(t), id = f.inbox.identity.client_id;
  const key = f.inbox.prepareSend({ recipient_id: randomUUID(), content: { type: 'text/plain', text: 'pending' } });
  f.inbox.markOutgoingAttempt(key); const outgoing = f.inbox.outgoing(key);
  f.client.online = false; f.poll().reject(failure()); await flush();
  for (let i = 0; i < 5; i++) await f.time.advance(60000);
  assert.equal(f.calls.filter(x => x === 'register').length, 1);
  assert.equal(f.calls.filter(x => x === 'claim').length, 1);
  assert.equal(f.calls.filter(x => x === 'reconnect').length, 0);
  assert.equal(f.diagnostics.length, 1, 'steady outages do not flood diagnostics');
  f.client.online = true; f.client.stale = true; f.client.failures = 3;
  await f.time.advance(60000); await f.time.advance(1000); await f.time.advance(2000);
  assert.equal(f.calls.filter(x => x === 'reconnect').length, 3);
  assert.equal(f.runtime.status().recovery, 'retry_waiting');
  await f.runtime.heartbeatOnce().catch(error => f.runtime.handleTransportError(error, f.runtime.controller.signal, { ownedSessionOperation: true, heartbeat: true }));
  assert.equal(f.calls.filter(x => x === 'reconnect').length, 3, 'round cooldown is respected');
  await f.time.advance(60000); await f.time.advance(1000);
  assert.equal(f.calls.filter(x => x === 'reconnect').length, 4);
  const now = f.time.now(), envelope = { protocol_version: '1', message_id: randomUUID(), recipient_id: id, recipient_sequence: 1,
    sender: { client_id: randomUUID(), client_type: 'pi', name: 'peer', model: { provider: null, id: null, source: 'unknown' }, project: null, metadata_revision: 1 },
    origin: 'broker_agent', authority: 'untrusted_agent_input', content: { type: 'text/plain', text: 'queued during outage' },
    accepted_at: new Date(now).toISOString(), expires_at: new Date(now + 86400000).toISOString(), correlation_id: null, reply_to_message_id: null };
  f.poll().resolve({ claim_id: randomUUID(), lease_epoch: f.client.attachment.lease_epoch, attempt: 1, claim_expires_at: new Date(now + 30000).toISOString(), envelope }); await flush();
  assert.equal(f.inbox.identity.client_id, id); assert.equal(f.inbox.head().message_id, envelope.message_id);
  assert.equal(f.inbox.head().state, 'pending'); assert.equal(f.inbox.db.prepare('SELECT count(*) n FROM inbox').get().n, 1);
  assert.deepEqual(f.inbox.outgoing(key), outgoing);
  assert.equal(f.calls.filter(x => Array.isArray(x)).length, 1);
  assert.equal(f.runtime.status().reception, 'healthy'); assert.equal(f.runtime.status().error_code, null);
});

test('healthy heartbeat restarts only the failed receiver, preserves its claim key, and does not mistake long polls for stalls', async t => {
  const f = await fixture(t), pending = { key: randomUUID(), lease_epoch: 1 };
  f.inbox.setState('claim_pending', pending);
  for (let i = 0; i < 4; i++) await f.time.advance(60000);
  assert.equal(f.calls.filter(x => x === 'reconnect').length, 0);
  assert.equal(f.calls.filter(x => x === 'claim').length, 1);
  f.poll().reject(failure()); await flush(); await f.time.advance(60000); await f.time.advance(1000);
  assert.equal(f.calls.filter(x => x === 'claim').length, 2);
  assert.equal(f.calls.filter(x => x === 'reconnect').length, 0);
  assert.deepEqual(f.inbox.getState('claim_pending'), pending);
  assert.equal(f.runtime.status().error_code, 'request_failed', 'heartbeat is not proof of reception');
  f.poll().resolve(null); await flush();
  assert.equal(f.runtime.status().reception, 'healthy'); assert.equal(f.runtime.status().error_code, null);
});

test('manual pauses, permanent protocol/security/storage errors and stopped lifetimes cannot be healed automatically', async t => {
  const f = await fixture(t); f.runtime.pauseReceiving(); await flush();
  await f.time.advance(60000); assert.equal(f.runtime.status().reception, 'paused');
  assert.equal(f.calls.filter(x => x === 'claim').length, 1);
  f.runtime.pauseReceiving(false); await f.time.advance(1000);
  assert.equal(f.calls.filter(x => x === 'claim').length, 2);
  for (const code of ['unauthenticated', 'forbidden', 'session_expired', 'session_mismatch', 'invalid_response', 'storage_unavailable', 'inbox_corrupt']) {
    const g = await fixture(t); g.poll().reject(new LocalError(code, { effect: 'unknown', retryable: true })); await flush();
    assert.equal(g.runtime.status().reception, 'blocked'); g.runtime.pauseReceiving(false); await g.time.advance(600000);
    assert.equal(g.calls.filter(x => x === 'claim').length, 1); assert.equal(g.calls.includes('reconnect'), false);
  }
  await f.runtime.stop(); const count = f.calls.length; await f.time.advance(600000); assert.equal(f.calls.length, count);
});

test('sender-only lease recovery does not wait forever for a disabled mailbox poll', async t => {
  const f = await fixture(t); f.runtime.receiveEnabled = false; f.client.stale = true;
  await f.time.advance(60000);
  assert.equal(f.runtime.status().reception, 'disabled'); assert.equal(f.runtime.status().recovery, 'idle');
  assert.equal(f.runtime.status().error_code, null); assert.equal(f.client.attachment.lease_epoch, 2);
});

test('a successful mailbox response is not allowed to disguise a malformed value as an empty poll', async t => {
  for (const value of [false, 0, '', {}, { claim_id: randomUUID() }]) {
    const f = await fixture(t); f.poll().resolve(value); await flush();
    assert.equal(f.runtime.status().reception, 'blocked'); assert.equal(f.runtime.status().error_code, 'invalid_response');
    assert.equal(f.calls.some(Array.isArray), false);
  }
});

test('overlapping stale heartbeat and claim failures serialize reconciliation; shutdown drains the final owned epoch', async t => {
  const f = await fixture(t); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  f.client.reconnect = async () => { f.calls.push('reconnect'); entered(); await new Promise(resolve => { release = resolve; }); f.client.attachment.lease_epoch = 2; };
  f.client.stale = true; f.poll().reject(stale()); await ready;
  const beat = f.runtime.heartbeatOnce().catch(error => f.runtime.handleTransportError(error, f.runtime.controller.signal, { ownedSessionOperation: true, heartbeat: true }));
  await flush(); assert.equal(f.calls.filter(x => x === 'reconnect').length, 1);
  const stop = f.runtime.stop(); release(); await Promise.all([beat, stop]);
  assert.equal(f.client.attachment.lease_epoch, 2); assert.equal(f.calls.filter(x => x === 'close').length, 1);
  assert.equal(f.runtime.status().reception, 'stopped');
});

test('non-protocol 502/503/504 are transient, malformed success and security responses remain strict', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'gateway-recovery-'));
  const inbox = new Inbox({ directory, identity: newSessionIdentity('opencode') });
  let status = 502, type = 'text/html', body = '<h1>Proxy unavailable</h1>';
  const server = createServer((_, response) => { response.writeHead(status, { 'Content-Type': type }); response.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); inbox.close(); rmSync(directory, { recursive: true, force: true }); delete process.env.PSST_RECOVERY_TEST_TOKEN; });
  process.env.PSST_RECOVERY_TEST_TOKEN = 'a'.repeat(43);
  const client = new BrokerClient({ url: `http://127.0.0.1:${server.address().port}`, insecureDevelopment: true, inbox, tokenEnvironment: 'PSST_RECOVERY_TEST_TOKEN', maxAttempts: 1 });
  for (status of [502, 503, 504]) for (const json of [false, true]) {
    type = json ? 'application/json' : 'text/html'; body = json ? '{"message":"Bad Gateway"}' : '<h1>Proxy unavailable</h1>';
    await assert.rejects(client.request('GET', '/v1/clients', { session: false }), { code: 'request_failed' });
  }
  status = 200; type = 'text/html'; await assert.rejects(client.request('GET', '/v1/clients', { session: false }), { code: 'invalid_response' });
  type = 'application/json'; body = '{broken'; await assert.rejects(client.request('GET', '/v1/clients', { session: false }), { code: 'invalid_response' });
  status = 503; body = '{"error":{"code":"unauthenticated","effect":"not_applied"}}';
  await assert.rejects(client.request('GET', '/v1/clients', { session: false }), { code: 'unauthenticated' });
});
