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
