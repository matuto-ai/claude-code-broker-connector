import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {installationRoot,readSelection,selectedConfig,saveSelection,configuredBrokerUrl,enforceConfiguredBroker} from '../src/installation-selection.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'psst-selection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'connection.json');writeFileSync(file,JSON.stringify({brokerUrl:'https://broker.example',tokenFile:join(root,'token'),stateRoot:join(root,'state'),name:'fixture'}),{mode:0o600});return {root,file};}
test('installation scope follows absolute Claude config volume; URL is not authorization',()=>{
 assert.equal(installationRoot({CLAUDE_CONFIG_DIR:'/private/claude'}),'/private/claude/psst');
 assert.throws(()=>installationRoot({CLAUDE_CONFIG_DIR:'relative'}));
 assert.equal(configuredBrokerUrl({PSST_PLUGIN_BROKER_URL:'https://a.example/',PSST_BROKER_URL:'https://b.example'}),'https://a.example');
 assert.equal(configuredBrokerUrl({PSST_PLUGIN_BROKER_URL:'',PSST_BROKER_URL:'https://b.example'}),'https://b.example');
 for(const value of ['http://a.example','https://secret@a.example','https://a.example/path'])assert.throws(()=>configuredBrokerUrl({PSST_BROKER_URL:value}));
 assert.throws(()=>enforceConfiguredBroker({brokerUrl:'https://a.example'},{PSST_BROKER_URL:'https://b.example'}));
});
test('private atomic pointer retains only path and revision, CAS prevents concurrent replacement',t=>{
 const {root,file}=fixture(t);const first=saveSelection(file,null,root);assert(first.saved);assert.equal(selectedConfig(root).brokerUrl,'https://broker.example');
 assert.equal(saveSelection(file,null,root).revision,first.revision);
 const second=join(root,'second.json');writeFileSync(second,readFileSync(file),{mode:0o600});
 assert.equal(saveSelection(second,null,root).reason,'installation_selection_changed');
 assert(saveSelection(second,first.revision,root).saved);
 assert.deepEqual(Object.keys(readSelection(root)).sort(),['connection_file','format','revision']);
});
test('selection and config symlinks/private mode fail closed; lock does not delete or steal owners',t=>{
 const {root,file}=fixture(t),link=join(root,'link');symlinkSync(file,link);assert.throws(()=>saveSelection(link,null,root));
 chmodSync(file,0o644);assert.throws(()=>saveSelection(file,null,root));chmodSync(file,0o600);
 saveSelection(file,null,root);const lock=new DatabaseSync(join(root,'.selection-owner.sqlite'));lock.exec('BEGIN EXCLUSIVE');
 try{assert.throws(()=>saveSelection(file,null,root),/installation_selection_busy/);}finally{lock.close();}
 assert(saveSelection(file,null,root).saved);
 writeFileSync(join(root,'selected-installation.json'),'{invalid',{mode:0o600});assert.throws(()=>selectedConfig(root));
});

test('30 processes serialize selection writes without corrupting or overwriting a concurrent choice',{timeout:30000},async t=>{
 const {root,file}=fixture(t);const {spawn}=await import('node:child_process');const {pathToFileURL}=await import('node:url');
 const worker=join(root,'worker.mjs');writeFileSync(worker,`import {saveSelection} from ${JSON.stringify(new URL('../src/installation-selection.mjs',import.meta.url).href)};try{console.log(JSON.stringify(saveSelection(process.argv[2],null,process.argv[3])));}catch{console.log(JSON.stringify({saved:false,reason:'busy'}));}`);
 const results=await Promise.all(Array.from({length:30},(_,i)=>new Promise((resolve,reject)=>{
  const candidate=join(root,`config-${i}.json`);writeFileSync(candidate,readFileSync(file),{mode:0o600});const child=spawn(process.execPath,[worker,candidate,root],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0);resolve(JSON.parse(output));}catch(error){reject(error);}});
 })));
 assert.equal(results.filter(x=>x.saved).length,1);assert.match(readSelection(root).connection_file,/config-\d+\.json$/);assert(selectedConfig(root));
});
