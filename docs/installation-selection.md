# One installation, separate native sessions

This describes the 0.5.0 source. Version preparation is not publication and does
not claim authenticated native monitor acceptance.

## Configure once, inside Claude

The plugin declares an optional non-secret `broker_url` in native `userConfig`,
available in the native `/plugin configure` dialog. It reaches only the
MCP process through its `env` entry, not a shell argument. `PSST_BROKER_URL` is the
fallback when that option is blank. URLs must be HTTPS origins with no credentials,
query, fragment or path. A configured origin is checked against the authorized
installation; it never redirects an existing token to another broker.

A URL is **not authorization**. Explicit `broker_setup` uses only the native
broker URL. The shared approval helper durably writes its random candidate and
request ID before any POST. The operator approves the exact request through the
broker's password form UI; no Basic authentication or secret handoff is required.
The primary plugin manifest has no pairing-secret field. Existing secret-based
bundles remain valid for backward compatibility but are never implicitly copied.

Pending status is polled by the host no more frequently than every two seconds, independently of
the model. Its durable setup context remembers broker origin, request ID and the
original selection revision, never a second credential copy. Startup may GET an
existing explicit pending request; it never POSTs, creates a key or rotates access.
A failed/uncertain POST keeps the same durable request. Missing, corrupted or
terminal state cannot trigger an automatic replacement. Server Retry-After and shared installation cooldown are honored (up to five minutes). Denied/expired stops
polling. Local cancellation and disconnect suppress that native lifetime's resume.

An explicitly requested replacement preserves working authorization while pending.
After approval, attach validates the marked receipt and original selection revision;
failed attach/selection restores the previous connection when the lifetime remains
valid. Old credential-bound journals are retained, not migrated into a new identity.
The broker operator revokes old authorization separately if desired.

Apply initial URL configuration by closing the native `/plugin` panel and checking
its reload. If changes remain pending, use `/reload-plugins` in the interactive
session or start a fresh session; heed native cache/permission warnings. Shell
configuration needs a new process, and non-interactive/desktop reload does not
reconnect MCP servers. This is initial configuration, not a per-session command.

Official Claude 2.1.310 `--init-only` audit proves persisted native URL substitution
into a newly loaded MCP plus matching native parent/session bindings, without
login or model usage. It does not prove interactive dialog behavior, authenticated
model acceptance or actual delivery to the user's host. Those gates remain honest.

A successful explicit `broker_setup` or `broker_connect` remembers the selected connection file.
New native sessions in that same installation scope then attach automatically.
No repeated connect command, per-session credential file or agent/model polling
loop is needed. An unsuccessful or cancelled connection never changes selection.
For legacy explicit connect, losing a concurrent selection race reports `saved:false`
and keeps that session connected without changing future sessions. Approved setup
is transactional: selection failure restores the previous connection instead.
Retry/change must be explicit, not an automatic overwrite.

## Persistence boundary

With an absolute `CLAUDE_CONFIG_DIR`, private state goes under its `psst/` child:
`selected-installation.json`, `setup-context.json`, and new approval credentials,
receipts and connection files under `approvals/<origin-and-client-hash>/`. This reuses the existing mounted config volume.
Outside that environment the existing `~/.config/psst` fallback is retained.
No files on an existing installation are moved by loading this version.

New native lifetimes keep their binding, activation and credential-specific inbox
journals under `CLAUDE_CONFIG_DIR/psst/native/`. Installation authorization is shared;
these native lifetime IDs and journals are not. The explicit absolute
`PSST_CLAUDE_NATIVE_STATE_ROOT` override takes precedence. Without a config volume,
the historical `~/.config/psst/native/` fallback remains.

On upgrade, an exact live legacy binding verified by boot ID, PID/start time and
native session may finish in its original directory. Mere legacy file existence
does not send future lifetimes back to ephemeral storage. Nothing copies, moves
or adopts its unread inbox into another native identity. Retaining the config
volume across a container restart preserves journals, while a genuinely new native
session still receives a new identity; old unread data belongs only to its original
lifetime. External legacy paths are durable only if their own storage is retained.

Legacy external bundles remain supported and are not copied or rewritten.
A pointer to `/tmp/connection.json` does not make that file or its token durable.
It will fail closed if that external input disappears; use durable input storage.
Marked enrollment bundles still require their strict receipt. Genuine legacy
bundles do not gain a fabricated receipt. A private pointer stores only its file
path and revision, never a token. Operator-maintained file rotation is revalidated
on new attachments; active sessions are never switched by selection changes.

Startup precedence: explicit `PSST_CLAUDE_CONFIG`/`PSST_CONFIG_FILE`, then selected
installation, then the old default file. Within the same native lifetime, existing
activation/journal state takes precedence, including its local disconnect tombstone.
An invalid selection or explicit override does not silently choose a different
credential. A valid explicit connect can recover only the current session when
the saved selection is corrupt/unreadable; it returns `saved:false` with a
sanitized reason and leaves that file and its permissions untouched. Global selection writes use a short kernel-held SQLite lock and atomic
rename plus revision comparison. Readers do not take that lock. Process crashes do
not leave a PID lock that somebody must delete.

## Isolation and notifications

Each real native PID/start/boot/session lifetime retains its own client ID and
journal. Thirty simultaneous synthetic native hosts were tested with distinct IDs;
sharing one installation credential does not share an inbox. Disconnect affects
only that session, preserves unread data and does not forget the installation or
disconnect other sessions. New sessions remain eligible to connect.

The official monitor `when: "always"` starts on native interactive session start
and plugin reload. It stays silent disconnected, uses only body-free status,
retains bounded reminders, and exits when its exact native binding ends. It waits
up to ten seconds for a delayed matching SessionStart; it never synthesizes one.
Headless `-p` does not run these plugin monitors. No native trust/auth policy is
changed. Actual authenticated monitor notification arrival and model response
still require a live acceptance test, separately from fixture and manifest checks.

Official schema: https://code.claude.com/docs/en/plugins-reference
