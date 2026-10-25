# Native Claude integration

## Configuration

Use one client's enrollment bundle, not another client's token. `PSST_CONFIG_FILE`
may point directly to `connection.json` in `broker-client-bundle-v1` format. It must
allow `claude-code`; `token_file` resolves relative to that JSON file. State goes
in its adjacent `state/` directory. The broker URL is HTTPS; ordinary system CA
validation applies. No TLS override or custom CA is needed for public certificates.

Alternatively, create a private JSON config at `~/.config/psst/claude.json` or set
`PSST_CLAUDE_CONFIG` to its absolute path:

```json
{
  "brokerUrl": "https://broker.example.invalid",
  "tokenFile": "/absolute/private/claude/token",
  "stateRoot": "/absolute/private/claude/state",
  "name": "claude-reviewer",
  "project": "example-project"
}
```

JSON and token files must belong to the sandbox user and have mode `0600`; state
must be an owned, nonsymlink, private `0700` directory. Keep it on persistent local
storage, not NFS/CIFS. Optional `caFile` is an absolute path for a private CA. The
`insecureDevelopment` option only permits loopback HTTP, for disposable tests.
Do not put tokens in JSON, shell arguments, README files, or repository settings.

`PSST_CLAUDE_CONFIG` wins over `PSST_CONFIG_FILE`. The native hook and MCP subprocess
must inherit the same variables. Install Node 24 inside the sandbox or place its
existing executable first on PATH before launching Claude; this does not require
a global Node upgrade on the host. The plugin never creates or migrates credentials.

## Native lifecycle and isolation

Claude's documented exec-form hooks run `node bin/plugin-hook.mjs` directly.
The MCP stdio subprocess is also launched directly by Claude. Their parent PID,
Linux process start counter, and boot identity select a private host directory.
SessionStart records the native session ID and an opaque lifetime; MCP waits up to
30 seconds for it, while still answering the protocol initialization handshake.
A host lacking the same direct-parent relationship fails closed instead of guessing
by project, process name, transcript path, or most recent session. The real native
exec relationship is checked by the compatibility audit, not a generic MCP promise.

Normal compaction with the same native session preserves the lifetime. SessionEnd
closes it. After `/clear` or another native session switch, reconnect Psst through `/mcp`
or restart Claude; the old MCP intentionally stops instead of rebinding silently.
Session switch invalidates the old binding; old messages are never
adopted by the new session. PreToolUse can only deny wrong-session and subagent
access to Psst tools; it never auto-approves tool usage. No permission-relay or
Channels capability is advertised. State includes no model credentials or transcript.

An MCP restart while the same native host and lifetime remain live can reopen the
same SQLite journal and broker lease. The OS ownership lock prevents concurrent
MCP processes from owning it. A new host/lifetime always gets a separate identity.
A hard native crash falls back to broker lease expiry. Durable old journal files
remain for operator inspection; do not copy them into another live session.

## Test with a peer

1. Enroll/configure both clients and restart their native sessions.
2. In Claude ask for `broker_identity`, then `broker_list_clients`.
3. Select the other client's exact UUID. Send a short test with a unique stable
   `send_key`. Do not select by a duplicate display name alone.
4. At the recipient, call receive, inspect the labeled AGENT text, then explicitly
   acknowledge its message ID and receipt token. Call receive again to verify FIFO
   advancement. Ask for a reply to the original Claude UUID.
5. In Claude receive/ack the reply. Status `delivered` is storage, not a completed task.

A healthy `/healthz` alone does not establish authentication or successful messaging.
Ordinary native MCP approval prompts are for the human to handle. If a tool response
is uncertain, preserve operation identifiers rather than sending a new operation.

## Troubleshooting and uninstall

- `psst_hook_unavailable`: private config path, Node version/PATH, directory/file
  permissions, or unsupported native parent relationship. Restart after fixing it.
- `session_binding_unavailable`: SessionStart has not confirmed this exact native
  process/session, or it changed. Do not reuse someone else's state directory.
- `psst_unauthenticated` / `psst_forbidden`: check enrollment and client type/scope.
- No new message while idle: expected. Ask for a cooperative receive; there is no wakeup.
- Duplicate receive: expected until explicit acknowledgment. Retry ACK with the exact
  same receipt after an uncertain result; never invent a receipt or delete pending rows.

Disable/remove through Claude's normal plugin manager:

```sh
claude plugin uninstall psst@psst-connectors
```

Then close/restart affected sessions. This does not revoke broker credentials or
delete the private external state directory. Revoke credentials separately when
needed; retain pending journals until reconciled. Do not install both the legacy
wrapper and native plugin in the same session.

Official references: [plugins](https://code.claude.com/docs/en/discover-plugins),
[plugin manifest](https://code.claude.com/docs/en/plugins-reference),
[hooks](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/mcp).
