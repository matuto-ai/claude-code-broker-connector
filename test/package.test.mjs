import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('packed native plugin installs without lifecycle scripts or sibling checkout', {timeout:30000},t=>{
 const temp=mkdtempSync(join(tmpdir(),'psst-package-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const npm=process.env.npm_execpath;assert(npm);
 const run=args=>spawnSync(process.execPath,[npm,...args],{encoding:'utf8',timeout:20000,env:{...process.env,npm_config_cache:join(temp,'cache')}});
 const pack=run(['pack','--ignore-scripts','--json','--pack-destination',temp]);assert.equal(pack.status,0,pack.stderr);
 const artifact=JSON.parse(pack.stdout)[0];const names=artifact.files.map(x=>x.path);
 assert.equal(artifact.name,'@matuto-ai/claude-code-broker-connector');
 const sourcePackage=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
 assert.equal(artifact.version,sourcePackage.version);
 assert.equal(artifact.filename,`matuto-ai-claude-code-broker-connector-${sourcePackage.version}.tgz`);
 for(const required of ['.mcp.json','.claude-plugin/plugin.json','.claude-plugin/marketplace.json','hooks/hooks.json','bin/plugin-mcp.mjs','vendor/psst/reference/inbox.mjs','vendor/psst/LICENSE'])assert(names.includes(required),required);
 assert(!names.some(x=>x.endsWith('.sqlite')||x.endsWith('.tgz')||x.includes('token')));
 const installed=run(['install','--prefix',join(temp,'install'),'--ignore-scripts','--offline','--no-audit','--no-fund',join(temp,artifact.filename)]);assert.equal(installed.status,0,installed.stderr);
 const root=join(temp,'install/node_modules/@matuto-ai/claude-code-broker-connector');
 const help=spawnSync(process.execPath,[join(root,'bin/cli.mjs'),'--help'],{encoding:'utf8'});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/plugin-path/);
 const config=join(temp,'config.json');writeFileSync(config,JSON.stringify({brokerUrl:'https://broker.example.invalid',stateRoot:join(temp,'state'),tokenFile:join(temp,'not-created'),name:'test'}),{mode:0o600});
 const doctor=spawnSync(process.execPath,[join(root,'bin/cli.mjs'),'doctor',config],{encoding:'utf8'});assert.equal(doctor.status,0,doctor.stderr);
 assert.match(doctor.stdout,/No network request/);assert(!existsSync(join(temp,'not-created')));
 const manifest=JSON.parse(readFileSync(join(root,'.claude-plugin/plugin.json')));assert.equal(manifest.name,'psst');
});
