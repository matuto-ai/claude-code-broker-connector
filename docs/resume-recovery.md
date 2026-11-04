# 0.8.0 candidate: native resume recovery

## Report and source diagnosis

The owner reported `blocked_monitor_not_observed` on 0.7.0 after `/resume` changed
the native binding in the same host process. The old monitor retained its startup
session and exited 0; reload, resume and native MCP recovery did not restore usable
automatic receipt. These are owner observations, not a reproduced host trace here.

Source confirms the monitor's permanent exit when its initial binding changes.
The MCP is different: it already reconciles epochs, but its state-root selection
used the startup environment session hint. In a live legacy-root case that hint
can hide current verified ownership and choose an empty durable root instead.
The new regression demonstrates this decision with real temporary binding files;
it does not establish that the owner's MCP failure had this particular cause.

## Candidate behavior

- The native monitor remains attached to one live host process identity. A changed
  session invalidates its old epoch immediately. Missing or partial authority is a
  silent wait, not a successful exit and not permission to emit a notification.
- Only a committed canonical SessionStart association can select the next epoch.
  The monitor reads body-free status, never an inbox, token or message body. It
  checks status session/lifetime/host/freshness and fences again before output or
  observation. No old mailbox follows the new session.
- Message and presence reservations both use the existing kernel-held checkpoint
  lock. Reload overlap cannot mint extra reminders; reservation failure blocks
  hints without modifying the queue. A new lifetime gets its own budget.
- MCP transport and monitor select current native control independently of stale
  startup session hints. Failed MCP retirement still blocks new admission.
- A fresh installation/update still needs a genuine SessionStart with the plugin
  enabled. Reload applies pending plugin changes, not a fabricated binding.
  `blocked_monitor_not_observed` is not proof of missing authorization and must
  not trigger reauthorization or repeated speculative recovery commands.

## Verification and unresolved real-host gate

Focused units exercise actual private binding/status files, SessionStart authority,
A → gap → B in one host, overlapping monitors, compact/restart budgets, stale and
future status, partial/corrupt authority, failed checkpoint writes, and a transition
between reservation and stdout. They use injected time/output, not an authenticated
Claude host, actual native notification routing, a live broker or real inbox data.

The official manifest documents `when: "always"` startup/reload, not a guarantee
that every `/resume` rearms a monitor. A persistent monitor avoids depending on
that restart. The host still owns stdout routing; its delivery to the currently
active native conversation must be checked on the supported installed version.

Before calling this recovery accepted, record a real native test with the exact
candidate loaded: automatic arrival in A, `/resume` to B within the same process,
new B identity/monitor observation and automatic arrival/read/explicit ACK in B,
with A's pending state preserved and no credential replacement. Also exercise a
delayed SessionStart and one supported recovery after a concrete failure. Record
host version and sanitized lifecycle/status evidence. Do not substitute manual
receive, database reading, a standalone MCP server or notification injection.

This executor has no connected authenticated Claude host. That acceptance remains
pending, and this document does not downgrade it to a unit test. No live data,
credentials, permissions or user environment have been changed.

References: [issue #37](https://github.com/matuto-ai/claude-psst-connector/issues/37),
[native monitor contract](https://code.claude.com/docs/en/plugins/components#monitors),
[trigger definition](https://code.claude.com/docs/en/plugins/manifest-reference#monitors).
