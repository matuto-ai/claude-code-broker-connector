# Explicit reauthorization

Invoke `/psst:reauthorize https://broker.example` with the explicit HTTPS broker endpoint. The `/` autocomplete hint shows the required endpoint argument. Use a broker origin with an optional port and trailing `/`, not credentials, a path, query or fragment. A configured `broker_url` never supplies a missing argument.

Missing or malformed input returns `Usage: /psst:reauthorize <https://broker.example>` at the first skill gate, before tool calls or investigation, without a follow-up question or enrollment. Then the skill checks native tool availability and reads the configured origin once. A different origin reports `configured_broker_mismatch` and stops; broker switching is not supported. Equivalent host case, default port and trailing `/` normalize to the same HTTPS origin.

After the endpoint gate, the existing target-specific confirmation/attachment-choice flow remains in place. The skill calls `broker_setup({replace:true,expected_broker_url:endpoint})`, or omits `replace` for an explicit retry of approved attachment. The handler independently requires a valid endpoint for replacement and validates any supplied endpoint against the configured origin before changing setup intent, candidate or activation state. Initial setup with `broker_setup({})` and saved reconnect remain unchanged. The primary workflow never reads or passes a credential. Native MCP tool admission, PreToolUse and session guards remain unchanged; missing tools are not bypassed by another server or fake binding.

An explicit human replacement request naming the exact configured origin already
satisfies the skill's intent check; do not ask it again. If target confirmation or
an approved-not-connected retry/new choice remains unresolved, combine them into
one concise question. Native policy may still require its own confirmation.
Do not ask whether to perform the slash command itself.

Workflow: command with endpoint → validate endpoint and configured target → reuse/obtain target confirmation → public request ID → administrator
approves that ID at `/admin` → attachment and safe installation selection.
`outcome` distinguishes `pending`, `approved_not_connected` and `connected`.
`connected` may describe old active access; `candidate_connected` describes the
replacement. Working old access is retained while possible; revoked access is not
claimed to work. Replacement does not revoke old credentials, and prior revocation
is not required. Only the human administrator performs revocation in Psst admin.

Repeating the command resumes pending candidates after cancellation, restart or
uncertain POST responses. For approved-but-not-connected candidates, the owner chooses retry attachment
(without replace) or a new approval (replace:true), including when that candidate
was revoked before attachment. Errors alone never prove revocation.
An explicit retry may resend POST with the same durable request ID/key when
the initial POST never reached the broker; automatic resume/polling stays GET-only.
`broker_setup_cancel` stops this session's intent only; the durable candidate stays.
`broker_setup_status` reads state without enrollment. Host polling, not a model
loop, watches approval. Selection races retain the previous selection and old
journals/unread messages. New credential-bound addresses never replay old messages.
Preserve files and locks; do not delete state to recover. A mismatched target stops the invocation; do not retry or substitute another broker. No startup, reconnect, network-failure or peer-driven enrollment.

## Host dispatch and tokens

This release uses the same supported plugin-skill mechanism as `/psst:connect`.
A skill is a fixed instruction prompt executed by Claude: invocation and tool
calls consume a model turn. `disable-model-invocation: true` makes it user-only,
not token-free. The owner accepted this trade-off for command discoverability.

The supported [skill frontmatter](https://code.claude.com/docs/en/skills#frontmatter-reference) provides `argument-hint` for autocomplete, and [argument substitution](https://code.claude.com/docs/en/skills#pass-arguments-to-skills) supplies the invocation input. Neither is an executable argument validator. This plugin uses a prompt-based first gate, not a claimed pre-model command rejection. The MCP handler provides deterministic validation before replacement mutation, but cannot prove that the model obtained its endpoint from the human's invocation. A native-host trial is still needed for that behavior.

Claude's newer [Mods API](https://code.claude.com/docs/en/plugins/mods/api#add-a-command)
provides native `command.run` and `tool.call` dispatch. Its installed-host
compatibility has not been verified here. We therefore do not install Mods,
require new host configuration or claim deterministic/token-free dispatch.
[Skill reference](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill).

## Verification boundary and command inventory

Tests exercise MCP schema/dispatch with fixed arguments and native admission,
skill packaging/instructions, endpoint validation, local approval planning, pending retries,
cancellation, failed attachment, and selection races. These lightweight tests do
not represent a live Claude session or live broker authentication. No credentials
or admin operations are changed by verification.

- `/psst:connect`: first setup or reconnect saved authorization; no automatic replacement.
- `/psst:disconnect`: disconnect this session, without revocation.
- `/psst:psst`: messaging guidance.
- `/psst:reauthorize <https-broker-endpoint>`: deliberate replacement approval at the supplied, matching configured target.
- `/mcp` → Reconnect: host MCP recovery, not new enrollment.

There is no dedicated `/psst:reconnect` alias. Cross-connector command standardization
is separate from this issue and is not claimed by this delivery.
