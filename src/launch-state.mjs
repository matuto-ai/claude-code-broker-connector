import { readFileSync, writeFileSync, lstatSync, mkdirSync, renameSync, realpathSync, existsSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function privateDirectory(directory) {
  if (!isAbsolute(directory)) throw new Error('absolute_private_directory_required');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || realpathSync(directory) !== directory || process.getuid && stat.uid !== process.getuid()) throw new Error('private_directory_required');
  return directory;
}
export function readPrivateJson(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > 16384 || process.getuid && stat.uid !== process.getuid()) throw new Error('private_file_required');
    const value = readFileSync(fd, 'utf8');
    if (Buffer.byteLength(value) > 16384) throw new Error('private_file_required');
    return JSON.parse(value);
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function writePrivateJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}
export function processIdentity(pid) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid < 1) throw new Error('linux_owned_process_required');
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
  if (!/^\d+$/.test(fields[19]) || ['Z', 'X'].includes(fields[0])) throw new Error('process_not_alive');
  return { pid, start: fields[19], boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() };
}
const sameProcess = expected => {
  try { const actual = processIdentity(expected.pid); return actual.start === expected.start && actual.boot === expected.boot; } catch { return false; }
};
export function closed(runDirectory) {
  try { return existsSync(join(runDirectory, 'closed')); } catch { return true; }
}
export function markClosed(runDirectory) {
  try { writeFileSync(join(runDirectory, 'closed'), 'closed\n', { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
}
export function verifyLaunch(runDirectory, expected) {
  try {
    if (closed(runDirectory)) return false;
    const launch = readPrivateJson(join(runDirectory, 'launch.json'));
    const native = readPrivateJson(join(runDirectory, 'native.json'));
    const host = readPrivateJson(join(runDirectory, 'host.json'));
    return launch.lifetime === expected.lifetime && launch.sessionId === expected.sessionId &&
      native.sessionId === expected.sessionId && native.confirmed === true && sameProcess(launch.owner) && sameProcess(host);
  } catch { return false; }
}
export function observedModel(runDirectory) {
  try {
    const { model } = readPrivateJson(join(runDirectory, 'native.json'));
    if (typeof model === 'string' && model && model.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/u.test(model)) return { provider: null, id: model, source: 'observed' };
  } catch { /* Unknown is truthful. */ }
  return { provider: null, id: null, source: 'unknown' };
}

/** Consumes documented native hook fields only; never reads the transcript. */
export function applyHook(runDirectory, event) {
  const launch = readPrivateJson(join(runDirectory, 'launch.json'));
  if (!uuid(launch.sessionId) || !uuid(launch.lifetime) || !event || typeof event !== 'object') throw new Error('invalid_hook_input');
  if (event.hook_event_name === 'PreToolUse') {
    // Only denial is possible. Normal native approval policy still runs when this
    // returns no output. Subagents cannot consume the main session's mailbox.
    if (event.session_id !== launch.sessionId || event.agent_id || !verifyLaunch(runDirectory, launch)) {
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: 'Broker tools belong to a different or unavailable main CLI session; leave its inbox pending.' } };
    }
    return null;
  }
  if (!['SessionStart', 'SessionEnd', 'PostModelSwitch'].includes(event.hook_event_name)) throw new Error('unsupported_hook');
  if (event.session_id !== launch.sessionId || event.hook_event_name === 'SessionEnd') { markClosed(runDirectory); return null; }
  if (closed(runDirectory)) return null;
  const model = event.hook_event_name === 'PostModelSwitch' ? event.to_model : event.model;
  if (model !== undefined && (typeof model !== 'string' || model.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(model))) throw new Error('invalid_hook_metadata');
  // PostModelSwitch does not create a missing SessionStart confirmation.
  let confirmed = event.hook_event_name === 'SessionStart';
  if (!confirmed) { try { confirmed = readPrivateJson(join(runDirectory, 'native.json')).confirmed === true; } catch { /* Still unknown. */ } }
  writePrivateJson(join(runDirectory, 'native.json'), { sessionId: launch.sessionId, confirmed, model: model ?? null });
  return null;
}

export function validateConfig(config) {
  const allowed = ['referenceRoot', 'stateRoot', 'brokerUrl', 'tokenFile', 'caFile', 'insecureDevelopment', 'name', 'project', 'claudeBinary', 'expectedCliVersion'];
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !allowed.includes(k))) throw new Error('invalid_launch_configuration');
  for (const key of ['referenceRoot', 'stateRoot', 'tokenFile']) if (typeof config[key] !== 'string' || !isAbsolute(config[key])) throw new Error('invalid_launch_path');
  if (config.caFile !== undefined && !isAbsolute(config.caFile)) throw new Error('invalid_launch_path');
  if (typeof config.brokerUrl !== 'string' || typeof config.name !== 'string' || !config.name || config.name.length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(config.name)) throw new Error('invalid_launch_configuration');
  if (config.project !== undefined && config.project !== null && (typeof config.project !== 'string' || config.project.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(config.project))) throw new Error('invalid_launch_configuration');
  if (config.insecureDevelopment !== undefined && typeof config.insecureDevelopment !== 'boolean') throw new Error('invalid_launch_configuration');
  if (typeof config.expectedCliVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(config.expectedCliVersion)) throw new Error('exact_cli_version_required');
  if (config.claudeBinary !== undefined && (typeof config.claudeBinary !== 'string' || !isAbsolute(config.claudeBinary))) throw new Error('absolute_cli_binary_required');
  return config;
}

export function launchFiles({ config, runDirectory, adapterRoot, node = process.execPath, sessionId = randomUUID(), lifetime = randomUUID() }) {
  validateConfig(config); privateDirectory(runDirectory);
  const launch = { sessionId, lifetime, owner: processIdentity(process.pid) };
  writePrivateJson(join(runDirectory, 'launch.json'), launch);
  writePrivateJson(join(runDirectory, 'config.json'), config);
  const hook = { type: 'command', command: node, args: [join(adapterRoot, 'bin/native-hook.mjs'), runDirectory], timeout: 5 };
  writePrivateJson(join(runDirectory, 'settings.json'), { hooks: {
    SessionStart: [{ hooks: [hook] }], SessionEnd: [{ hooks: [hook] }], PostModelSwitch: [{ hooks: [hook] }],
    PreToolUse: [{ matcher: 'mcp__lan_broker__broker_.*', hooks: [hook] }],
  } });
  writePrivateJson(join(runDirectory, 'mcp.json'), { mcpServers: { lan_broker: {
    type: 'stdio', command: node, args: [join(adapterRoot, 'bin/mcp.mjs'), runDirectory],
  } } });
  return { launch, args: ['--session-id', sessionId, '--settings', join(runDirectory, 'settings.json'), '--mcp-config', join(runDirectory, 'mcp.json')] };
}
