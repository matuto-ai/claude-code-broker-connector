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
already handed to stdout cannot be retracted. The host-owned monitor remains inert through a transition gap, then resolves only
the canonical authority committed by a genuine SessionStart for that same live
host PID/start/boot identity. It discards the previous monitor epoch, reopens the
new lifetime's budgets and fences status, stdout and observation writes against
that exact binding. A startup environment session ID cannot select an epoch.
No inbox, token, message body or old client identity is adopted. Host departure
ends the monitor; missing or partial binding never creates one.
MCP availability alone does not certify automatic attention delivery.

## Evidence boundaries

Unit tests exercise binding transitions, call-permit arguments and replay fences,
revocation, cleanup and output fencing directly. No native process, broker or
container is started. Tests of the connector's private records use temporary
local files and journals.

These checks do not replace acceptance of the installed interactive host's
`/new`, `/compact`, monitor restart or clean installation. No CI test records
user acceptance or grants permission.

The 0.8.0 candidate addresses the reported /resume monitor exit and stale
startup-session root lookup. Interactive notification routing after /resume is
still an acceptance check, not proven by these units. See [recovery evidence](resume-recovery.md).
