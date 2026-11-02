# Native conversation lifetime boundaries

The host MCP transport and one conversation's broker identity have different
lifetimes. A verified native SessionStart establishes the conversation binding.
A new conversation retires the old runtime before attaching saved approved
configuration. SessionEnd may leave a gap with no admitted broker calls; it does
not require closing the host transport. Same-session compaction retains state
only when the native lifetime is unchanged.

Native PreToolUse injects a private, one-use call marker tied to the actual native
session, lifetime, tool-use ID and exact arguments. It does not return an allow
decision: Claude's normal permissions still apply. A model-supplied marker is
replaced, never trusted. Repeated native tool-use IDs cannot create a fresh intent
or refresh the original retry window. Markers expire after ten minutes on the
same boot's monotonic clock; an expired or consumed marker is rejected, not
reissued. A full lifetime ledger fails closed rather than evicting replay fences.
The private files coordinate same-user native processes, not a security boundary
against arbitrary programs running as that operating-system user.

On transition, admission is revoked synchronously. Ordinary calls, setup,
pairing, approval callbacks and startup work drain before a new epoch opens.
If retirement cannot complete, the new epoch remains blocked. Accepted effects
and uncertain receipts stay in the original journal. No automatic resend,
acknowledgment, credential replacement or new enrollment is performed.

Immediately before queued output is handed to stdout, a stale response becomes a
body-free session-change error. This protects output not yet written; bytes
already handed to stdout cannot be retracted. An old monitor exits rather than
following another session; the new native monitor must establish its own binding.
MCP availability alone does not certify automatic attention delivery.

## Evidence boundaries

The integrity-pinned official Claude Code 2.1.310 probe uses an account-free
loopback provider in a network-disabled container. It verifies actual native
hook-to-MCP input replacement without an allow decision and preservation of an
explicit native denial. Synthetic native lifecycle tests use real HTTP broker,
MCP transport and private journals to exercise compaction, new lifetimes,
accepted-but-delayed old sends and saved installation attachment.

These checks do not replace acceptance of the installed interactive host's
`/new`, `/compact`, monitor restart or clean installation. Their evidence is
reported separately; no CI test records user acceptance or grants permission.
