import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {beginApproval,pollApproval,readApprovalState} from '../vendor/approval.mjs';
import {ApprovalSession} from '../src/approval-session.mjs';
import {setupPlan} from '../src/reauthorization.mjs';
const brokerUrl='https://broker.invalid';
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'reauthorize-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return {directory,brokerUrl,clientType:'claude-code'};}
const reply=(id,state)=>({status:201,body:{request_id:id,state,request_expires_at:new Date(Date.now()+60000).toISOString(),...(state==='approved'?{credential:{protocol_version:'1',client_type:'claude-code',credential_id:'enrolled-'+randomUUID(),adapter_id:'installation-'+randomUUID(),scopes:['psst'],expires_at:new Date(Date.now()+3600000).toISOString()}}:{})}});
test('lost initial POST followed by GET 404 recovers only by explicit same-ID/key POST',async t=>{
 const options=fixture(t),seen=[];let lost=true;
 const transport=async(origin,method,path,token,input)=>{
  seen.push({method,token,id:input?.request_id});
  if(method==='GET')return {status:404,body:{error:{code:'not_found',effect:'not_applied'}}};
  if(lost){lost=false;throw Object.assign(Error('transport'),{code:'approval_transport_error',effect:'unknown',retryable:true});}
  return reply(input.request_id,'pending');
 };
 const s=new ApprovalSession({beginApproval:o=>beginApproval(o,{transport}),pollApproval:o=>pollApproval(o,{transport,pollIntervalMs:0}),readApprovalState,isCurrent:()=>true,onApproved:async()=>({connected:false}),intervalMs:100000});t.after(()=>s.cancel());
 await assert.rejects(s.start(options,{replace:true}));s.cancel();const first=readApprovalState(options);assert.equal(first.state,'pending');
 await assert.rejects(pollApproval(options,{transport,pollIntervalMs:0}));assert.equal(readApprovalState(options).requestId,first.requestId);
 const plan=setupPlan({replace:true,context:{broker_url:brokerUrl,state:'pending'},candidate:first,brokerUrl});assert.equal(plan.replace,false);
 const resumed=await s.start(options,{replace:plan.replace});assert.equal(resumed.requestId,first.requestId);
 assert.deepEqual(seen.map(x=>x.method),['POST','GET','POST']);assert.equal(seen[0].id,seen[2].id);assert.equal(seen[0].token,seen[2].token);
 // Even a caller repeating replace:true directly reconciles a pending candidate.
 const again=await s.start(options,{replace:true});assert.equal(again.requestId,first.requestId);assert.equal(seen[3].id,first.requestId);
});
test('unselected approved candidate revoked before attachment can be explicitly replaced while preserving its files',async t=>{
 const options=fixture(t),posts=[];
 const transport=async(origin,method,path,token,input)=>{assert.equal(method,'POST');posts.push(input.request_id);return reply(input.request_id,posts.length===1?'approved':'pending');};
 const old=await beginApproval(options,{transport});assert.equal(old.state,'approved');
 let attachments=0;
 const s=new ApprovalSession({beginApproval:o=>beginApproval(o,{transport}),pollApproval:o=>pollApproval(o,{transport}),readApprovalState,isCurrent:()=>true,onApproved:async()=>{attachments++;return {connected:false,error:'unauthenticated'};},intervalMs:100000});t.after(()=>s.cancel());
 const retry=await s.start(options);assert.equal(retry.connected,false);assert.equal(retry.requestId,old.requestId);assert.equal(posts.length,1);
 const plan=setupPlan({replace:true,context:{broker_url:brokerUrl,state:'approved'},candidate:old,brokerUrl,selection:{connection_file:'/previous-selection'}});assert.equal(plan.replace,true);
 const replacement=await s.start(options,{replace:plan.replace});assert.equal(replacement.state,'pending');assert.notEqual(replacement.requestId,old.requestId);assert.equal(posts.length,2);assert.equal(attachments,1);
 assert(existsSync(old.connectionFile));assert(existsSync(join(dirname(old.connectionFile),'token')));assert(existsSync(join(dirname(old.connectionFile),'attempt.json')));
 assert.equal((await s.start(options,{replace:true})).requestId,replacement.requestId);assert.equal(new Set(posts).size,2);
});
