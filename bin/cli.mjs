#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPluginConfig, configPath } from '../src/plugin-state.mjs';
import { verifyReference } from '../src/reference-pin.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [command, argument] = process.argv.slice(2);
try {
  if (command === 'plugin-path') console.log(root);
  else if (command === 'config-example') console.log(JSON.stringify({brokerUrl:'https://broker.example.invalid',tokenFile:'/absolute/private/claude/token',stateRoot:'/absolute/private/claude/state',name:'claude-code',project:null},null,2));
  else if (command === 'doctor') {
    if(process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('linux_node_24_required');
    verifyReference(join(root,'vendor','psst'));
    readPluginConfig(argument ?? configPath());
    console.log('Local configuration and bundled runtime are valid. No network request, credential read, or live Claude session was tested.');
  } else if (!command || ['--help','help'].includes(command)) console.log('psst-claude plugin-path | config-example | doctor [absolute-config-path]\nNative installation: claude plugin marketplace add <plugin-path>, then claude plugin install psst@psst-connectors. Restart Claude after configuration.');
  else throw new Error('unknown_command');
} catch(error) { console.error(`psst-claude: ${/^[a-z0-9_]+$/.test(error.message)?error.message:'configuration_check_failed'}`);process.exitCode=1; }
