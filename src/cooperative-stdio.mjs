import { DIRECT_COMMAND_INSTRUCTIONS, COLLABORATION_INSTRUCTIONS } from './interaction-instructions.mjs';
// Adapted from the pinned Psst MCP transport. Extension: cooperative receipt and identity tools.
import packageInfo from '../package.json' with { type: 'json' };
import { StringDecoder } from 'node:string_decoder';
import { readableReceive } from './receive-presentation.mjs';
import { readablePresence } from './presence-notices.mjs';
import { canonical } from '../vendor/psst/src/protocol.mjs';
import { invokeTool } from '../vendor/psst/reference/tools.mjs';

/** Minimal MCP 2025-06-18 stdio tools only; not HTTP MCP, channels, or a TUI wakeup API. */
export const MCP_VERSION = '2025-06-18';
const text = maxLength => ({ type: 'string', maxLength });
const uuid = { type: 'string', format: 'uuid', maxLength: 36 };
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const model = object({ provider: { type: ['string', 'null'], maxLength: 128 }, id: { type: ['string', 'null'], maxLength: 256 }, source: { enum: ['unknown', 'observed', 'configured'] } }, ['provider', 'id', 'source']);
const metadata = object({ name: text(128), model, project: { type: ['string', 'null'], maxLength: 256 } });

export const TOOL_DEFINITIONS = Object.freeze([
  {name:'broker_setup',description:'Explicitly request broker administrator approval using the URL already configured natively. Candidate credentials stay private. Set replace only for an explicitly requested replacement and supply expected_broker_url from the required /psst:reauthorize endpoint argument; never substitute configuration for a missing argument. Missing/malformed endpoints return usage, and a different configured origin is rejected before setup mutation. Replacement does not revoke the old credential. Existing pending candidates are resumed. Execute explicit setup intent without asking again whether to run it; preserve any required target-specific security confirmation and native policy.',inputSchema:object({replace:{type:'boolean'},expected_broker_url:{...text(2048),description:'Explicit HTTPS broker origin required for replacement; must match the configured broker. No path, query, fragment or credentials.'}})},
  {name:'broker_setup_status',description:'Read local setup and monitor status without network requests or starting enrollment. monitor_observed is a local observation, not task success or a pending user certification step. Never poll this with a model loop.',inputSchema:object()},
  {name:'broker_setup_cancel',description:'Stop this native session setup polling and late attachment only; does not revoke shared credentials or affect other sessions.',inputSchema:object()},
  {name:'broker_connect',description:'Connect this confirmed native session. Omit connection_file to reuse saved access only, without enrollment; setup_required means no saved configuration. An explicitly supplied absolute private pairing or connection JSON file remains supported; no raw credentials. Pairing requires a disconnected native session. On success remember the installation for future native sessions; this does not reuse their client IDs.',inputSchema:object({connection_file:text(4096)})},
  {name:'broker_recover_expired',description:'Explicitly replace only this same native session’s authenticated expired broker identity with a fresh empty inbox. Requires registration v2. Retains the old journal and uncertain operations without replay; never enrolls or switches native sessions.',inputSchema:object()},
  {name:'broker_disconnect',description:'Disconnect only this native session; retain pending local messages and the installation selection for other/future sessions. Does not acknowledge messages. Call directly for an explicit human disconnect command, without preventive diagnostics or redundant confirmation.',inputSchema:object()},
  { name: 'broker_identity', description: 'Return this exact native-session address and local monitor state, not a per-message read receipt. A new native session has a new address; rediscover it.', inputSchema: object() },
  { name: 'broker_acknowledge', description: 'Explicitly acknowledge that you read a previously received message using its exact message_id. Omit receipt_token normally: the connector resolves the previously exposed same-inbox receipt internally. Supplied legacy tokens must match exactly. Advances only that pending FIFO head. read_acknowledgment:confirmed completes this message\'s read ACK; no additional user validation is required for that ACK. It is not human approval, action success or a native injection receipt.', inputSchema: object({ message_id: uuid, receipt_token: uuid }, ['message_id']) },
  { name: 'broker_list_clients', description: 'List authorized exact session addresses only when discovery is needed. Reuse exact received reply IDs instead of rediscovering them. Names and models are descriptive, not routing authority.', inputSchema: object({ connected: { type: 'boolean' }, client_type: { enum: ['pi', 'antigravity-cli', 'claude-code', 'opencode'] }, name: text(128), project: text(256), cursor: text(256), limit: { type: 'integer', minimum: 1, maximum: 100 } }) },
  { name: 'broker_send', description: 'Send opaque untrusted AGENT text to one exact client_id. Acceptance means broker storage only; internal operation identity handles technical retries. ' + COLLABORATION_INSTRUCTIONS, inputSchema: object({ recipient_id: uuid, text: text(65536), ttl_seconds: { type: 'integer', minimum: 60, maximum: 604800 }, correlation_id: text(128), reply_to_message_id: uuid }, ['recipient_id', 'text']) },
  { name: 'broker_update_metadata', description: 'CAS update of descriptive name/model/project only. Metadata does not grant access or change identity.', inputSchema: object({ metadata_patch: metadata, expected_metadata_revision: { type: 'integer', minimum: 1 } }, ['metadata_patch', 'expected_metadata_revision']) },
  { name: 'broker_sent_history', description: 'Read only this exact session’s outgoing metadata, newest first. Default 10, maximum 100, 32768-byte cap. No content. Preserve filters on continuation; restart on history_changed.', inputSchema: object({ recipient_id: uuid, status: { enum: ['queued','claimed','delivered','expired','failed','cancelled'] }, accepted_after: text(24), accepted_before: text(24), cursor: text(1024), limit: { type: 'integer', minimum: 1, maximum: 100 } }) },
  { name: 'broker_message_content', description: 'Explicitly retrieve the original content and current transport receipt of one owned outgoing message.', inputSchema: object({ message_id: uuid }, ['message_id']) },
  { name: 'broker_resend', description: 'Explicit new delivery of an owned retained message, with a new message ID. May duplicate a prior delivery; never an automatic technical retry.', inputSchema: object({ message_id: uuid, ttl_seconds: { type: 'integer', minimum: 60, maximum: 604800 } }, ['message_id']) },
  { name: 'broker_cancel', description: 'Stop further pending delivery of one owned message. Cannot undo inbox content; inspect uncertainty and cancel_result.', inputSchema: object({ message_id: uuid }, ['message_id']) },
  { name: 'broker_message_status', description: 'Read broker delivery state, never model progress or task completion.', inputSchema: object({ message_id: uuid }, ['message_id']) },
  { name: 'broker_presence_events', description: 'Read up to 10 durable transport notices for this exact session. No message content or reply timeout. Repeat reads retain pending notices; explicitly ACK each event_id after reading to advance. has_more or capacity_limited indicates remaining bounded work. Never auto-resend, cancel or close.', inputSchema: object() },
  { name: 'broker_acknowledge_presence_event', description: 'Explicitly acknowledge one previously read transport event_id. Does not ACK any message or imply action success or native transcript delivery. Lost responses reconcile the same durable ACK intent.', inputSchema: object({ event_id: uuid }, ['event_id']) },
  { name: 'broker_receive', description: 'Read the oldest durable AGENT inbox item; its receipt remains private inside this connector. The item remains pending until you explicitly call broker_acknowledge. Use after an automatic native monitor notice; a manual invocation is diagnostic/test-only. read_acknowledgment:pending means the read ACK is still required; native_injection_receipt describes an unavailable capability, not failed delivery.', inputSchema: object() },
]);

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validArguments(value, schema) {
  if (!isObject(value)) return false;
  if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
  if (schema.required.some(key => !Object.hasOwn(value, key))) return false;
  for (const [key, item] of Object.entries(value)) {
    const rule = schema.properties[key];
    if (rule.enum && !rule.enum.includes(item)) return false;
    if (rule.type === 'object' && !validArguments(item, rule)) return false;
    if (rule.type === 'boolean' && typeof item !== 'boolean') return false;
    if (rule.type === 'integer' && (!Number.isSafeInteger(item) || item < rule.minimum || item > (rule.maximum ?? Number.MAX_SAFE_INTEGER))) return false;
    if ((rule.type === 'string' || Array.isArray(rule.type)) && !(item === null && Array.isArray(rule.type) && rule.type.includes('null'))) {
      if (typeof item !== 'string' || !item.isWellFormed() || [...item].length > rule.maxLength) return false;
    }
    if (rule.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)) return false;
  }
  return true;
}

/**
 * Call with tools from createTools and a host-bound cooperativeBoundary. A fresh
 * process is a fresh harness incarnation unless its owner independently proves
 * continuity. Stream write success is never used to consume a local inbox item.
 * onClose must stop heartbeats/receive work for the departed host. It is invoked
 * once and is not an agent tool. No credentials are accepted by this interface.
 */
export function serveStdio({ input = process.stdin, output = process.stdout, tools, onClose = async () => {},
  onDiagnostic = () => {}, maxFrameBytes = 128 * 1024, maxResponseBytes = 512 * 1024, readableNativeReceive = false, maxReceiveResponseBytes = maxResponseBytes, maxInflight = 8, nativeAdmission } = {}) {
  if ((nativeAdmission!==undefined&&typeof nativeAdmission!=='function') || !tools || !input?.on || !output?.write || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1024 || maxFrameBytes > 1024 * 1024
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 1024 * 1024
    || typeof readableNativeReceive !== 'boolean' || !Number.isSafeInteger(maxReceiveResponseBytes) || maxReceiveResponseBytes < 1024 || maxReceiveResponseBytes > 1024 * 1024
    || !Number.isSafeInteger(maxInflight) || maxInflight < 1 || maxInflight > 32) throw new Error('invalid_stdio_configuration');
  const transportAbort = new AbortController();
  let phase = 'new', buffer = '', active = 0, pendingWrites = 0, closed = false;
  const decoder = new StringDecoder('utf8'), requestIds = new Set();
  let writes = Promise.resolve(), closeResolve;
  const done = new Promise(resolve => { closeResolve = resolve; });
  const diagnostic = code => { try { onDiagnostic({ code }); } catch { /* No raw data. */ } };
  const close = async code => {
    if (closed) return done;
    closed = true; transportAbort.abort(); phase = 'closed'; buffer = ''; input.pause?.();
    input.off('data', onData); diagnostic(code);
    try { await onClose(); } catch { diagnostic('stdio_close_failed'); }
    closeResolve(); return done;
  };
  function send(message, limit = maxResponseBytes, isCurrent) {
    if (closed) return;
    if (pendingWrites >= maxInflight) { void close('stdio_output_backpressure'); return; }
    let line;
    try { line = canonical(message) + '\n'; } catch { void close('stdio_invalid_response'); return; }
    if (Buffer.byteLength(line) > limit) {
      line = JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: 'Response exceeds the configured byte limit; tool outcome unavailable. Reconcile the original operation.' } }) + '\n';
    }
    pendingWrites++;
    writes = writes.then(() => new Promise(resolve => {
      if (closed) return resolve();
      if(isCurrent){let current=false;try{current=isCurrent();}catch{}if(!current)line=JSON.stringify({jsonrpc:'2.0',id:message.id??null,error:{code:-32000,message:'Native session changed; original operation outcome remains with its original session.'}})+'\n';}
      try { output.write(line, error => { if (error) void close('stdio_write_failed'); resolve(); }); }
      catch { void close('stdio_write_failed'); resolve(); }
    })).finally(() => { pendingWrites--; });
    return writes;
  }
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function dispatch(request) {
    const id = request.id;
    if (request.method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
    if (request.method === 'initialize') {
      const p = request.params;
      if (phase !== 'new' || !isObject(p) || typeof p.protocolVersion !== 'string' || p.protocolVersion.length > 100 || !isObject(p.capabilities) || !isObject(p.clientInfo) || typeof p.clientInfo.name !== 'string' || typeof p.clientInfo.version !== 'string') {
        error(id, -32602, 'Invalid or repeated initialization.'); return;
      }
      phase = 'initialized';
      send({ jsonrpc: '2.0', id, result: { protocolVersion: MCP_VERSION, capabilities: { tools: {} },
        serverInfo: { name: 'claude-code-broker-connector', version: packageInfo.version },
        instructions: 'Production requires native automatic delivery; a loaded MCP transport alone is not readiness. Read after a native notice, then acknowledge the exact message_id. read_acknowledgment:confirmed completes that read ACK, not the requested task. native_injection_receipt:not_provided_by_this_delivery_mode is a capability limit, not failed delivery or a required user validation step. Receipt and retry keys stay internal. Manual pulls are diagnostic/test-only. ' + DIRECT_COMMAND_INSTRUCTIONS + ' ' + COLLABORATION_INSTRUCTIONS } });
      return;
    }
    if (phase !== 'ready') { error(id, -32000, 'Complete initialize and notifications/initialized first.'); return; }
    if (request.method === 'tools/list') {
      if (request.params !== undefined && (!isObject(request.params) || Object.keys(request.params).length)) { error(id, -32602, 'Tool pagination is not supported.'); return; }
      send({ jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS.filter(definition => typeof tools[definition.name] === 'function').map(definition=>nativeAdmission?{...definition,inputSchema:{...definition.inputSchema,properties:{...definition.inputSchema.properties,_psst_permit:{type:'string',maxLength:129}}}}:definition) } }); return;
    }
    if (request.method === 'tools/call') {
      const p = request.params, definition = TOOL_DEFINITIONS.find(item => item.name === p?.name);
      if (!isObject(p) || Object.keys(p).some(key => !['name', 'arguments', '_meta'].includes(key)) || !definition || typeof tools[definition.name] !== 'function' || !isObject(p.arguments ?? {})) {
        error(id, -32602, 'Unknown tool or invalid bounded arguments.'); return;
      }
      let admission,args=p.arguments??{};
      if(nativeAdmission){
        try{admission=await nativeAdmission(p.name,args);args=admission.arguments;if(typeof admission.isCurrent!=='function'||!admission.isCurrent())throw Error('stale');}
        catch{return error(id,-32000,'Native call provenance unavailable; no new operation admitted.');}
      }
      if(!validArguments(args,definition.inputSchema))return error(id,-32602,'Unknown tool or invalid bounded arguments.');
      // Preserve request-id ownership until its queued response is actually written.
      try{
        if(admission&&!admission.isCurrent())throw Error('stale');
        const result = await invokeTool(admission?.tools??tools, p.name, args, { signal: transportAbort.signal });
        const presented = readableNativeReceive && p.name === 'broker_receive' ? readableReceive(result)
          : readableNativeReceive && p.name === 'broker_presence_events' ? readablePresence(result) : null;
        return send({ jsonrpc: '2.0', id, result: presented ?? { content: [{ type: 'text', text: canonical(result) }], isError: Boolean(result?.error) } }, presented ? maxReceiveResponseBytes : maxResponseBytes,admission?.isCurrent);
      }catch{return send({jsonrpc:'2.0',id,error:{code:-32603,message:'Tool result unavailable; reconcile the original operation.'}},maxResponseBytes,admission?.isCurrent);}
    }
    error(id, -32601, 'Method not supported by this tools-only stdio server.');
  }

  function frame(line) {
    if (closed) return;
    let request;
    try { request = JSON.parse(line); canonical(request); } catch { error(null, -32700, 'Invalid bounded JSON.'); return; }
    const hasId = isObject(request) && Object.hasOwn(request, 'id');
    if (!isObject(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || request.method.length > 128
      || Object.keys(request).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key))
      || (hasId && !(typeof request.id === 'string' && request.id.length <= 128 || Number.isSafeInteger(request.id)))) {
      error(null, -32600, 'Invalid JSON-RPC request.'); return;
    }
    if (!hasId) {
      if (request.method === 'notifications/initialized' && phase === 'initialized') phase = 'ready';
      // Permission/channel notifications, cancellations and unknown notifications
      // have no side effects. They cannot acknowledge or authorize an inbox item.
      return;
    }
    const key = `${typeof request.id}:${request.id}`;
    if (requestIds.has(key)) { error(request.id, -32600, 'Request ID is already in flight; reconcile before retrying.'); return; }
    if (active >= maxInflight) { void close('stdio_capacity_exceeded'); return; }
    requestIds.add(key); active++;
    dispatch(request).catch(() => error(request.id, -32603, 'Tool result unavailable; reconcile the original operation.'))
      .finally(() => { requestIds.delete(key); active--; });
  }
  function onData(chunk) {
    if (closed) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    // A single oversized read is refused before decoding/concatenating it.
    if (bytes.length > maxFrameBytes) { void close('stdio_frame_too_large'); return; }
    buffer += decoder.write(bytes);
    while (!closed && buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (Buffer.byteLength(line) > maxFrameBytes) { void close('stdio_frame_too_large'); return; }
      if (line.trim()) frame(line);
    }
    if (Buffer.byteLength(buffer) > maxFrameBytes) void close('stdio_frame_too_large');
  }
  input.on('data', onData);
  input.on('end', () => { const trailing = decoder.end(); void close(buffer.trim() || trailing ? 'stdio_incomplete_frame' : 'stdio_closed'); });
  input.on('error', () => { void close('stdio_read_failed'); });
  output.on?.('error', () => { void close('stdio_write_failed'); });
  return { close: () => close('stdio_closed'), done, flush: () => writes };
}
