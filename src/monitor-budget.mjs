import { readPrivateJson, writePrivateJson } from './launch-state.mjs';
import { noticeBudget } from './native-notices.mjs';
import { dirname, join } from 'node:path';
import { openSync, closeSync, fstatSync, constants } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Native reload may briefly overlap two monitor processes. Kernel-held locking
// serializes checkpoint reservations and is released automatically on a crash.
function withBudgetLock(path, operation) {
  const lockPath = join(dirname(path), '.message-notice-owner.sqlite');
  const fd = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw Error('private_monitor_lock_required');
  } finally { closeSync(fd); }
  let lock;
  try {
    lock = new DatabaseSync(lockPath);
    lock.exec('PRAGMA busy_timeout=25; BEGIN EXCLUSIVE;');
    return operation();
  } finally { lock?.close(); }
}

// A reminder reservation is private local state, never a delivery/read receipt.
// Save before stdout: an interrupted write must not mint another reminder.
export function monitorBudget({ path, binding, legacyPath, read = readPrivateJson, write = writePrivateJson }) {
  function load() {
    let saved;
    try { saved = read(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!legacyPath) return noticeBudget();
      // Preserve the current lifetime's pre-0.8 checkpoint without moving it.
      try { saved = read(legacyPath); } catch (legacyError) {
        if (legacyError.code === 'ENOENT') return noticeBudget();
        throw legacyError;
      }
    }
    if (!saved || typeof saved.sessionId !== 'string' || typeof saved.lifetime !== 'string'
      || !Number.isSafeInteger(saved.host?.pid) || typeof saved.host?.start !== 'string'
      || typeof saved.host?.boot !== 'string' || !saved.checkpoint) throw Error('invalid_monitor_budget');
    // Validate even a foreign checkpoint before treating it as a new lifetime.
    const previous = noticeBudget({ initialState: saved.checkpoint });
    const same = saved.sessionId === binding.sessionId && saved.lifetime === binding.lifetime
      && saved.host.pid === binding.host.pid && saved.host.start === binding.host.start && saved.host.boot === binding.host.boot;
    return same ? previous : noticeBudget();
  }
  let budget;
  try { budget = load(); } catch { /* Corrupt or unsafe state fails closed. */ }
  return {
    next(status, now = Date.now()) {
      if (!budget) return false;
      try {
        return withBudgetLock(path, () => {
          // Re-read under the lock: never reserve against a stale process copy.
          budget = load();
          if (!budget.next(status, now)) return false;
          write(path, { sessionId: binding.sessionId, lifetime: binding.lifetime, host: binding.host, checkpoint: budget.checkpoint });
          return true;
        });
      } catch (error) {
        // A brief competing reservation is retried on the ordinary monitor tick.
        if (error.errcode === 5 || error.errcode === 6) return false;
        // Do not reset or retry a failed reservation in this monitor process.
        budget = null;
        return false;
      }
    },
    get snapshot() {
      return budget ? budget.snapshot : { state: 'notice_budget_unavailable', attention_required: true, rate_limited: false, next_retry_at: null };
    },
  };
}
