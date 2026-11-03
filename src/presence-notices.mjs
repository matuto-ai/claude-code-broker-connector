import { randomUUID } from 'node:crypto';
import { validateUuid } from '../vendor/psst/src/protocol.mjs';
import { LocalError } from '../vendor/psst/reference/errors.mjs';

const PAGE_SIZE = 10, MAX_PAGES = 26, MAX_RECORDS = 256, POLL_MS = 60000;
export const PRESENCE_NOTICE = 'Psst transport notice available: a recipient has prolonged offline pending delivery. Call broker_presence_events, then explicitly acknowledge only the event_id you read with broker_acknowledge_presence_event. This is not an agent message, reply timeout or proof of non-receipt. Do not automatically resend, cancel or close anything.';
const invalid = () => new LocalError('invalid_response', { effect: 'unknown' });

/** Only bounded transport metadata crosses the model boundary. */
export function presenceEvent(value) {
  if (value?.type !== 'recipient_offline' || value.presence_state !== 'disconnected'
    || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 10
    || typeof value.has_more_messages !== 'boolean') throw invalid();
  const uuid = value => { try { return validateUuid(value); } catch { throw invalid(); } };
  const result = { event_id: uuid(value.event_id), recipient_id: uuid(value.recipient_id), type: 'recipient_offline', presence_state: 'disconnected' };
  for (const key of ['last_heartbeat_at', 'created_at', 'observed_at']) {
    if (typeof value[key] !== 'string' || value[key].length > 40 || !Number.isFinite(Date.parse(value[key]))) throw invalid();
    result[key] = new Date(value[key]).toISOString();
  }
  result.messages = value.messages.map(message => {
    if (!['queued', 'claimed'].includes(message?.delivery_state) || typeof message.delivery_uncertain !== 'boolean') throw invalid();
    return { message_id: uuid(message.message_id), delivery_state: message.delivery_state, delivery_uncertain: message.delivery_uncertain };
  });
  result.has_more_messages = value.has_more_messages;
  return result;
}

export function readablePresence(result) {
  if (result?.error || !Array.isArray(result?.events) || !result.events.length) return null;
  if (result.events.length > PAGE_SIZE) throw invalid();
  const clean = { events: result.events.map(presenceEvent), has_more: result.has_more === true,
    capacity_limited: result.capacity_limited === true, supported: result.supported === true };
  return { content: [{ type: 'text', text: 'Psst · transport notice\nA recipient was disconnected with pending delivery at the observation time. This is not an agent instruction, reply timeout, or proof that a message was not received. Current state may have changed. No automatic resend, cancel or close was performed.\n'
    + clean.events.map(event => JSON.stringify(event)).join('\n')
    + '\nAfter reading, explicitly acknowledge each exact event_id with broker_acknowledge_presence_event. Message read receipts are unchanged.' }], structuredContent: clean, isError: false };
}

/** Separate durable transport journal. Only explicit ACK intent retires notices;
 * monitor stdout and MCP result delivery never acknowledge them. */
export class PresenceNotices {
  constructor({ client, inbox, isAlive, signal, diagnostic = () => {}, now = Date.now }) {
    Object.assign(this, { client, inbox, isAlive, signal, diagnostic, now });
    this.stopped = false; this.running = null; this.due = 0; this.refreshedAt = null;
    this.controller = new AbortController();
    inbox.transaction(() => inbox.db.exec(`CREATE TABLE IF NOT EXISTS native_presence_events(
      event_id TEXT PRIMARY KEY, content TEXT NOT NULL, state TEXT NOT NULL,
      exposed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, scan_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_presence_scan(
        id INTEGER PRIMARY KEY CHECK(id=1), cursor TEXT, scan_id TEXT NOT NULL,
        capacity_limited INTEGER NOT NULL DEFAULT 0)`));
    inbox.transaction(() => inbox.db.prepare('INSERT OR IGNORE INTO native_presence_scan(id,cursor,scan_id) VALUES(1,NULL,?)').run(randomUUID()));
  }
  active() { return !this.stopped && !this.signal?.aborted && this.isAlive(); }
  supported() { return this.client.policy?.presence_events === true; }
  async stop() { this.stopped = true; this.controller.abort(); await this.running?.catch(() => {}); }
  async tick() {
    if (this.now() < this.due) return;
    this.due = this.now() + POLL_MS;
    try { await this.refresh(); } catch { if (this.active()) this.diagnostic({ code: 'presence_notice_pending' }); }
  }
  pendingId() {
    if (!this.active() || !this.supported() || this.refreshedAt === null || this.now() - this.refreshedAt > 90000) return null;
    return this.inbox.db.prepare("SELECT event_id FROM native_presence_events WHERE state='pending' ORDER BY created,event_id LIMIT 1").get()?.event_id ?? null;
  }
  refresh() {
    if (this.running) return this.running;
    if (!this.active() || !this.supported()) return Promise.resolve();
    this.running = this.poll().finally(() => { this.running = null; });
    return this.running;
  }
  async poll() {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(5000), ...(this.signal ? [this.signal] : [])]);
    // Durable ACK intents are retried even when a lost response removed the event
    // from future pages. No pending event is automatically acknowledged.
    const intents = this.inbox.db.prepare("SELECT event_id FROM native_presence_events WHERE state='ack_requested' ORDER BY created,event_id LIMIT 10").all();
    for (const row of intents) {
      if (!this.active() || signal.aborted) throw new LocalError('request_aborted', { effect: 'unknown', retryable: true });
      let receipt;
      try { receipt = await this.client.acknowledgePresenceEvent(row.event_id, { signal }); }
      catch (error) {
        if (error.status !== 404 || error.code !== 'message_not_found') throw error;
        receipt = { event_id: row.event_id, acknowledged: true };
      }
      if (!this.active() || signal.aborted) throw new LocalError('request_aborted', { effect: 'unknown', retryable: true });
      if (receipt?.event_id !== row.event_id || receipt.acknowledged !== true) throw invalid();
      this.inbox.transaction(() => this.inbox.db.prepare("UPDATE native_presence_events SET state='acked' WHERE event_id=?").run(row.event_id));
    }
    // Empty broker pages may still have continuation. Retain one bounded scan
    // across refreshes/restart instead of repeating an unproductive prefix.
    const scan = this.inbox.db.prepare('SELECT cursor,scan_id,capacity_limited FROM native_presence_scan WHERE id=1').get();
    let cursor = scan.cursor, brokerLimited = scan.capacity_limited === 1;
    let locallyLimited = false;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      if (!this.active() || signal.aborted) throw new LocalError('request_aborted', { effect: 'unknown', retryable: true });
      const page = await this.client.presenceEvents({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }, { signal });
      if (!this.active() || signal.aborted) throw new LocalError('request_aborted', { effect: 'unknown', retryable: true });
      if (!Array.isArray(page?.events) || page.events.length > PAGE_SIZE || Buffer.byteLength(JSON.stringify(page)) > 65536
        || page.next_cursor != null && (typeof page.next_cursor !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(page.next_cursor)
          || !Number.isSafeInteger(Number(page.next_cursor)) || Number(page.next_cursor) <= Number(cursor ?? 0))) throw invalid();
      const events = page.events.map(presenceEvent);
      brokerLimited ||= page.capacity_limited === true;
      cursor = page.next_cursor ?? null;
      // Checkpoint each validated page. A slow/erroring later page must not force
      // every bounded retry to rescan the same prefix forever.
      locallyLimited = this.savePage(events, { cursor, scanId: scan.scan_id, brokerLimited }) || locallyLimited;
      this.limited = locallyLimited || brokerLimited || cursor !== null;
      this.refreshedAt = this.now();
      if (cursor === null) break;
    }
  }
  savePage(events, { cursor, scanId, brokerLimited }) {
    let limited = false;
    this.inbox.transaction(() => {
      // Only a complete traversal proves an old notice obsolete. Record the
      // entire traversal's seen IDs so a resumed suffix cannot prune its prefix.
      for (const event of events) this.inbox.db.prepare('UPDATE native_presence_events SET scan_id=? WHERE event_id=?').run(scanId, event.event_id);
      if (cursor === null && !brokerLimited) this.inbox.db.prepare("DELETE FROM native_presence_events WHERE state='pending' AND scan_id<>?").run(scanId);
      for (const event of events) {
        const old = this.inbox.db.prepare('SELECT state FROM native_presence_events WHERE event_id=?').get(event.event_id);
        if (old?.state === 'pending') this.inbox.db.prepare('UPDATE native_presence_events SET content=? WHERE event_id=?').run(JSON.stringify(event), event.event_id);
        else if (!old) {
          this.inbox.db.prepare("DELETE FROM native_presence_events WHERE event_id IN (SELECT event_id FROM native_presence_events WHERE state='acked' ORDER BY created,event_id LIMIT MAX(0,(SELECT COUNT(*) FROM native_presence_events)-255))").run();
          if (this.inbox.db.prepare('SELECT COUNT(*) n FROM native_presence_events').get().n >= MAX_RECORDS) { limited = true; continue; }
          this.inbox.db.prepare("INSERT INTO native_presence_events(event_id,content,state,created,scan_id) VALUES(?,?,'pending',?,?)").run(event.event_id, JSON.stringify(event), this.now(), scanId);
        }
      }
      this.inbox.db.prepare('UPDATE native_presence_scan SET cursor=?,scan_id=?,capacity_limited=? WHERE id=1')
        .run(cursor, cursor === null ? randomUUID() : scanId, cursor === null ? 0 : Number(brokerLimited));
    }, { growth: events.reduce((n, event) => n + Buffer.byteLength(JSON.stringify(event)) + 512, 4096) });
    return limited;
  }
  async read() {
    await this.refresh();
    if (!this.active()) throw new LocalError('session_mismatch');
    if (!this.supported()) return { events: [], has_more: false, capacity_limited: false, supported: false };
    const rows = this.inbox.db.prepare("SELECT event_id,content FROM native_presence_events WHERE state='pending' ORDER BY created,event_id LIMIT 11").all();
    const selected = rows.slice(0, PAGE_SIZE);
    this.inbox.transaction(() => {
      for (const row of selected) this.inbox.db.prepare('UPDATE native_presence_events SET exposed=1 WHERE event_id=?').run(row.event_id);
    });
    return { events: selected.map(row => JSON.parse(row.content)), has_more: rows.length > PAGE_SIZE,
      capacity_limited: this.limited === true, supported: true };
  }
  async acknowledge(eventId) {
    validateUuid(eventId);
    if (!this.active()) throw new LocalError('session_mismatch');
    if (!this.supported()) throw new LocalError('invalid_configuration');
    await this.running;
    if (!this.active()) throw new LocalError('session_mismatch');
    const row = this.inbox.db.prepare('SELECT state,exposed FROM native_presence_events WHERE event_id=?').get(eventId);
    if (!row?.exposed) {
      const error = new LocalError('receipt_required', { field: 'event_id' });
      error.message = 'Read this exact transport event with broker_presence_events before acknowledging it. No event or message was acknowledged.';
      throw error;
    }
    if (row.state === 'acked') return { event_id: eventId, acknowledged: true };
    this.inbox.transaction(() => this.inbox.db.prepare("UPDATE native_presence_events SET state='ack_requested' WHERE event_id=?").run(eventId));
    await this.refresh();
    if (!this.active()) throw new LocalError('session_mismatch');
    return { event_id: eventId, acknowledged: this.inbox.db.prepare('SELECT state FROM native_presence_events WHERE event_id=?').get(eventId)?.state === 'acked' };
  }
}
