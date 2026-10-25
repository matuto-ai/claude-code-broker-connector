# Explicit private-file pairing

Requires a broker implementing `/v1/enrollments` (Psst PR #18, reviewed source
`4a9d604e1107a92c94f8b8a2f0e1cb2d1e2ecc39`; not assumed deployed).
An operator supplies a private `psst-pairing-v1` JSON file for `claude-code`.
Do not paste its secret into chat, command arguments, logs or URLs.

With the plugin installed and native session binding confirmed:

```
/psst:connect /absolute/private/pairing.json
```

The skill passes only the path to `broker_connect`. The connector privately reads
it, generates its own installation token, durably records retry state **before**
HTTPS enrollment, validates the returned receipt, then starts the normal transport.
No environment variable or second agent is required. Existing private connection
bundles remain accepted by the same command.

State is private under `$CLAUDE_CONFIG_DIR/psst/enrollment` when configured, otherwise `~/.config/psst/enrollment`, separate from native-session
inboxes. This is one installation credential, not a shared credential for every
agent. Each native session still has a fresh broker session address. Identity
reports credential ID/expiry, never token or pairing secret. Lost/uncertain
responses may be retried with the same private pairing file and state directory;
do not delete retry state or generate another token to guess the outcome.
Disconnect, native SessionEnd and MCP EOF fence late connection results. An
in-flight enrollment may finish and persist its private retry bundle, but cannot
attach transport after cancellation. If session registration was already in flight,
a broker lease can remain until expiry; local tools remain disconnected. Same-session
retry preserves the journal identity rather than permanently closing it. Disconnect
is not credential revocation.

Explicitly disconnect before pairing a replacement. A replacement credential gets
a different durable inbox/identity partition; old pending data is retained and is
never silently attached to the new principal. Replacement does not revoke the old
server credential: it remains usable until operator revocation or expiry.
Same-credential reconnect retains
its pending FIFO. Resuming a marked enrollment bundle revalidates its token-bound
receipt; missing/corrupt/type/origin/token-mismatched or expired receipts, removed markers,
or a changed saved credential identity fail
closed, never falling back to legacy behavior. Expired credentials require an
operator-provided fresh pairing file. The connector does not renew their expiry.

The helper uses system HTTPS trust, a ten-second absolute request deadline and
bounded responses; redirects are not followed. Pairing currently has no private-CA
configuration field. Existing legacy connection CA support is unchanged. Native
permissions, workspace trust, managed MCP policy and monitor acceptance limits
remain unchanged; connecting is not proof of automatic model wakeup.

## Source and evidence

`vendor/enrollment.mjs` is verbatim `reference/enrollment.mjs` from the commit above
(MIT, same Psst license in `vendor/psst/LICENSE`). SHA256:
`72318244ac7b799570704f59e167a0684b6c567cb6cda90303f32d7056ee0a06`.
`src/enrollment-support.mjs` verifies it before dynamic import. The older transport
snapshot remains unchanged. Unit fixtures cover helper-produced bundles, strict
receipt validation, partition selection and restart revalidation. MCP integration also exercises real HTTPS with a synthetic enrollment endpoint: private file issuance, token authentication, replacement credential isolation, and recovery of the old pending receipt. The native parent and issuance handler remain fixtures, not authenticated Claude or production issuance certification. Legacy real HTTP integration remains covered.

Native private setup: see [installation selection](installation-selection.md). The new in-memory helper is pinned to the exact source above; its upstream PR is not assumed merged.
