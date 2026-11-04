# Explicit reauthorization

`/psst:reauthorize` appears as a user-invoked native plugin skill. It previews the
configured `broker_url`, asks for target-specific owner confirmation, and calls
`broker_setup({replace:true,expected_broker_url:origin})`. The expected HTTPS origin
is checked before any mutation. The primary workflow never reads or passes a
credential. Normal native MCP tool admission, PreToolUse and session guards remain
unchanged. Missing native tools are not bypassed by another server or fake binding.

Workflow: command → confirm displayed broker → public request ID → administrator
approves that ID at `/admin` → attachment and safe installation selection.
`outcome` distinguishes `pending`, `approved_not_connected` and `connected`.
`connected` may describe old active access; `candidate_connected` describes the
replacement. Working old access is retained while possible; revoked access is not
claimed to work. Replacement does not revoke old credentials, and prior revocation
is not required. Only the human administrator performs revocation in Psst admin.

Repeating the command resumes pending candidates after cancellation, restart or
uncertain POST responses. An approved candidate not yet selected retries attachment.
`broker_setup_cancel` stops this session's intent only; the durable candidate stays.
`broker_setup_status` reads state without enrollment. Host polling, not a model
loop, watches approval. Selection races retain the previous selection and old
journals/unread messages. New credential-bound addresses never replay old messages.
Preserve files and locks; do not delete state to recover. Changed target requires
new confirmation. No startup, reconnect, network-failure or peer-driven enrollment.

## Host dispatch and tokens

This release uses the same supported plugin-skill mechanism as `/psst:connect`.
A skill is a fixed instruction prompt executed by Claude: invocation and tool
calls consume a model turn. `disable-model-invocation: true` makes it user-only,
not token-free. The owner accepted this trade-off for command discoverability.

Claude's newer [Mods API](https://code.claude.com/docs/en/plugins/mods/api#add-a-command)
provides native `command.run` and `tool.call` dispatch. Its installed-host
compatibility has not been verified here. We therefore do not install Mods,
require new host configuration or claim deterministic/token-free dispatch.
[Skill reference](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill).

## Verification boundary and command inventory

Tests exercise MCP schema/dispatch with fixed arguments and native admission,
skill packaging/instructions, local approval planning, pending retries,
cancellation, failed attachment, and selection races. These lightweight tests do
not represent a live Claude session or live broker authentication. No credentials
or admin operations are changed by verification.

- `/psst:connect`: first setup or reconnect saved authorization; no automatic replacement.
- `/psst:disconnect`: disconnect this session, without revocation.
- `/psst:psst`: messaging guidance.
- `/psst:reauthorize`: deliberate replacement approval with the confirmed target.
- `/mcp` → Reconnect: host MCP recovery, not new enrollment.

There is no dedicated `/psst:reconnect` alias. Cross-connector command standardization
is separate from this issue and is not claimed by this delivery.
