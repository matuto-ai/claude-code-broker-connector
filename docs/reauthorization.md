# Explicit reauthorization

Invoke `/psst:reauthorize https://broker.example` with the explicit HTTPS broker endpoint. The `/` autocomplete hint shows the required endpoint argument. Use a broker origin with an optional port and trailing `/`, not credentials, a path, query or fragment. A configured `broker_url` never supplies a missing argument.

Missing or malformed input returns `Usage: /psst:reauthorize <https://broker.example>` at the first skill gate, before tool calls or investigation, without a follow-up question or enrollment. Then the skill checks native tool availability and reads the configured origin once. A different origin reports `configured_broker_mismatch` and stops; broker switching is not supported. Equivalent host case, default port and trailing `/` normalize to the same HTTPS origin.

The valid explicit human command supplies target and replacement intent. After validating the matching endpoint, call `broker_setup({replace:true,expected_broker_url:endpoint})` once without another agent-generated target/replacement confirmation. If the human explicitly requested retrying an approved attachment instead of replacement, omit `replace`; reuse that choice without a second question. The handler independently validates the supplied origin before changing setup intent, candidate or activation state. Initial setup with `broker_setup({})` and saved reconnect remain unchanged. The primary workflow never reads or passes a credential.

Native MCP admission, PreToolUse, session guards and host-owned permission prompts remain authoritative. The command does not grant administrator approval at the broker or bypass a host denial. Missing tools do not permit another server, fake binding or model-supplied confirmation flag.

Workflow: human command with endpoint → endpoint/configured-target validation → one setup call → public request ID → broker administrator approves that ID at `/admin` → attachment and safe installation selection.

`outcome` distinguishes `pending`, `approved_not_connected` and `connected`. `connected` may describe old active access; `candidate_connected` describes the replacement. Working old access is retained while possible; revoked access is not claimed to work. Replacement does not revoke old credentials, and prior revocation is not required. Only the human administrator performs revocation in Psst admin.

Repeating the command resumes pending candidates after cancellation, restart or uncertain POST responses. A fresh valid reauthorization command requests replacement, including after an approved-but-not-connected result; an explicit human request to retry that approved attachment uses the same candidate without `replace`. An attachment/network error alone initiates neither path and never proves revocation.
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

The supported [skill frontmatter](https://code.claude.com/docs/en/skills#frontmatter-reference) provides `argument-hint` for autocomplete, and [argument substitution](https://code.claude.com/docs/en/skills#pass-arguments-to-skills) supplies the invocation input. Neither is an executable argument validator. This plugin uses a prompt-based first gate, not a claimed pre-model command rejection. The MCP handler validates endpoints deterministically before replacement mutation. Native permits prove the main session/tool call, not that an endpoint originated in a human command; no model-facing `confirmed` or `human_invoked` argument establishes that provenance. User-only skill invocation and its instructions remain the command-origin boundary; representative native-host/agent trials are still required to verify compliance.

Claude's newer [Mods API](https://code.claude.com/docs/en/plugins/mods/api#add-a-command)
provides native `command.run` and `tool.call` dispatch. Its installed-host
compatibility has not been verified here. We therefore do not install Mods,
require new host configuration or claim deterministic/token-free dispatch.
[Skill reference](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill).

## Verification boundary and command inventory

Tests exercise the real MCP setup handler behind native one-use permit admission, missing/forged native provenance and invented confirmation arguments, endpoint validation, pending-candidate reconciliation/cancellation, approval/attachment and old unread-data retention. Existing approval-session, attachment and native-lifetime fixtures cover uncertain POST recovery, failed attachment rollback, selection contention, cancellation and session races. Guidance checks verify the removed conversational branch, not live model compliance. These fixtures use disposable local state and simulated approval responses, not live credentials or admin operations.

For #44, record the candidate SHA, connector/Claude versions, command and tool trace from an authenticated native Claude session: valid matching command proceeds without another agent-generated question; invalid/missing/mismatched commands and host denial cannot replace access; pending repeat/cancellation retains the same request; approved attachment and failed-attachment recovery preserve selection and unread data. Distinguish administrator/host-owned prompts from conversational confirmation. No `claude` executable is on this session's PATH, so this behavioral evidence remains outstanding; unit wording and MCP fixtures do not substitute for it.

- `/psst:connect`: first setup or reconnect saved authorization; no automatic replacement.
- `/psst:disconnect`: disconnect this session, without revocation.
- `/psst:psst`: messaging guidance.
- `/psst:reauthorize <https-broker-endpoint>`: deliberate replacement approval at the supplied, matching configured target.
- `/mcp` → Reconnect: host MCP recovery, not new enrollment.

There is no dedicated `/psst:reconnect` alias. Cross-connector command standardization
is separate from this issue and is not claimed by this delivery.
