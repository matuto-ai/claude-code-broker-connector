import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSetupContext,saveSetupContext} from '../src/setup-context.mjs';
test('durable explicit intent preserves original selection revision; stale writers and corrupt state fail closed',t=>{
 const root=mkdtempSync(join(tmpdir(),'claude-setup-context-'));t.after(()=>rmSync(root,{force:true,recursive:true}));
 assert.equal(readSetupContext(root),null);const value={broker_url:'https://broker.invalid',selection_revision:'old-selection',request_id:null,state:'requested'};
 const first=saveSetupContext(value,null,root);const pending=saveSetupContext({...value,request_id:'request-one',state:'pending'},first.revision,root);
 assert.equal(readSetupContext(root).selection_revision,'old-selection');assert.throws(()=>saveSetupContext(value,first.revision,root),/setup_context_changed/);
 assert.throws(()=>saveSetupContext({...value,broker_url:'https://broker.invalid/path'},pending.revision,root),/invalid_setup_context/);
 assert.equal(readSetupContext(root).request_id,'request-one');const raw=readFileSync(join(root,'setup-context.json'),'utf8');assert(!raw.includes('token'));
 writeFileSync(join(root,'setup-context.json'),'corrupt');assert.throws(()=>readSetupContext(root));assert.throws(()=>saveSetupContext(value,null,root));
});
