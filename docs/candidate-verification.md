# Unreleased candidate verification — 2026-11-01

Related issue: #11; not closed by this partial delivery.

## Checked locally

Syntax + 70/70 unit tests passed; integration 22 passed and one unavailable container gate skipped. Unit aggregate includes package validation.

Synthetic native parent + real TLS/broker/monitor notices, same-host MCP restart and 30 independent native hosts.

Runtime vendoring is exact Psst candidate `2de9cc3758b9fc593f5afca4fc501fd013d416ec`. Shared acceptance-journal
failure after a remote success reports an unknown effect, never known-not-applied.
Model retry/receipt keys remain private; message ID acknowledgment is still scoped
to a previously exposed exact inbox item. Native messaging calls abort and drain
before their journal closes; lifetime-control operations do not wait on themselves.

## Not established

Managed plugin-MCP suppression and authenticated native idle/busy/monitor acceptance remain external gates. Preflight is diagnostic, not a supported policy bypass or complete durable source-upgrade solution.

New outgoing history/content/resend/cancel routes require the matching Psst broker.
Older broker send/receive compatibility does not imply availability of new APIs.
These are local candidate results, not published registry versions, deployed code,
remote CI, authenticated-provider acceptance or a release. No permissions, managed
policy, accounts or production host configuration were changed.
