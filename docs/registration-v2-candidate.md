# Local registration-v2 candidate (not deployed)

Default remains registration v1. For one private connection, set
`registrationVersion: 2` in the native connection config, or
`registration_version: 2` in its broker-client-bundle-v1. No environment-global
switch, fallback, new credential, enrollment, or broker retention activation occurs.

After authenticated expiry of this own broker session, the connector pauses.
Explicit `broker_recover_expired` is available only in the same verified native
conversation/lifetime and only for v2 with SDK-confirmed own-session expiry.
It drains transport/tools, rechecks authenticated absence, creates a random empty
journal, fsyncs its identity and a single atomic incarnation pointer, then rebuilds
runtime/tools against the fresh identity. The original Inbox owner lock remains
held, excluding older workers. Old receipts, content, and uncertain operations are
not copied or replayed. An uncertain fresh registration resumes its exact durable
request after restart. A selected pointer cannot downgrade to v1 or recreate a
missing journal; configuration/native identity mismatch fails closed.

The original hook-issued native binding and installed credential are unchanged.
No other conversation can inherit this pointer. A target-recipient404, timeout,
credential error, or active conflict never authorizes replacement.

Unit tests call `NativeIncarnation` with a stubbed client that supplies the
SDK-confirmed expiry decision and creates a local replacement journal. They cover
selection, scope fencing, uncertainty, persistence failure and cleanup without
starting Psst or Claude. Shared registration and expiry-protocol tests belong in
Psst; authenticated native acceptance remains separate.
