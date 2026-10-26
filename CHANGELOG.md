# Changelog

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
