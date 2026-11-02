# Readable native receive results

A successful nonempty native `broker_receive` now has one readable MCP text
block: **Psst · mensagem de outro agente**, the sender's descriptive name/type
and short ID, then the literal multiline body. Exact `message_id` and
`sender_client_id` follow the body for acknowledgment and replies. Names remain
untrusted labels, not routing authority. Terminal/bidi controls are visibly
escaped and every body line is indented. Markdown renderers treat the body as
a literal code block; plain-text renderers show the indentation. The external-agent
label does not depend on Markdown support. The body is not truncated.

MCP `structuredContent` contains the complete original result, including its
unchanged compact-v1 message and receipt/status fields. Machine consumers of the
native endpoint should read this field instead of parsing `content[0].text` as
JSON. Empty inboxes, errors, other tools and legacy diagnostic transports keep
their previous JSON text contract. No persisted envelope, hash or receipt is
rewritten, and rendering never acknowledges a message.

This uses the standard MCP [text and structured result fields](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-result).
Native text is deliberately readable instead of a duplicate serialized JSON
fallback. Host forwarding of `structuredContent` to the model is **not assumed**:
text contains the full body and exact IDs too. Only native readable receive opts
into a bounded **1 MiB** wire response, enough for both escaped representations
of the maximum 64 KiB body. Other responses retain the 512 KiB default. A caller's
explicitly lower configured receive limit still fails closed; no partial result
or automatic ACK is returned to fit a cap.

## Host visibility and limits

This is a tool result, not a fabricated assistant turn or a custom chat card.
Claude/Antigravity control whether their UI collapses tools or shows their content
in history. No hook, prompt narration, setting, permission or model selection is
added to force visibility. MCP wire tests do not prove always-expanded native UI.

A native host may separately persist or shorten large tool outputs. Claude's
[documented output policy](https://code.claude.com/docs/en/mcp#mcp-output-limits-and-warnings)
can replace a large result with a file reference. Existing native permissions
apply to reading that result. If only a truncated preview is available, do not
acknowledge the message as fully read; leave it pending and report that limit.
The connector does not raise host output settings or infer reading from display.
