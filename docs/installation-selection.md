# One installation, separate native sessions

This describes the 0.4.0 source. Version preparation is not publication and does
not claim authenticated native monitor acceptance.

## Configure once, inside Claude

The plugin declares an optional non-secret `broker_url` in native `userConfig`,
available in the native `/plugin configure` dialog. It reaches only the
MCP process through its `env` entry, not a shell argument. `PSST_BROKER_URL` is the
fallback when that option is blank. URLs must be HTTPS origins with no credentials,
query, fragment or path. A configured origin is checked against the authorized
installation; it never redirects an existing token to another broker.

A URL is **not authorization**. For first setup, configure the URL and one-use
`pairing_secret` in Claude's native plugin dialog. The secret field is marked
sensitive and reaches only MCP environment substitution, never skill text or tool
arguments. Explicit `/psst:connect` invokes zero-argument `broker_setup`; it uses
the existing enrollment API and stores a durable installation credential. No
secret needs to be pasted into chat or a shell. If the native UI offers removal, clear the one-use secret there after success.
CLI 2.1.310 `configure --values-stdin` with an empty sensitive value preserves
the old value; no supported CLI removal option was found. The plugin does not edit
Claude credential storage or claim automatic removal. Startup never reads it to enroll or
repair failed authorization: it uses only the saved credential. A retained secret
is not permission to retry enrollment. Existing private file input remains valid.

Apply configuration before first setup: close the native `/plugin` panel and
check that its plugin reload completed. If changes remain pending, run
`/reload-plugins` inside the interactive session; if Claude warns about prompt
cache cost, the user can explicitly accept its `--force` guidance or start a fresh
session. Do not loop `broker_setup` against an old MCP environment. Configuration
saved by the shell CLI requires a restart to apply. Non-interactive/desktop reload
does not reconnect plugin MCP processes, so start a fresh session there. This is
initial configuration application, not a command required for every new session.
Official behavior: https://code.claude.com/docs/en/plugins/install#manage-installed-plugins
and https://code.claude.com/docs/en/plugins/cli-reference#reload-plugins .

Official CLI 2.1.310 with isolated synthetic configuration verified persistence
across processes and redaction from configuration output. On this Linux fixture,
secure storage fell back to a mode-0600 plaintext credentials file: this is not a
claim of encrypted-at-rest storage. MCP fixtures verify explicit setup, cancellation
and restart without reissuance; authenticated native dialog-to-MCP handoff and live
monitor delivery remain acceptance gates. No native trust or permissions are bypassed.

A successful explicit `broker_setup` or `broker_connect` remembers the selected connection file.
New native sessions in that same installation scope then attach automatically.
No repeated connect command, per-session credential file or agent/model polling
loop is needed. An unsuccessful or cancelled connection never changes selection.
If saving loses a concurrent-choice race, the result reports `saved:false`; the
current successful session remains connected, but future sessions keep the other
choice. Retry/change must be explicit, not an automatic overwrite.

## Persistence boundary

With an absolute `CLAUDE_CONFIG_DIR`, private state goes under its `psst/` child:
`selected-installation.json` and new pairing-generated enrollment credentials,
receipts and connection files. This reuses the existing mounted config volume.
Outside that environment the existing `~/.config/psst` fallback is retained.
No files on an existing installation are moved by loading this version.

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
