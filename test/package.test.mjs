import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

import { verifyPackageArtifact, assertRuntimeVersion } from '../scripts/package-provenance.mjs';
import { fileURLToPath } from 'node:url';

test('packed native plugin installs without lifecycle scripts or sibling checkout', {timeout:30000},async t=>{
 const temp=mkdtempSync(join(tmpdir(),'psst-package-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const npm=process.env.npm_execpath;assert(npm);
 const run=args=>spawnSync(process.execPath,[npm,...args],{encoding:'utf8',timeout:20000,env:{...process.env,npm_config_cache:join(temp,'cache')}});
 const pack=run(['pack','--ignore-scripts','--json','--pack-destination',temp]);assert.equal(pack.status,0,pack.stderr);
 const artifact=JSON.parse(pack.stdout)[0];const names=artifact.files.map(x=>x.path);
 assert.equal(artifact.name,'@matuto-ai/claude-psst-connector');
 const sourcePackage=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
 assert.equal(artifact.version,sourcePackage.version);
 assert.equal(sourcePackage.repository.url,'https://github.com/matuto-ai/claude-psst-connector.git');
 assert.deepEqual(sourcePackage.bin,{'psst-claude':'bin/cli.mjs'});
 assert.equal(artifact.filename,`matuto-ai-claude-psst-connector-${sourcePackage.version}.tgz`);
 for(const required of ['.mcp.json','.claude-plugin/plugin.json','.claude-plugin/marketplace.json','distribution/npm-marketplace.json','hooks/hooks.json','monitors/monitors.json','skills/connect/SKILL.md','skills/disconnect/SKILL.md','bin/plugin-mcp.mjs','vendor/psst/reference/inbox.mjs','vendor/psst/LICENSE'])assert(names.includes(required),required);
 assert(!names.some(x=>x.endsWith('.sqlite')||x.endsWith('.tgz')||x.includes('token')));
 const installed=run(['install','--prefix',join(temp,'install'),'--ignore-scripts','--offline','--no-audit','--no-fund',join(temp,artifact.filename)]);assert.equal(installed.status,0,installed.stderr);
 const root=join(temp,'install/node_modules/@matuto-ai/claude-psst-connector');
 const evidence=verifyPackageArtifact({source:fileURLToPath(new URL('../',import.meta.url)),installed:root,artifact,archive:join(temp,artifact.filename),runtimeDirectories:['bin','src','vendor']});
 const runtimeVersion=await probeMcp(root,temp);assertRuntimeVersion(runtimeVersion,sourcePackage.version);
 console.log('PACKAGE_PROVENANCE '+JSON.stringify({...evidence,runtime_version:runtimeVersion}));
 const help=spawnSync(process.execPath,[join(root,'bin/cli.mjs'),'--help'],{encoding:'utf8'});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/plugin-path/);
 const config=join(temp,'config.json');writeFileSync(config,JSON.stringify({brokerUrl:'https://broker.example.invalid',stateRoot:join(temp,'state'),tokenFile:join(temp,'not-created'),name:'test'}),{mode:0o600});
 const doctor=spawnSync(process.execPath,[join(root,'bin/cli.mjs'),'doctor',config],{encoding:'utf8',env:{...process.env,HOME:temp,CLAUDE_CONFIG_DIR:temp}});assert([0,2].includes(doctor.status),doctor.stderr);
 assert.match(doctor.stdout,/native_attachment_unverified|suppressed_in_process_environment|suppression_configured_effective_state_unverified/);
 const freshDoctor=spawnSync(process.execPath,[join(root,'bin/cli.mjs'),'doctor'],{encoding:'utf8',env:{...process.env,HOME:temp,CLAUDE_CONFIG_DIR:temp}});assert([0,2].includes(freshDoctor.status),freshDoctor.stderr);assert.match(freshDoctor.stdout,/not_requested/);
 assert.match(doctor.stdout,/No network request/);assert(!existsSync(join(temp,'not-created')));
 const manifest=JSON.parse(readFileSync(join(root,'.claude-plugin/plugin.json')));assert.equal(manifest.name,'psst');assert.equal(manifest.version,sourcePackage.version);
 assert.equal(manifest.repository,'https://github.com/matuto-ai/claude-psst-connector');
 const marketplace=JSON.parse(readFileSync(join(root,'.claude-plugin/marketplace.json')));
 assert.equal(marketplace.name,'psst-connectors');
 assert.equal(marketplace.plugins.find(plugin=>plugin.name==='psst').version,sourcePackage.version);
 const catalog=JSON.parse(readFileSync(join(root,'distribution/npm-marketplace.json')));
 assert.equal(catalog.name,marketplace.name);
 assert.deepEqual(catalog.plugins.find(plugin=>plugin.name==='psst').source,{source:'npm',package:sourcePackage.name,version:sourcePackage.version});
});

// This starts the shipped MCP entrypoint with private disposable configuration.
// It proves the stdio process/package identity, not native Claude attachment.
async function probeMcp(root, temp) {
 const env={...process.env,HOME:temp,CLAUDE_CONFIG_DIR:join(temp,'claude'),XDG_CONFIG_HOME:join(temp,'xdg')};
 for(const key of Object.keys(env))if(key.startsWith('PSST_'))delete env[key];
 const child=spawn(process.execPath,[join(root,'bin/plugin-mcp.mjs')],{cwd:temp,env,stdio:['pipe','pipe','pipe']});
 let output='',diagnostics='',version;
 child.stderr.on('data',data=>{diagnostics+=data;});
 try {
  return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(new Error('packed MCP initialization timed out: '+diagnostics));},5000);
   const finish=(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);};
   child.on('error',error=>finish(error));
   child.on('exit',code=>finish(new Error('packed MCP exited before initialization: '+code+' '+diagnostics)));
   child.stdout.on('data',data=>{
    output+=data;
    let newline;
    while((newline=output.indexOf('\n'))!==-1){
     const line=output.slice(0,newline);output=output.slice(newline+1);
     try {
      const message=JSON.parse(line);
      assert.equal(message.error,undefined);
      if(message.id===1){version=message.result.serverInfo.version;child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');}
      if(message.id===2){assert.ok(message.result.tools.some(tool=>tool.name==='broker_setup'));finish(null,version);}
     }catch(error){finish(error);}
    }
   });
   child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'installed-package-probe',version:'1'}}})+'\n');
  });
 }finally{
  if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}
 }
}
