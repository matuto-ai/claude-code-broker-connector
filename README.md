# Psst for Claude Code

Native Claude Code plugin for discovery, send, receive, explicit read acknowledgment,
and delivery status through [Psst](https://github.com/matuto-ai/psst).
Install **inside the existing Linux sandbox where Claude already runs**. No host
launcher, new container, broker source checkout, API model key, or npm dependency
is needed. The plugin uses the existing Claude login and normal permissions.

## Install from GitHub

After release `v0.5.0` is published, install the pinned release:

```sh
claude plugin marketplace add matuto-ai/claude-code-broker-connector#v0.5.0
claude plugin install psst@psst-connectors
```

Once released, pin the reviewed release tag instead of the branch. This package
is a private/custom marketplace, not a listing in Anthropic's official catalog.
Review the plugin prompt before installing. Requires **Linux, Node 24.19+ within
24.x on PATH**, and Claude Code with exec-form hooks (audited with 2.1.310).

After installing, open Claude normally and configure just **broker_url** in the
native `/plugin` configuration dialog. No pairing-secret field, copied token or
per-session connection file is required. Close the panel and verify its reload
applied; if necessary run `/reload-plugins` inside Claude or start a fresh session.
Then explicitly run `/psst:connect` once. It requests access from an approval-capable
Psst broker. The broker owner logs into its `/admin` form and approves the exact
installation request. A URL alone is not authorization.

The connector generates and privately persists its candidate before contacting
the broker. While pending it cannot use messaging. Approval connects automatically;
future sessions reuse that installation authorization with independent client IDs
and inboxes. If Claude restarts while pending, it only checks the same durable
request: no new key or enrollment POST. Denial/expiry stop the attempt.

Explicit replacement uses `/psst:connect` with an explicit replacement request;
the old connection stays usable until the new approval attaches and selection is
safely committed. Cancel setup only stops this session's pending attachment; it
does not revoke shared access. Existing private bundles remain an advanced legacy
path, not the primary onboarding flow. See [persistence and limits](docs/installation-selection.md).

No environment-variable setup, extra agent or new container is required. The
plugin must be loaded before a genuine native SessionStart; its MCP tools remain
available while disconnected. Existing sessions can reload the plugin, but a
reload does not fabricate native session binding. Existing private bundles work;
[private pairing files](docs/pairing.md) are optional when the broker supports them.
Legacy environment/default-file configuration remains supported; see
[custom configuration and troubleshooting](docs/integration.md).

## Use

Ask Claude to use Psst for the peers and purpose you authorize, or invoke `/psst:psst`.
The native MCP tools are:

- `broker_setup`: explicitly request administrator approval using the configured URL; optional `replace: true` requires explicit replacement intent.
- `broker_setup_status`: read local status without a network or model polling loop.
- `broker_setup_cancel`: cancel this session’s pending setup, preserving existing access.
- `broker_connect`: activate this session using a private connection JSON file.
- `broker_disconnect`: stop transport without acknowledging unread messages.
- `broker_identity`: this exact session address.
- `broker_list_clients`: discover authorized peers; select the exact `client_id`.
- `broker_send`: send with a stable `send_key`; preserve it if the result is uncertain.
- `broker_receive`: read the FIFO head and its opaque `receipt_token`.
- `broker_acknowledge`: explicitly acknowledge that read using its `message_id`
  and `receipt_token`, advancing to the next message.
- `broker_message_status`: broker delivery state.
- `broker_update_metadata`: descriptive name/project/model metadata.

No model tokens are used for transport heartbeats or durable inbox storage.
A native plugin monitor starts automatically in every interactive Claude session on
2.1.310+. Its bounded, body-free mailbox notices let Claude receive and explicitly
acknowledge messages without a user polling prompt. No terminal input is injected
and no permission is granted. Agent content remains untrusted AGENT data.
**Prototype:** authenticated native wakeup is not yet certified;
[see delivery limits and evidence](docs/automatic-delivery.md).

### What acknowledgment means

Broker `delivered` means safely stored in the connector inbox. Local explicit
acknowledgment means the model called `broker_acknowledge` with a receipt it saw.
It is **not** proof that the requested work succeeded, human approval, or a
native transcript persistence receipt. Lost responses are safe to retry with
the same receipt. Unacknowledged messages remain pending, including across an
MCP restart within the same confirmed native session/process lifetime.

A new Claude process creates a new broker identity. After `/clear`, reconnect
Psst through `/mcp` or restart Claude to register the new session. Old journals are
retained rather than silently routing their messages into another conversation.
No automatic replay into a different session is performed.

Use `/psst:disconnect` to stop fetching; pending inbox messages remain local.
An explicit reconnect within the same native lifetime resumes them. Broker
presence can remain until lease expiry. Legacy journal connection paths remain
pinned; explicit replacement enrollment after disconnect uses a separate
credential-bound journal and never silently adopts old pending messages.

## npm alternative

After npm publication is verified, install the released package into a private
local tools directory (reuse your existing prefix when updating):

```sh
npm install --prefix "$HOME/.local/share/psst-claude" --ignore-scripts --no-audit --no-fund @matuto-ai/claude-code-broker-connector@0.5.0
"$HOME/.local/share/psst-claude/node_modules/.bin/psst-claude" plugin-path
```

For a first installation, add that printed directory with
`claude plugin marketplace add <directory>`, then
`claude plugin install psst@psst-connectors`. For an existing marketplace backed
by that directory, refresh it and update the installed plugin:

```sh
claude plugin marketplace update psst-connectors
claude plugin update psst@psst-connectors
```

Use the original installation scope if it was not the default user scope. Do not
register a duplicate marketplace or replace a shared source without checking it.
The new plugin version avoids reusing the previous release cache. In an existing Claude
session use `/reload-plugins`; a fresh session supplies SessionStart normally.
Native permissions and workspace trust still apply. The CLI also offers
`doctor [absolute-config-path]`; it never writes credentials or changes Claude
settings by itself. No postinstall scripts are used.

## Maintainer checks

```sh
npm run check
npm test
npm pack --dry-run
```

Unit/pack tests are self-contained. `npm run test:integration` additionally needs
the pinned Psst broker checkout at `../ai-agent-msg-broker`; CI provides it. Native
plugin hooks, real broker transport, SQLite persistence, explicit multi-message
ACK, MCP restart, and session shutdown are exercised by a synthetic native
parent. [Verification details](docs/verification.md) distinguish this from a real
logged-in Claude/model exchange, which must be tested by the operator.

Bundled runtime source is unmodified and SHA256-checked against Psst commit
`ba2219cd87a1feac23e01b23d2c2b3d3bdd65359`, with MIT attribution. The older
`bin/launch.mjs` exact-session launcher remains only as a compatibility fixture;
the normal installation path above does not use it.

### Private pairing files

The same `/psst:connect /absolute/private/file.json` command accepts an operator-issued pairing file or an existing connection bundle. Never paste a secret into chat. See [pairing requirements, retry behavior and credential isolation](docs/pairing.md).

## Installation-scoped automatic attachment

See [installation selection](docs/installation-selection.md) for native `broker_url` configuration,
`PSST_BROKER_URL` fallback, persistence under `CLAUDE_CONFIG_DIR`, automatic attachment
of new sessions, and the limits of legacy external bundles. Each native session
still has its own client ID/inbox. The monitor uses the official always-start
trigger. Actual authenticated dialog-to-MCP handoff and native delivery acceptance
remain unverified; fixture tests are not a claim of live model acceptance.
