export const CAPABILITY = Object.freeze({
  client_type: 'claude-code', implementation_mode: 'cooperative_pull',
  tested_cli_version: null, real_harness_certified: false,
  automatic_mode: 'unsupported', channels_enabled: false, permission_relay: false,
  native_consumption_receipt: false,
});

const unavailable = () => ({ error: { code: 'session_binding_unavailable', effect: 'not_applied', retryable: false,
  message: 'The exact live CLI session binding is unavailable. Keep the inbox pending; do not adopt another session.' } });

/**
 * Host integration building block, not a standalone launcher or TUI attachment.
 * The host must supply a verified, private lifetime object and current native ID
 * from its supported lifecycle. A PID, conversation transcript ID alone, model,
 * project path, or a reusable user config does not prove a session lifetime.
 * reference is imported from the pinned broker checkout, never vendored here.
 */
export function createClaudeSessionBridge({ reference, client, inbox = client?.inbox, runtime,
  binding, getCurrentBinding, input, output, observeMetadata = null, onDiagnostic = () => {} }) {
  if (!reference?.createTools || !reference?.serveStdio || !runtime?.start || !runtime?.stop || !inbox ||
    inbox.identity?.client_type !== 'claude-code' || !binding || typeof binding.nativeSessionId !== 'string' ||
    !binding.nativeSessionId || binding.nativeSessionId.length > 256 || typeof binding.lifetime !== 'object' ||
    binding.lifetime === null || typeof getCurrentBinding !== 'function') throw new Error('verified_session_binding_required');
  const nativeId = binding.nativeSessionId, lifetime = binding.lifetime;
  let live = true, started = false, startCalled = false, stopPromise;
  const verified = () => {
    if (!live) return false;
    try {
      const current = getCurrentBinding();
      return current?.alive === true && current.nativeSessionId === nativeId && current.lifetime === lifetime;
    } catch { return false; }
  };
  const stop = () => {
    live = false; started = false;
    return stopPromise ??= Promise.resolve(runtime.stop({ closeSession: true }));
  };
  const tools = reference.createTools({ client, inbox, observeMetadata,
    cooperativeBoundary: callback => {
      if (!started || !verified()) throw new Error('session_binding_unavailable');
      return callback();
    } });
  const guarded = Object.fromEntries(Object.entries(tools).map(([name, call]) => [name, async args => {
    if (!started) return unavailable();
    if (!verified()) { void stop(); return unavailable(); }
    return call(args);
  }]));
  const server = reference.serveStdio({ input, output, tools: guarded, onDiagnostic, onClose: stop });
  return {
    capability: CAPABILITY,
    nativeSessionId: nativeId,
    async start(metadata) {
      if (startCalled || !verified()) throw new Error('verified_session_binding_required');
      startCalled = true;
      try {
        const result = await runtime.start(metadata);
        if (!verified()) {
          // EOF or session switch may race registration. Close the newly acquired
          // lease too, even if an earlier stop ran before registration completed.
          await runtime.stop({ closeSession: true }); throw new Error('session_binding_changed');
        }
        started = true; return result;
      } catch (error) { await stop(); throw error; }
    },
    async close() { await server.close(); await stop(); },
    done: server.done,
  };
}
