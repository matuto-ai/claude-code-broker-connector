import { verifyReference } from '../src/reference-pin.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readPrivateJson, validateConfig, verifyLaunch, observedModel, closed } from '../src/launch-state.mjs';
import { createClaudeSessionBridge } from '../src/session-bridge.mjs';

let bridge, inbox, monitor;
try {
  if (process.argv.length !== 3) throw new Error('invalid_mcp_arguments');
  const run = process.argv[2], config = validateConfig(readPrivateJson(join(run, 'config.json'))), expected = readPrivateJson(join(run, 'launch.json'));
  verifyReference(config.referenceRoot);
  const load = path => import(pathToFileURL(join(config.referenceRoot, path)).href);
  const [{ Inbox, newSessionIdentity }, { BrokerClient }, { AdapterRuntime }, { createTools }, { serveStdio }] = await Promise.all([
    load('reference/inbox.mjs'), load('reference/client.mjs'), load('reference/runtime.mjs'), load('reference/tools.mjs'), load('reference/mcp-stdio.mjs'),
  ]);
  const identity = newSessionIdentity('claude-code');
  // A restarted MCP subprocess gets a fresh identity and never adopts old pending
  // mail. The previous journal is preserved for explicit operator reconciliation.
  inbox = new Inbox({ directory: join(run, `inbox-${identity.client_id}`), identity });
  let alive = true;
  const lifetime = {}, binding = { nativeSessionId: expected.sessionId, lifetime };
  const current = () => ({ ...binding, alive: alive && verifyLaunch(run, expected) });
  const client = new BrokerClient({ url: config.brokerUrl, tokenFile: config.tokenFile, caFile: config.caFile,
    insecureDevelopment: config.insecureDevelopment === true, inbox });
  const runtime = new AdapterRuntime({ client, inbox, verifySession: () => current().alive, isAlive: () => current().alive });
  bridge = createClaudeSessionBridge({ reference: { createTools, serveStdio }, client, inbox, runtime,
    binding, getCurrentBinding: current, input: process.stdin, output: process.stdout,
    observeMetadata: () => ({ model: observedModel(run) }),
    onDiagnostic: ({ code }) => process.stderr.write(`${code}\n`),
  });
  process.stdin.once('end', () => { alive = false; });
  // MCP discovery can finish while the native SessionStart hook runs. No broker
  // registration, heartbeat, or tool effect occurs before that confirmation.
  const deadline = Date.now() + 30000;
  while (!current().alive) {
    if (!alive || closed(run) || Date.now() >= deadline) throw new Error('session_confirmation_unavailable');
    await delay(25);
  }
  await bridge.start({ name: config.name, project: config.project ?? null, model: observedModel(run) });
  monitor = setInterval(() => { if (!current().alive) { alive = false; void bridge.close(); } }, 250);
  await bridge.done;
} catch {
  process.stderr.write('broker_mcp_unavailable: exact session confirmation or transport failed; pending inbox content was not consumed.\n');
  process.exitCode = 1;
} finally {
  if (monitor) clearInterval(monitor);
  await bridge?.close(); inbox?.close();
}
