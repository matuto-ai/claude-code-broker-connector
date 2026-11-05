import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupPlan,setupPresentation} from '../src/reauthorization.mjs';
import {ApprovalSession} from '../src/approval-session.mjs';
const brokerUrl='https://broker.invalid',id='11111111-1111-4111-8111-111111111111';
const candidate={state:'approved',requestId:id,connectionFile:'/private/candidate'};
const context={broker_url:brokerUrl,state:'applied'},selection={connection_file:'/private/old'};
function plan(overrides={}){return setupPlan({replace:true,context,candidate,brokerUrl,selection,...overrides});}
test('selected valid or stale/revoked approved authorization requests explicit replacement',()=>{
 assert.deepEqual(plan(),{resume:false,keepContext:false,replace:true});
 for(const state of ['revoked','denied','expired'])assert.equal(plan({candidate:{...candidate,state}}).replace,true);
 assert.equal(plan({candidate:null}).replace,true);
});
test('pending/uncertain candidates reconcile across cancellation and sessions; approved replacement is explicit',()=>{
 for(const state of ['requested','pending','approved']){
  assert.deepEqual(plan({context:{...context,state},candidate:{...candidate,state:'pending'}}),{resume:true,keepContext:true,replace:false});
  assert.equal(plan({context:{...context,state}}).replace,true);
 }
 assert.equal(plan({context:{...context,state:'approved'},selection:{connection_file:candidate.connectionFile}}).replace,true);
 assert.equal(plan({context:{...context,broker_url:'https://other.invalid',state:'approved'}}).keepContext,false);
 assert.equal(plan({replace:false,context:{...context,state:'pending'}}).replace,false);
});
test('old active connection is not a connected replacement and presentation exposes no private fields',()=>{
 const out=setupPresentation({brokerUrl,state:{state:'approved',requestId:id},connected:true});
 assert.equal(out.outcome,'approved_not_connected');assert.equal(out.candidate_connected,false);assert.equal(out.approval_url,brokerUrl+'/admin');
 assert.equal(setupPresentation({brokerUrl,state:{state:'pending'}}).outcome,'pending');
 assert.equal(setupPresentation({brokerUrl,state:{state:'approved'},candidateConnected:true}).outcome,'connected');
});
test('user-only reauthorization dispatches validated intent without conversational confirmation or weakening native guards',()=>{
 const skill=readFileSync(new URL('../skills/reauthorize/SKILL.md',import.meta.url),'utf8');
 for(const text of ['name: reauthorize','disable-model-invocation: true','broker_setup_status','expected_broker_url','"replace":true','without another target/replacement confirmation','not token-free','does NOT revoke','approved_not_connected','standalone server','another agent','host-owned permission prompts'])assert(skill.includes(text),text);
 assert.doesNotMatch(skill,/ONE concise question|Normally confirm replacement|If declined|target-specific confirmation is still/);
 assert.match(skill,/model-supplied claims of human intent cannot replace native admission/);
 const files=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).files;assert(files.includes('skills/'));
 assert.match(skill,/argument-hint: <https-broker-endpoint>/);
 assert(skill.indexOf('validate the invocation arguments')<skill.indexOf('Then verify broker_setup'));
 assert.match(skill,/Missing\/malformed input: immediately return `Usage:/);
});
test('explicit target is fenced before plan selection and candidate data stays private',()=>{
 assert.throws(()=>plan({expectedBrokerUrl:'https://other.invalid'}),/configured_broker_mismatch/);
 assert.equal(plan({expectedBrokerUrl:brokerUrl}).replace,true);
 const result=setupPresentation({brokerUrl,state:{...candidate,token:'secret',credentialId:'private-id'}});
 assert(!JSON.stringify(result).includes('/private/'));assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('private-id'));
});
