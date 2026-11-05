# 0.7.0 — Unreleased

- Align the npm package, native plugin and GitHub/npm marketplace catalogs with the 0.7.0 release set. This change does not publish a package or release.
- Includes explicit `/psst:reauthorize` and safe recovery of pending/unusable approval candidates merged in PR #34.

# 0.6.0 — Unreleased

- Add an administrator-owned npm catalog entry that retains `psst@psst-connectors`; distinguish source/seed ownership and declared native MCP from actual attachment in sanitized read-only diagnostics.
- Qualify fresh native npm installation and the published 0.4.0 upgrade with the official host, preserving real private credentials/unread journals and exercising URL-only approval, restart, send/read/ACK and suppression negatives through an isolated provider. Authenticated automatic delivery and live managed distribution remain separate release gates.
- Rename the npm distribution and GitHub repository to `claude-psst-connector`.
- Preserve native plugin identity, commands, private installation state and message journals.
- Existing installations require an explicit package/source update; see `docs/migration-0.6.0.md`.

# Changelog

## 0.8.0 (unreleased)

- Execute human slash requests directly, consolidate unresolved target/choice
  confirmation, and align skills/native instructions with already-authorized
  peer replies and exact metadata routing. Native guards and delivery stay intact.
- Let broker_connect omit its file argument to reuse existing saved access only;
  never turn failed saved credentials or a legacy connection into new enrollment.

- Keep the native monitor inert across verified same-host session transitions and
  rebind only to committed SessionStart authority, with lifetime-fenced notices.
- Preserve bounded message and presence reservations across overlapping monitors.
- Resolve current native state independently of stale startup session hints.
- Clarify installation SessionStart requirements and pending interactive recovery
  validation; no release or live-host acceptance is claimed.


## Unreleased

- Preserve unread-message reminder limits across same-lifetime monitor restart. Reserve private checkpoints before stdout and fail closed with explicit blocked readiness on corrupt, unsafe or unwritable checkpoints, without changing messages or acknowledgments.

- Keep native MCP transport available across verified conversation changes with per-call native provenance, complete old-lifetime draining and queued-output fencing. Preserve same-lifetime compaction and old pending/uncertain work.

- Resolve shared project labels with bounded local configuration and hide provider in readable presentation without changing model provenance.
- Add explicitly opted-in registration v2 native-incarnation recovery. Expired identity replacement starts an empty journal and preserves old uncertain work separately. Default v1 behavior and broker enforcement remain unchanged.

## Unreleased

- Standardize readable native messages in English: `Psst · new message`, `From:`, and `Details` with `Sender ID` / `Message ID`. Preserve the complete body and original structured provenance; correlation remains internal.

- Explain bounded native MCP recovery for missing tools, distinguishing failed, absent, connected-but-unavailable and policy-disabled states. Recheck identity and monitor status without replacing saved authorization. No change to lifecycle binding, transport, permissions or enrollment behavior; uninterrupted native session transitions remain unverified.

## 0.5.1 (unreleased)

- Align the package, plugin and marketplace versions with the Psst 0.5.1 release set. This numbering change does not erase the previous npm 0.6.0 publication; registry release and dist-tag management remain explicit operator actions.

- Render nonempty native receive results as readable other-agent messages while preserving the original structured result, full body, exact IDs and pending ledger. Host UI controls folding; no new hook or assistant turn.

- Distinguish a pending/confirmed native read ACK from the host injection receipt this delivery mode does not provide. Replace the permanent acceptance-unverified status with current connection/monitor observations; no new user attestation, automatic ACK, task-success claim or permission change.

## 0.5.0

- Configure only a broker HTTPS URL inside Claude, explicitly request access, and approve the exact installation in the broker operator UI. No pairing-secret field or per-session file handoff.
- Resume existing pending requests after restart with GET only, preserving request/key identity and honoring shared server backoff. Never enroll automatically on ordinary startup or auth failure.
- Keep existing authorization while replacement is pending; fence cancellation during attachment and roll back failed attachment/selection without disconnecting other native sessions.
- Persist new native bindings and inbox journals under the mounted Claude config volume, retaining only verified live legacy bindings in place.
- Add actual broker TLS/admin-form, concurrent-session, lost-response, cancellation and container-recreation fixtures. Native authenticated interactive monitor acceptance remains a separate environment gate.


## 0.4.0

- Configure broker URL and a sensitive one-use pairing secret inside Claude;
  explicit initial setup accepts no secret tool arguments and never runs at startup.
- Remember the authorized installation under the existing CLAUDE_CONFIG_DIR
  volume. New sessions auto-attach with separate native IDs and inboxes; disconnect
  affects only its session. Legacy private bundles remain supported.
- Start the bounded body-free monitor with each interactive session, preserving
  native binding, receipt acknowledgment, cancellation and reconnect protections.
- Add atomic installation selection, concurrent writer fencing, fail-closed
  configuration validation and explicit recovery without overwriting corrupt state.
- Document initial native reload, secure-storage limitations, and the absence of
  automatic cleanup for the native stored one-use secret.

Validation: 35 unit tests, 16 integration cases, repeated 30-process selection,
syntax checks and official Claude 2.1.310 manifest validation passed. Authenticated
native configuration-dialog-to-MCP handoff and actual monitor/model acceptance
remain unverified. No broker deployment or real credential migration is included.


## 0.3.1

- Explicit connect/disconnect now supersedes deferred startup auto-resume, fixing
  an intermittent reconnect failure when the first timer tick read stale disabled
  activation state during registration of a new credential. Even an invalid
  explicit connect attempt consumes that one startup intention; it does not
  silently fall back to a previously saved connection.
- Legacy startup auto-resume is unchanged when no explicit connection command
  intervenes. No permission, receipt, enrollment or credential rules are relaxed.
- Added a deterministic real-TLS regression that gates the startup tick during
  reconnect; 29 unit tests and 11 integration cases pass.


## 0.3.0

- Native `/psst:connect` and `/psst:disconnect` work inside an existing confirmed
  Claude session; MCP tools remain available before broker configuration.
- Opt-in interactive inbox monitor emits bounded, body-free pending notices.
  Explicit receive/receipt acknowledgment remains separate from task completion.
- Private-file pairing creates installation credentials through the broker
  enrollment API; existing legacy connection bundles remain supported.
- Credential-bound durable journals, strict receipt validation and cancellation
  fences prevent cross-principal replay and late connection attachment.

Validation: 29 unit tests and 10 integration cases, including packed installation,
TLS pairing fixtures, cancellation/reconnect and legacy lifecycle preservation.
Authenticated native Claude monitor wakeup remains an explicit live acceptance
step, not a production guarantee. Interactive Claude2.1.310+ and Node24.19+ within
24.x are required for monitor use. Pairing requires the enrollment API to be
actually deployed; testing with existing legacy bundles does not.

No broker deployment, credential migration or managed-policy changes are part
of this release. Existing native permission prompts still require user consent.
