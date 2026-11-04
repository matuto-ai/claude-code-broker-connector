#!/usr/bin/env node
// Host-owned native monitor: no broker client, token or inbox-body access.
import { resolveNativeBinding, isNativeBindingCurrent } from '../src/native-binding.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { processIdentity } from '../src/launch-state.mjs';
import { nativeStateConfig } from '../src/plugin-state.mjs';
import { createMonitorLifecycle } from '../src/monitor-lifecycle.mjs';
try {
  const pid = Number(process.env.CLAUDE_PID);
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('native_monitor_context_missing');
  const host = processIdentity(pid);
  const hostAlive = () => {
    try { const actual = processIdentity(pid); return actual.start === host.start && actual.boot === host.boot; }
    catch { return false; }
  };
  const lifecycle = createMonitorLifecycle({ hostAlive,
    resolve() {
      // CLAUDE_CODE_SESSION_ID is a startup snapshot and can be stale on /resume.
      // Resolve only the canonical authority written by a genuine SessionStart.
      const nativeConfig = nativeStateConfig(process.env, host, null);
      const found = resolveNativeBinding({ nativeConfig, host, legacyConfig: null });
      return found ? { ...found, nativeConfig } : null;
    },
    isCurrent: isNativeBindingCurrent,
    emit: text => process.stdout.write(text + '\n'),
  });
  // SessionEnd/resume may leave a gap. Stay inert until this same live host has
  // another verified binding; never synthesize one or exit before it can recover.
  while (lifecycle.tick()) await delay(1000);
} catch {
  process.stderr.write('psst_monitor_unavailable: native host context was not confirmed; no message consumed.\n');
  process.exitCode = 1;
}
