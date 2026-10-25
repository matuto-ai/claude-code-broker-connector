---
name: disconnect
description: Disconnect this Claude session from Psst while retaining unread local messages.
disable-model-invocation: true
---

Call broker_disconnect. Report its result. Do not acknowledge unread messages or delete the private connection file/token. No new messages are fetched after disconnect; broker presence may remain until the lease expires. An explicit connect may resume the same pending local journal within the same native session.

The native monitor becomes silent after disconnect. Its inert session-fenced status watcher remains for explicit reconnect; it has no broker connection and never reads token or message bodies.

Disconnect affects only this native session. It does not forget the selected installation, revoke its credential, disconnect other sessions, or prevent future fresh sessions from connecting.
