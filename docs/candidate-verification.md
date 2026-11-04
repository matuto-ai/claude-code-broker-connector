# Candidate verification and deferred integration

The current automatic checks are syntax validation and focused connector unit
tests. See [verification](verification.md) for the commands and scope. Historical
integration/native/container results are not part of the maintained test suite.

On 2026-11-04 the owner removed real-environment and integrated tests from issue
#11's current acceptance. The functional requirements remain: URL-only durable
approval, same-request recovery, private persistent selection, independent native
lifetimes, cancellation/replacement safety, bounded automatic notices and honest
installation/capability diagnostics. Source review and focused unit CI establish
the current acceptance; no product restriction is relaxed to obtain a pass.

Later testing on the owner's machine will check installation/upgrade, effective
plugin policy, actual MCP attachment, logged-in idle/busy/typing delivery,
concurrency and container recreation. These remain unverified, but they do not
block this issue's source acceptance. Unit results are not live-host evidence.
Package publication and deployment remain separate owner-managed work.

New outgoing history/content/resend/cancel routes require a matching Psst broker.
Older send/receive compatibility does not imply availability of new APIs.
A passing test run is not an npm publication, deployment or live acceptance receipt.
