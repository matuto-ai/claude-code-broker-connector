#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { supportedRuntime, pluginMcpDiagnostic, inspectNativeInstallation } from '../src/preflight.mjs';
import { verifyReference } from '../src/reference-pin.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [command, argument] = process.argv.slice(2);
try {
  if (command === 'plugin-path') console.log(root);
  else if (command === 'config-example') console.log(JSON.stringify({brokerUrl:'https://broker.example.invalid',tokenFile:'/absolute/private/claude/token',stateRoot:'/absolute/private/claude/state',name:'claude-code',project:null},null,2));
  else if (command === 'doctor') {
    if(!supportedRuntime()) throw new Error('linux_node_24_19_through_24_x_required');
    verifyReference(join(root,'vendor','psst'));
    if (argument) { const { readPluginConfig } = await import('../src/plugin-state.mjs'); readPluginConfig(argument); }
    const report = { package_version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, runtime: 'supported', bundled_runtime: 'verified', legacy_config: argument ? 'valid' : 'not_requested', native_mcp: pluginMcpDiagnostic(), installation: inspectNativeInstallation(root), live_acceptance: 'not_tested' };
    console.log(JSON.stringify(report, null, 2));
    console.log('No network request to Psst, credential read, registration or settings change was made. A local preflight is not native readiness.');
    if (report.native_mcp.state !== 'native_attachment_unverified' || report.installation.blockers.length > 0) process.exitCode = 2;
  } else if (!command || ['--help','help'].includes(command)) console.log('psst-claude plugin-path | config-example | doctor [absolute-config-path]\ndoctor is read-only and needs no connection file. Review its native /plugin source and ownership diagnostics; unresolved facts stop without changes. Then verify native /mcp before setup.');
  else throw new Error('unknown_command');
} catch(error) { console.error(`psst-claude: ${/^[a-z0-9_]+$/.test(error.message)?error.message:'configuration_check_failed'}`);process.exitCode=1; }
