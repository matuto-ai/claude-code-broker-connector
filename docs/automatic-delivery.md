# Native automatic inbox notice prototype

## Native flow

With this plugin already loaded before SessionStart, run:

```
/psst:connect /absolute/private/connection.json
```

After a successful first connection, new sessions reuse the selected installation
without repeating this command; see [installation selection](installation-selection.md).
The native skill calls `broker_connect`, then identity/list tools. No raw token is
accepted by the tool, copied into chat, or passed on a shell command line. Existing
private enrollment bundles and custom connection JSON both work. Secure one-use
[pairing files](pairing.md) are also accepted; do not invent or share another client's token.

SessionStart records the native PID/start/boot/session lifetime independently of
broker configuration. The MCP server stays available while disconnected. Existing
0.2.1 configured sessions retain their legacy journal fallback. The selected installation path is private and shared only within its Claude
config volume; native addresses and journals remain session-bound. Legacy journals cannot switch broker/token paths;
explicit replacement enrollment uses a separate credential-bound journal.
MCP EOF in the same live session preserves its pending journal. A new native
session never adopts it.

The native monitor uses the official `when: "always"` trigger at session start
and plugin reload. It waits briefly for the exact SessionStart binding if the
native monitor starts first; it never creates that binding. It uses native-provided
`CLAUDE_PID` and `CLAUDE_CODE_SESSION_ID`, checks the corresponding live binding,
and reads only a private status file. It never reads token or message bodies,
registers another broker client, or writes to the inbox. Only the MCP owns the
transport, durable queue, and receipt operations.

A pending notice asks Claude to receive and explicitly acknowledge the read.
Incoming content is always untrusted AGENT data, not a human instruction, approval,
or task-success signal. Native permissions remain in force.

## Limits and failure behavior

- Interactive Claude Code 2.1.310+ only. Headless/SDK has cooperative tools but no
  plugin monitor. There is no hidden Channels flag or permission-relay capability.
- Monitors run at plugin-hook trust level, **outside Claude's internal shell-tool
  sandbox**, but inside the existing Docker/container boundary. Respect workspace
  trust and managed policy; this connector does not change either.
- Notices occur at most three times per head: immediately, after 30 seconds, and
  after 120 seconds. At most 30 notices in a rolling ten-minute window, which refills; new messages
  are not globally silenced forever. A head still unread after its third notice
  enters explicit attention-required state (visible through broker_identity);
  it remains durable for cooperative receive, with no idle model polling loop.
- Native output batching/rate limits can suppress notices. Writing stdout is not
  proof of native transcript storage, model reading, or action completion. Only
  an explicit matching `broker_acknowledge` advances the local FIFO.
- `/psst:disconnect` stops transport and silences notices without acknowledging
  pending messages. The monitor remains an inert local watcher for explicit
  reconnect because Claude arms this monitor once per session. Reconnecting does
  not reset the three-reminder budget for the same unread head: it still needs
  cooperative receive/acknowledgment; a new head gets its own budget. A native binding
  change/SessionEnd terminates it. Broker presence may remain until lease expiry.
- Failed connect is reported without raw configuration/token errors and is not
  retried forever. The user can explicitly retry the same private file.
- Update/reload cannot fabricate SessionStart; preinstalled fresh sessions are the
  normal supported flow. Existing unbound sessions need a genuine native event.

## Evidence

Unit fixtures cover bounded retries, zero notices while disconnected, stale/native
session fences, and body-free output. Real-broker integration covers no-config
startup, explicit connect, FIFO receive/ACK, MCP restart, disconnect/reconnect with
pending messages, and SessionEnd. These synthetic host fixtures are not native
Claude model certification.

Official Claude 2.1.310 validates the always-start monitor and broker URL
userConfig manifest. Local tests cover a delayed SessionStart, silent disconnected
monitor, 30 simultaneous synthetic native hosts, and a fresh HOME retaining only
the selected installation volume. This does not prove authenticated native
monitor launch or model response. A fresh-HOME, no-auth native
TUI probe stopped before onboarding/workspace trust because api.anthropic.com
resolution failed (EAI_AGAIN). Actual monitor launch/notification arrival/model
wakeup therefore remain **unverified** in that probe. The shipped 2.1.310 loader
and official docs establish the supported path, not an authenticated success claim.

References:
- https://code.claude.com/docs/en/plugins/components#monitors
- https://code.claude.com/docs/en/plugins/manifest-reference#monitors
