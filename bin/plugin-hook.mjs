#!/usr/bin/env node
import { readPluginConfig, nativeStateConfig, pluginHook } from '../src/plugin-state.mjs';
try {
  let size=0; const chunks=[];
  for await (const chunk of process.stdin) { size+=chunk.length; if(size>256*1024) throw new Error('hook_too_large'); chunks.push(chunk); }
  const event=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result=pluginHook(nativeStateConfig(),event);
  // Compatibility for an already configured 0.2.1 host journal.
  try { pluginHook(readPluginConfig(),event); } catch { /* Configuration is optional before connect. */ }
  if(result) process.stdout.write(JSON.stringify(result)+'\n');
} catch {
  process.stderr.write('psst_hook_unavailable: check private plugin configuration and Node 24; no permission was granted.\n');
  process.exitCode=2;
}
