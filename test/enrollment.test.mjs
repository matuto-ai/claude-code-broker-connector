import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {connectPairingFile} from '../src/enrollment-support.mjs';
import {readPluginConfig,journalName,refreshEnrollment} from '../src/plugin-state.mjs';
async function enrolled(t){
 const root=mkdtempSync(join(tmpdir(),'claude-enroll-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pairingFile=join(root,'pair.json');
 writeFileSync(pairingFile,JSON.stringify({format:'psst-pairing-v1',broker_url:'https://broker.example',pairing_secret:randomBytes(32).toString('base64url'),client_type:'claude-code',expires_at:new Date(Date.now()+60000).toISOString()}),{mode:0o600});
 const credentialId=`enrolled-${randomUUID()}`;
 const result=await connectPairingFile({pairingFile,directory:join(root,'installation'),clientType:'claude-code'},{transport:async()=>({status:201,body:{credential_id:credentialId,adapter_id:`installation-${randomUUID()}`,client_type:'claude-code',scopes:['psst'],expires_at:new Date(Date.now()+60000).toISOString(),protocol_version:'1'}})});
 return {...result,root,receipt:join(dirname(result.connectionFile),'enrollment.json'),token:join(dirname(result.connectionFile),'token')};
}
test('marked helper bundle validates receipt and partitions credential journals, legacy path unchanged',async t=>{
 const f=await enrolled(t),config=readPluginConfig(f.connectionFile);
 assert.equal(config.enrollment.credentialId,f.credentialId);
 assert.deepEqual(refreshEnrollment(config),config);
 assert.equal(journalName('life',{}),'inbox-life');
 assert.notEqual(journalName('life',config),journalName('life',{enrollment:{credentialId:'other'}}));
 assert.notEqual(journalName('life',config),journalName('other',config));
 assert(!JSON.stringify(config).includes(readFileSync(f.token,'utf8').trim()));
 unlinkSync(f.receipt);assert.throws(()=>readPluginConfig(f.connectionFile),/invalid_enrollment_receipt/);assert.throws(()=>refreshEnrollment(config),/invalid_enrollment_receipt/);
});
test('marked receipt corruption, type/origin/token mismatch and expiry fail closed',async t=>{
 const f=await enrolled(t),original=JSON.parse(readFileSync(f.receipt));
 for(const delta of [{client_type:'pi'},{broker_url:'https://other.example'},{token_sha256:'0'.repeat(64)},{expires_at:new Date(0).toISOString()}]){
  writeFileSync(f.receipt,JSON.stringify({...original,...delta}));assert.throws(()=>readPluginConfig(f.connectionFile),/invalid_enrollment_receipt|credential_expired/);
 }
 writeFileSync(f.receipt,'invalid');assert.throws(()=>readPluginConfig(f.connectionFile),/invalid_enrollment_receipt/);
 writeFileSync(f.receipt,JSON.stringify(original));writeFileSync(f.token,randomBytes(32).toString('base64url'));assert.throws(()=>readPluginConfig(f.connectionFile),/invalid_enrollment_receipt/);
});
test('unsupported enrollment marker never falls back to legacy',async t=>{
 const f=await enrolled(t),bundle=JSON.parse(readFileSync(f.connectionFile));
 writeFileSync(f.connectionFile,JSON.stringify({...bundle,enrollment_receipt_file:'elsewhere.json'}));assert.throws(()=>readPluginConfig(f.connectionFile),/incompatible_client_bundle/);
});

test('saved enrollment cannot downgrade or switch credential on resume',async t=>{
 const f=await enrolled(t),config=readPluginConfig(f.connectionFile),bundle=JSON.parse(readFileSync(f.connectionFile));
 delete bundle.enrollment_receipt_file;writeFileSync(f.connectionFile,JSON.stringify(bundle));
 assert.throws(()=>readPluginConfig(f.connectionFile),/missing_enrollment_marker/);
 unlinkSync(f.receipt);assert.throws(()=>refreshEnrollment(config),/enrollment_identity_changed/);
 const other=await enrolled(t),otherConfig=readPluginConfig(other.connectionFile);
 assert.throws(()=>refreshEnrollment({...config,enrollment:{...config.enrollment,connectionFile:other.connectionFile}}),/enrollment_identity_changed/);
});
