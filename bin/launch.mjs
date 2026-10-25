import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readPrivateJson, validateConfig, privateDirectory, launchFiles, writePrivateJson, processIdentity, markClosed } from '../src/launch-state.mjs';

let runDirectory;
try {
  if (process.argv.length !== 3 || process.platform !== 'linux') throw new Error('usage_linux_launch_config');
  const config = validateConfig(readPrivateJson(process.argv[2]));
  const version = spawnSync(config.claudeBinary ?? 'claude', ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 4096 });
  if (version.status !== 0 || version.stdout.trim().match(/^(\d+\.\d+\.\d+)(?:\s|$)/)?.[1] !== config.expectedCliVersion) throw new Error('cli_version_mismatch');
  privateDirectory(config.stateRoot);
  runDirectory = join(config.stateRoot, randomUUID());
  const adapterRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const { args } = launchFiles({ config, runDirectory, adapterRoot });
  const close = () => { try { markClosed(runDirectory); } catch { /* Parent identity also expires. */ } };
  process.once('exit', close);
  // Inherit the real user's terminal, never synthesize keys, prompts or approvals.
  const child = spawn(config.claudeBinary ?? 'claude', args, { stdio: 'inherit', shell: false });
  if (!child.pid) throw new Error('cli_start_failed');
  writePrivateJson(join(runDirectory, 'host.json'), processIdentity(child.pid));
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  close(); process.exitCode = code;
} catch {
  try { if (runDirectory) markClosed(runDirectory); } catch { /* No implicit recovery. */ }
  process.stderr.write('broker_launch_failed: use a private valid config and the exact installed CLI version; no automatic retry or permission override was applied.\n');
  process.exitCode = 1;
}
