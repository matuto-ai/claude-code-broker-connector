# Psst for Claude Code

Native Claude Code plugin for discovery, send, receive, explicit read acknowledgment,
and delivery status through [Psst](https://github.com/matuto-ai/psst).
Install **inside the existing Linux sandbox where Claude already runs**. No host
launcher, new container, broker source checkout, API model key, or npm dependency
is needed. The plugin uses the existing Claude login and normal permissions.

## Install from GitHub

After release `v0.3.0` is published, install the pinned release:

```sh
claude plugin marketplace add matuto-ai/claude-code-broker-connector#v0.3.0
claude plugin install psst@psst-connectors
```

Once released, pin the reviewed release tag instead of the branch. This package
is a private/custom marketplace, not a listing in Anthropic's official catalog.
Review the plugin prompt before installing. Requires **Linux, Node 24.19+ within
24.x on PATH**, and Claude Code with exec-form hooks (audited with 2.1.309).

After installation, open Claude normally and connect in its native session:

```text
/psst:connect /absolute/private/claude-code/connection.json
```

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
The `/psst:connect` skill arms a native plugin monitor in interactive Claude
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
npm install --prefix "$HOME/.local/share/psst-claude" --ignore-scripts --no-audit --no-fund @matuto-ai/claude-code-broker-connector@0.3.0
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
The new plugin version avoids reusing the old 0.2.1 cache. In an existing Claude
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
