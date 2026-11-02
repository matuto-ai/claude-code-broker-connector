import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {writeFileSync,readFileSync,renameSync,existsSync} from 'node:fs';
import {NativeIncarnation,registrationVersion} from '../src/native-incarnation.mjs';
import {Inbox} from '../vendor/psst/reference/inbox.mjs';
import {BrokerClient} from '../vendor/psst/reference/client.mjs';
import {httpFixture,registration} from './retention-fixture.mjs';
const scope={native:'same-conversation',lifetime:'same-lifetime',broker:'same',tokenFile:'same',credential:'same'};
function setup(t,f,version=2){const directory=join(f.dir,'native-root');let owner=new NativeIncarnation({directory,scope,registrationVersion:version,now:()=>f.now});t.after(()=>owner.close());const tokenFile=join(f.dir,'token');writeFileSync(tokenFile,f.a.token,{mode:0o600});const client=inbox=>new BrokerClient({url:f.base,tokenFile,insecureDevelopment:true,inbox,registrationVersion:version,now:()=>f.now});return{directory,owner,client};}
async function expire(f,c){await c.disconnectSession();f.advance(172800000);f.store.sweep();await assert.rejects(c.reconnect({verifySession:()=>true}),e=>e.code==='session_expired');}
test('v1 default remains v1; active/v1 journals cannot be replaced',async t=>{assert.equal(registrationVersion({}),1);assert.equal(registrationVersion({registrationVersion:2}),2);assert.throws(()=>registrationVersion({registrationVersion:3}));const f=await httpFixture(t),{owner,client}=setup(t,f,1),c=client(owner.inbox);await c.register(registration().metadata);await assert.rejects(owner.replace({client:c,verifySession:()=>true}));});
test('expired native incarnation becomes empty; root lock excludes old worker; reload selects identical UUID',async t=>{
 const f=await httpFixture(t,{requireRegistrationV2:true,limits:{session_retention_seconds:172800}}),{directory,owner,client}=setup(t,f),c=client(owner.inbox),old=owner.inbox.identity;
 await c.register(registration().metadata);owner.inbox.setState('claim_pending',{key:'uncertain-original'});await expire(f,c);
 const fresh=await owner.replace({client:c,verifySession:()=>true});assert.notEqual(fresh.identity.client_id,old.client_id);assert.equal(fresh.getState('claim_pending'),null);assert.deepEqual(owner.root.getState('claim_pending'),{key:'uncertain-original'});
 assert.throws(()=>new Inbox({directory,identity:old}),e=>e.code==='owner_conflict');
 const freshId=fresh.identity.client_id;await client(fresh).register(registration().metadata);owner.close();
 const reloaded=new NativeIncarnation({directory,scope,registrationVersion:2,now:()=>f.now});t.after(()=>reloaded.close());assert.equal(reloaded.inbox.identity.client_id,freshId);assert.deepEqual(reloaded.root.getState('claim_pending'),{key:'uncertain-original'});await client(reloaded.inbox).reconnect({verifySession:()=>true});
 reloaded.close();assert.throws(()=>new NativeIncarnation({directory,scope,registrationVersion:1}));assert.throws(()=>new NativeIncarnation({directory,scope:{...scope,native:'other'},registrationVersion:2}));
});
test('pointer selects same journal after uncertain registration; old operations never migrate',async t=>{
 const f=await httpFixture(t,{requireRegistrationV2:true,limits:{session_retention_seconds:172800}}),{directory,owner,client}=setup(t,f),c=client(owner.inbox);await c.register(registration().metadata);await expire(f,c);const fresh=await owner.replace({client:c,verifySession:()=>true});const id=fresh.identity.client_id,c2=client(fresh),request=c2.request.bind(c2);c2.request=async(...args)=>{const result=await request(...args);if(args[0]==='POST'&&args[1]==='/v1/sessions')throw Error('lost response');return result;};
 await assert.rejects(c2.register(registration().metadata));const pending=fresh.getState('registration_pending');assert.ok(pending);owner.close();const reloaded=new NativeIncarnation({directory,scope,registrationVersion:2,now:()=>f.now});t.after(()=>reloaded.close());assert.equal(reloaded.inbox.identity.client_id,id);assert.deepEqual(reloaded.inbox.getState('registration_pending'),pending);await client(reloaded.inbox).register(registration().metadata);assert.equal(f.store.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
});
test('native switch after authenticated expiry cannot replace',async t=>{const f=await httpFixture(t,{requireRegistrationV2:true,limits:{session_retention_seconds:172800}}),{owner,client}=setup(t,f),c=client(owner.inbox);await c.register(registration().metadata);await expire(f,c);await assert.rejects(owner.replace({client:c,verifySession:()=>false}));assert.equal(owner.inbox,owner.root);});

test('persisted pointer with lost journal fails closed without reconstructing empty DB',async t=>{
 const f=await httpFixture(t,{requireRegistrationV2:true,limits:{session_retention_seconds:172800}}),{directory,owner,client}=setup(t,f),c=client(owner.inbox);await c.register(registration().metadata);await expire(f,c);const fresh=await owner.replace({client:c,verifySession:()=>true});const db=join(fresh.directory,'inbox.sqlite');owner.close();renameSync(db,db+'.preserved');assert.throws(()=>new NativeIncarnation({directory,scope,registrationVersion:2}));assert.equal(existsSync(db),false);
});

test('held native owner rejects changed credential, broker, lifetime or registration version before rebuild',async t=>{
 const f=await httpFixture(t),{directory,owner}=setup(t,f);const selected={directory,scope,registrationVersion:2};owner.assertSelection(selected);
 for(const key of Object.keys(scope))assert.throws(()=>owner.assertSelection({...selected,scope:{...scope,[key]:'different'}}));
 assert.throws(()=>owner.assertSelection({...selected,directory:directory+'-other'}));assert.throws(()=>owner.assertSelection({...selected,registrationVersion:1}));
});
