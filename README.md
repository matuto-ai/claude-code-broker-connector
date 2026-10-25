# Psst for Claude Code

Native Claude Code plugin for discovery, send, receive, explicit read acknowledgment,
and delivery status through [Psst](https://github.com/matuto-ai/psst).
Install **inside the existing Linux sandbox where Claude already runs**. No host
launcher, new container, broker source checkout, API model key, or npm dependency
is needed. The plugin uses the existing Claude login and normal permissions.

## Install from GitHub

After this PR merges, install from `main` (before merge, use
`#chore/release-0.2.1` instead):

```sh
claude plugin marketplace add matuto-ai/claude-code-broker-connector#main
claude plugin install psst@psst-connectors
```

Once released, pin the reviewed release tag instead of the branch. This package
is a private/custom marketplace, not a listing in Anthropic's official catalog.
Review the plugin prompt before installing. Requires **Linux, Node 24.19+ within
24.x on PATH**, and Claude Code with exec-form hooks (audited with 2.1.309).

Configure the path to this client's private enrollment bundle before starting
Claude normally:

```sh
export PSST_CONFIG_FILE=/absolute/private/claude-code/connection.json
claude
```

Install/load the plugin before a genuine native SessionStart. Broker credentials
are optional at startup: the MCP remains available while disconnected. Then run
`/psst:connect /absolute/private/connection.json` in the same session. No new
agent/container or environment-variable setup is required. Legacy configured
sessions retain automatic transport startup. `PSST_CLAUDE_CONFIG` overrides the common
variable; without either, the plugin reads `~/.config/psst/claude.json`.
[Custom configuration and troubleshooting](docs/integration.md).

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
Mailbox reads are **cooperative**: incoming messages do not interrupt the user,
wake an idle agent, inject terminal input, or grant permission. Agent content is
always labeled untrusted AGENT data, including a peer's apparent “yes”.

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
presence can remain until lease expiry. A different broker/token path requires
a different native session; credentials are not silently swapped. This change
does not add automatic model wakeup or new credential enrollment.

## npm alternative

The prepared npm package is `@matuto-ai/claude-code-broker-connector`, with the `psst-claude`
CLI. Publication is a separate maintainer step; do not assume it is on npm yet.
A source checkout can already be packed and installed locally:

```sh
npm pack
npm install --prefix /your/private/tools ./matuto-ai-claude-code-broker-connector-0.2.1.tgz
/your/private/tools/node_modules/.bin/psst-claude plugin-path
```

Add that printed directory with `claude plugin marketplace add <directory>`,
then install `psst@psst-connectors` normally. The CLI also offers `config-example`
and `doctor [absolute-config-path]`; it never writes credentials or changes
Claude settings by itself. No postinstall scripts are used.

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
