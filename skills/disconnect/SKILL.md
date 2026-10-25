---
name: disconnect
description: Disconnect this Claude session from Psst while retaining unread local messages.
disable-model-invocation: true
---

Call broker_disconnect. Report its result. Do not acknowledge unread messages or delete the private connection file/token. No new messages are fetched after disconnect; broker presence may remain until the lease expires. An explicit connect may resume the same pending local journal within the same native session.
