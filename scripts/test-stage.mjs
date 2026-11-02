import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const stage = process.argv[2];
const files = directory => readdirSync(new URL(`../${directory}/`, import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort().map(name => `${directory}/${name}`);
const unit = files('test');
const integration = files('integration').filter(path => path !== 'integration/container-approval.test.mjs');
const groups = { local: unit.filter(path => path !== 'test/package.test.mjs'), integration, package: ['test/package.test.mjs'] };
if (!Object.hasOwn(groups, stage) || groups[stage].length === 0) throw new Error(`Unknown or empty test stage: ${stage}`);
if (process.argv[3] === '--list') { console.log(JSON.stringify(groups[stage])); process.exit(0); }
const result = spawnSync(process.execPath, ['--test', ...groups[stage]], { cwd: new URL('../', import.meta.url), stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
