---
name: disconnect
description: Disconnect this Claude session from Psst while retaining unread local messages.
disable-model-invocation: true
---

First check that broker_disconnect is available; if absent, immediately report that blocker. Otherwise call broker_disconnect immediately and report its result—no confirmation, preventive diagnostics or tests. For missing tools or failures, follow bounded native-recovery guidance supplied by the session hook/MCP initialization; if unavailable, stop with the blocker and next step. Native denial needs the administrator, not a workaround.

Disconnect stops only this session's fetches and monitor. Retain unread messages, private connection file/token and installation selection; never acknowledge or revoke them. The inert session-fenced watcher remains without reading tokens/bodies. Broker presence may last until lease expiry. Explicit connect may resume this session's pending journal; other and future sessions retain access.
