# Focused connector verification

Run from this checkout with Node 24.19.0 or later in the Node 24 line:

```sh
npm run check
npm test
```

There are no test dependencies to install. `check` parses the connector, tests
and vendored runtime. `test` uses Node's built-in test runner.

## Unit scope

The suite exercises connector-owned decisions and failure handling:

- Approval polling, cancellation, selection rollback and private configuration.
- Native binding and lifetime fences, one-use call permits and cleanup.
- Incarnation selection and recovery with a stubbed broker collaborator.
- Explicit receive/ACK presentation, hostile-text escaping and MCP argument bounds.
- Durable reminder budgets and transport-notice read/ACK state.
- Project metadata, source integrity and sanitized installation diagnostics.

Tests call modules directly with injected collaborators or in-memory streams.
Temporary private files and SQLite journals cover this connector's own persistence;
they do not start a broker, network listener or child process. Tests for the shared
Psst server and protocol belong in Psst, not in this repository.

No Psst sibling checkout, Docker, official Claude binary, provider account,
credentials or network access is required. The old integration, native-host,
container, package-install and end-to-end harnesses have been removed rather than
hidden behind optional flags.

## CI and packaging

The existing `verify` job runs only syntax checks and unit tests, with a three-minute
timeout. The release workflow checks the tag/version, runs those same commands,
packs the checked source once and records its SHA-256. Its separate publication
job checks that receipt and publishes the same tarball without rebuilding it.
Local `npm pack` still runs syntax checks and unit tests through `prepack`.

Passing unit tests establishes the covered connector behavior. It does not prove
native installation, authenticated model delivery, or a live user's environment.
On 2026-11-04 the owner deferred those real-environment checks to a later integrated
test on their machine, removing them from issue #11's current acceptance. The
functional requirements, independent source review and unit CI remain required.
See [managed installation](managed-native-installation.md).
