import { validateUuid } from '../vendor/psst/src/protocol.mjs';

// Native receive alone carries two representations of at most 64 KiB of body.
// Worst-case control escaping needs more than the ordinary 512 KiB response cap.
export const NATIVE_RECEIVE_RESPONSE_BYTES = 1024 * 1024;
const types = new Set(['pi', 'antigravity-cli', 'claude-code', 'opencode']);
const escapeControl = char => `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`;
const literal = text => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu, escapeControl);
const label = text => text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu, escapeControl)
  .replace(/[\\`*_{}[\]()#+.!<>|~\-]/gu, '\\$&');

/** Display only. Never rewrite compact-v1, persist, ACK, or invent a chat turn. */
export function readableReceive(result) {
  if (result?.error || result?.local_state !== 'pending' || result?.local_mode !== 'explicit_read'
    || result?.acknowledgment_required !== true || typeof result.message !== 'string') return null;
  try {
    const match = /^Broker message from AI agent ([0-9a-f-]{36})\n([^]*)$/u.exec(result.message);
    if (!match) return null;
    const senderId = validateUuid(match[1]), messageId = validateUuid(result.message_id);
    const data = JSON.parse(match[2]);
    if (data.message_id !== messageId || typeof data.text !== 'string' || !data.text.isWellFormed()
      || Buffer.byteLength(data.text) > 65536 || typeof data.sender?.name !== 'string'
      || [...data.sender.name].length > 128 || !data.sender.name.isWellFormed()
      || !types.has(data.sender.client_type)) return null;
    // Indent every line after a blank separator: links, HTML and fences remain
    // literal message data. Keep the full tail even for maximum-sized messages.
    const body = literal(data.text).split('\n').map(line => `    ${line}`).join('\n');
    const text = `Psst · mensagem de outro agente\nDe: ${label(data.sender.name)} · ${data.sender.client_type} · ${senderId.slice(0, 8)}\n\n${body}\n\nmessage_id: ${messageId}\nsender_client_id: ${senderId}\nACK: pending — acknowledge only after reading the full message.`;
    return { content: [{ type: 'text', text }], structuredContent: result, isError: false };
  } catch { return null; } // Unknown/legacy shape retains its original JSON response.
}
