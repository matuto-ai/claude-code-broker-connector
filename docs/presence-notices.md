# Prolonged-offline transport notices

The native Claude plugin consumes Psst's authenticated, sender-owned
`recipient_offline` events when the broker advertises `presence_events: true`.
This adds the Claude consumer for [Psst #29](https://github.com/matuto-ai/psst/issues/29).
It does not change broker policy or complete that cross-repository acceptance.
Older brokers are supported without presence HTTP requests or notices.

## Meaning and use

A native monitor hint asks the model to call `broker_presence_events`. Its result
contains at most ten events with event/recipient IDs, heartbeat/creation/observation
times, current observed transport status, and up to ten pending-message IDs with
queued/claimed state and delivery uncertainty. No message body, model activity,
private path or credential is included. The broker owns the grace: the current
default is 600 seconds since the last confirmed heartbeat, separate from the
60-second heartbeat and 180-second presence lease. A disconnected recipient can
still accept intentional durable mail.

The human-readable result is labeled **Psst · transport notice**, not an agent
message or instruction. It is not a reply timeout, proof of non-receipt, or
permission to take an action. Transport state can change after observation.
The machine-readable fields are also available in `structuredContent`.

After reading an event, explicitly call `broker_acknowledge_presence_event` with
its exact `event_id`. It acknowledges only that notice. It does not change any
message, read receipt or native transcript receipt. A successful stdout write,
MCP read, monitor observation or timer never ACKs an event. The connector never
automatically resends, cancels or closes anything because of a notice.

`has_more` indicates more locally pending events. `capacity_limited` can also
indicate an incomplete broker scan or a full journal. Read and explicitly ACK
observed IDs to advance; do not invent a model polling loop or ACK unseen IDs.

## Durable bounds and recovery

- The existing private, exclusively owned native-session SQLite journal contains
  a separate table. Presence events do not enter the message FIFO.
- Background refresh runs at most once per minute. Each refresh has a five-second
  deadline, reads at most 26 pages of ten events and checks a 64 KiB page limit.
  Empty continuation pages and each validated cursor are checkpointed in the
  same journal, so sparse feeds, later-request failures and restart make progress.
  The local table holds at most 256 events, including ACK tombstones. Confirmed
  tombstones may be evicted under pressure; pending or uncertain ACK intents are
  never evicted to admit another event.
- Explicit read refreshes the broker snapshot and exposes up to ten records.
  A complete traversal removes obsolete unread events using durable seen markers
  across all its batches, never just the resumed suffix. Partial/capacity-limited
  traversals retain them; observation timestamps and uncertainty remain visible.
- ACK intent is committed locally before the idempotent broker ACK. Lost responses
  retain that intent across MCP restart and reconnect. Reconciliation retries
  only the same event ID, even if it disappeared from the event feed. Only the
  exact success response or the broker's specific `404 message_not_found` retires
  the intent. Permission, network and malformed-response failures do not.
- The native monitor reads only a private status hint. Its presence budget is
  independent of message reminders: three hints for the current event, with
  30-second then 90-second retry delays, and at most 30 in ten minutes. The
  checkpoint is saved before stdout, survives a monitor restart in the same
  native lifetime, and cannot acknowledge the event. A corrupt checkpoint stops
  transport hints rather than resetting the budget. Ordinary inbox monitoring
  continues. Stale refresh data does not drive new automatic hints.
- Exact native-lifetime/provenance checks still gate both tools and final results.
  Disconnect, replacement and shutdown abort/drain presence I/O before closing
  the journal. They do not adopt another lifetime's records or create credentials.

## Evidence boundary

Unit tests cover restart and deduplication, explicit-read-before-ACK, lost ACK
responses, invalid receipts, unsupported brokers, obsolete/changed snapshots,
page/byte/record bounds, cancellation, finite monitor reminders and MCP argument
validation. Broker responses are supplied by in-process collaborators; no broker,
child MCP or native monitor process is started.

Passing these tests does not establish authenticated Claude model execution,
automatic monitor behavior in an interactive host, or actual native attachment.
The owner deferred those real-environment checks to a later integrated test on
their machine; they are not current Claude #11 acceptance gates. No running
deployment, policy or user installation is changed.
