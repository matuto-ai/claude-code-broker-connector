import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readPrivateJson, writePrivateJson } from './launch-state.mjs';
import { monitorBudget } from './monitor-budget.mjs';
import { PRESENCE_NOTICE } from './presence-notices.mjs';

const sameOwner = (a, b) => a.sessionId === b.sessionId && a.lifetime === b.lifetime
  && a.host?.pid === b.host.pid && a.host?.start === b.host.start && a.host?.boot === b.host.boot;
const MESSAGE_NOTICE = 'Psst: authorized collaboration mailbox has pending AGENT data. Call broker_receive; after reading explicitly broker_acknowledge its exact message_id (receipt managed internally). No human permission or action completion is implied.';

// The host owns the monitor's notification channel. Only its trusted SessionStart
// authority may select a new epoch; no environment session hint or inbox is used.
export function createMonitorLifecycle({ hostAlive, resolve, isCurrent, emit,
  read = readPrivateJson, write = writePrivateJson, createBudget = monitorBudget,
  now = Date.now }) {
  let epoch = null;
  return { tick() {
    if (!hostAlive()) { epoch = null; return false; }
    try {
      const found = resolve();
      if (!found || !isCurrent(found)) { epoch = null; return true; }
      if (!epoch || epoch.directory !== found.directory || !sameOwner(epoch.binding, found.binding)) {
        const key = createHash('sha256').update(JSON.stringify([
          found.binding.sessionId, found.binding.lifetime, found.binding.host,
        ])).digest('hex');
        const budget = name => createBudget({
          path: join(found.directory, `${name}-${key}.json`),
          legacyPath: join(found.directory, `${name}.json`), binding: found.binding,
        });
        epoch = { ...found, messages: budget('message-notice-budget'), presence: budget('presence-notice-budget') };
      }
      const active = epoch;
      const current = () => hostAlive() && isCurrent(active);
      if (!current()) { epoch = null; return true; }
      const status = read(join(active.directory, 'notice.json'));
      const time = now();
      if (!sameOwner(status, active.binding) || !Number.isFinite(status.updated_at)
        || time - status.updated_at < 0 || time - status.updated_at >= 5000) return true;
      // Reserve before stdout, then fence again. A transition can discard a hint,
      // never transfer that hint, its budget, or the old mailbox to the new epoch.
      if (current() && active.messages.next(status, time) && current()) {
        emit(MESSAGE_NOTICE + (active.messages.snapshot.attention_required ? ' Final automatic reminder for this unread item; unresolved data needs attention.' : ''));
      }
      if (current() && active.presence.next({ connected: status.connected, pending_id: status.presence_event_id }, time) && current()) {
        emit(PRESENCE_NOTICE + (active.presence.snapshot.attention_required ? ' Final automatic reminder for this transport notice.' : ''));
      }
      if (current()) write(join(active.directory, 'monitor-state.json'), {
        sessionId: active.binding.sessionId, lifetime: active.binding.lifetime,
        pending_id: status.pending_id, ...active.messages.snapshot, updated_at: time,
      });
    } catch {
      // A missing/partial/corrupt authority or status is not a terminal monitor
      // exit. Remain silent and retry on the bounded local tick, without broker IO.
    }
    return true;
  } };
}
