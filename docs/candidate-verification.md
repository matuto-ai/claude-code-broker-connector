# Candidate verification and remaining gates

The current automatic checks are syntax validation and focused connector unit
tests. See [verification](verification.md) for the commands and scope. Historical
integration/native/container results are not part of the maintained test suite.

Issue #11 remains open for managed installation and authenticated native automatic
delivery. Unit tests cannot establish the user's effective plugin policy, actual
MCP attachment, or idle/busy/typing delivery to a logged-in model.

New outgoing history/content/resend/cancel routes require a matching Psst broker.
Older send/receive compatibility does not imply availability of new APIs.
A passing test run is not an npm publication, deployment or live acceptance receipt.
