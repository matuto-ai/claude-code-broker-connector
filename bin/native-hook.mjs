import { applyHook, markClosed } from '../src/launch-state.mjs';
let bytes = 0, chunks = [];
try {
  if (process.argv.length !== 3) throw new Error('invalid_hook_arguments');
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 256 * 1024) throw new Error('hook_input_too_large'); chunks.push(chunk); }
  const result = applyHook(process.argv[2], JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (result) process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  try { if (process.argv[2]) markClosed(process.argv[2]); } catch { /* Fail closed through missing/unreadable state. */ }
  process.stderr.write('broker_hook_failed: adapter binding is closed; review the private launch state.\n');
  process.exitCode = 2;
}
