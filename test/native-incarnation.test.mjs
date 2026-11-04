import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeIncarnation, registrationVersion } from '../src/native-incarnation.mjs';
import { Inbox, newSessionIdentity } from '../vendor/psst/reference/inbox.mjs';

const scope = { native: 'conversation', lifetime: 'lifetime', broker: 'broker', tokenFile: 'token', credential: 'credential' };

function fixture(t, version = 2) {
  const directory = mkdtempSync(join(tmpdir(), 'claude-incarnation-'));
  const owners = [];
  const open = (options = {}) => {
    const owner = new NativeIncarnation({ directory, scope, registrationVersion: version, ...options });
    owners.push(owner);
    return owner;
  };
  t.after(() => { for (const owner of owners) owner.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, open, owner: open() };
}

// The broker's authenticated expiry decision is an input to this connector.
// No server, network, registration protocol or native process is exercised here.
function expiredClient(owner) {
  return {
    inbox: owner.inbox,
    expiredIdentityConfirmed: true,
    createReplacementInbox: async ({ directory }) => new Inbox({ directory, identity: newSessionIdentity('claude-code') }),
  };
}

test('registration defaults to v1 and only confirmed current v2 ownership permits replacement', async t => {
  assert.equal(registrationVersion(), 1);
  assert.equal(registrationVersion({ registrationVersion: 2 }), 2);
  assert.throws(() => registrationVersion({ registrationVersion: 3 }), /invalid_registration_version/);
  const old = fixture(t, 1).owner;
  await assert.rejects(old.replace({ client: expiredClient(old), verifySession: () => true }), /session_mismatch/);
  const { owner } = fixture(t);
  for (const client of [
    { ...expiredClient(owner), expiredIdentityConfirmed: false },
    { ...expiredClient(owner), inbox: {} },
  ]) await assert.rejects(owner.replace({ client, verifySession: () => true }), /session_mismatch/);
  await assert.rejects(owner.replace({ client: expiredClient(owner), verifySession: () => false }), /session_mismatch/);
  assert.equal(owner.inbox, owner.root);
});

test('replacement selects an empty journal without migrating old operations and reload keeps its identity', async t => {
  const f = fixture(t), old = f.owner.inbox.identity;
  f.owner.root.setState('claim_pending', { key: 'old-uncertain-operation' });
  const fresh = await f.owner.replace({ client: expiredClient(f.owner), verifySession: () => true });
  assert.notEqual(fresh.identity.client_id, old.client_id);
  assert.equal(fresh.getState('claim_pending'), null);
  assert.deepEqual(f.owner.root.getState('claim_pending'), { key: 'old-uncertain-operation' });
  assert.throws(() => new Inbox({ directory: f.directory, identity: old }), error => error.code === 'owner_conflict');
  fresh.setState('registration_pending', { key: 'new-uncertain-operation' });
  const id = fresh.identity.client_id;
  f.owner.close();
  const reloaded = f.open();
  assert.equal(reloaded.inbox.identity.client_id, id);
  assert.deepEqual(reloaded.inbox.getState('registration_pending'), { key: 'new-uncertain-operation' });
  assert.deepEqual(reloaded.root.getState('claim_pending'), { key: 'old-uncertain-operation' });
});

test('changed native lifetime after creating a successor closes it and retains no selection', async t => {
  const f = fixture(t), client = expiredClient(f.owner);
  let checks = 0, fresh;
  const create = client.createReplacementInbox;
  client.createReplacementInbox = async args => (fresh = await create(args));
  await assert.rejects(f.owner.replace({ client, verifySession: () => ++checks === 1 }), /session_mismatch/);
  assert.equal(f.owner.closed, true);
  assert.equal(existsSync(join(f.directory, 'incarnation.json')), false);
  // Reopening both journals proves the failed transition released ownership.
  const retry = new Inbox({ directory: fresh.directory, identity: fresh.identity });
  retry.close();
  const reloaded = f.open();
  assert.equal(reloaded.inbox, reloaded.root);
});

test('failed selection persistence closes ownership instead of advertising an uncommitted successor', async t => {
  const f = fixture(t);
  mkdirSync(join(f.directory, 'incarnation.json'));
  await assert.rejects(f.owner.replace({ client: expiredClient(f.owner), verifySession: () => true }));
  assert.equal(f.owner.closed, true);
  rmSync(join(f.directory, 'incarnation.json'), { recursive: true });
  const reloaded = f.open();
  assert.equal(reloaded.inbox, reloaded.root);
});

test('selected but missing journal fails closed without reconstructing an empty database', async t => {
  const f = fixture(t);
  const fresh = await f.owner.replace({ client: expiredClient(f.owner), verifySession: () => true });
  const database = join(fresh.directory, 'inbox.sqlite');
  f.owner.close();
  renameSync(database, database + '.preserved');
  assert.throws(() => f.open());
  assert.equal(existsSync(database), false);
});

test('saved selection rejects changed scope or protocol and releases its lock on failure', async t => {
  const f = fixture(t);
  const fresh = await f.owner.replace({ client: expiredClient(f.owner), verifySession: () => true });
  f.owner.close();
  assert.throws(() => f.open({ registrationVersion: 1 }), /incarnation_mismatch/);
  assert.throws(() => f.open({ scope: { ...scope, native: 'other' } }), /incarnation_mismatch/);
  assert.equal(f.open().inbox.directory, fresh.directory);
});

test('held owner rejects changed selection and cannot be reused after close', async t => {
  const f = fixture(t), selected = { directory: f.directory, scope, registrationVersion: 2 };
  f.owner.assertSelection(selected);
  for (const key of Object.keys(scope)) assert.throws(() => f.owner.assertSelection({ ...selected, scope: { ...scope, [key]: 'different' } }), /incarnation_mismatch/);
  assert.throws(() => f.owner.assertSelection({ ...selected, directory: f.directory + '-other' }), /incarnation_mismatch/);
  assert.throws(() => f.owner.assertSelection({ ...selected, registrationVersion: 1 }), /incarnation_mismatch/);
  f.owner.close();
  f.owner.close();
  assert.throws(() => f.owner.assertSelection(selected), /incarnation_mismatch/);
  await assert.rejects(f.owner.replace({ client: expiredClient(f.owner), verifySession: () => true }), /session_mismatch/);
});
