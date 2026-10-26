import test from 'node:test';
import assert from 'node:assert/strict';
import {switchApproved} from '../src/approval-attachment.mjs';
const barrier=()=>{let release,arrived;return {wait:new Promise(r=>release=r),entered:new Promise(r=>arrived=r),release:()=>release(),arrive:()=>arrived()};};
for(const point of ['old-stop','new-registration','pre-selection'])for(const action of ['setup-cancel','disconnect'])test(`${action} at ${point} never selects late replacement and preserves only rightful old connection`,async()=>{
 const gate=barrier();let current=true,disabled=false,active='old',selected='old',stops=0,restores=0;
 const work=switchApproved({previous:'old',isCurrent:()=>current,canRestore:()=>!disabled,
  stop:async()=>{stops++;if(point==='old-stop'&&stops===1){gate.arrive();await gate.wait;}active=null;},
  connect:async(config,{restore,isCurrent})=>{
   if(!restore&&point==='new-registration'){gate.arrive();await gate.wait;}
   if(!isCurrent())return {error:{code:'connection_cancelled'}};
   active=restore?config:'new';if(restore)restores++;return {client_id:active};
  },select:()=>{selected='new';return {saved:true};},
  onPhase:async phase=>{if(point==='pre-selection'&&phase==='selecting'){gate.arrive();await gate.wait;}}
 });
 await gate.entered;current=false;if(action==='disconnect')disabled=true;gate.release();const result=await work;
 assert.equal(result.error,'connection_cancelled');assert.equal(selected,'old');assert.equal(active,action==='setup-cancel'?'old':null);assert.equal(restores,action==='setup-cancel'?1:0);
});
test('failed selection rolls back previous auth and commits no new selection',async()=>{
 let active='old';const result=await switchApproved({previous:'old',isCurrent:()=>true,canRestore:()=>true,stop:async()=>{active=null;},connect:async(old,{restore})=>{active=restore?old:'new';return {client_id:active};},select:()=>({saved:false,reason:'installation_selection_changed'})});assert.equal(active,'old');assert.equal(result.previous_connection_retained,true);
});

for(const cancel of [false,true])test(`local selection contention retries same transaction; cancellation=${cancel}`,async()=>{
 let current=true,attempts=0,connects=0,active='old',delays=0;
 const result=await switchApproved({previous:'old',isCurrent:()=>current,canRestore:()=>true,stop:async()=>{active=null;},connect:async(old,{restore})=>{connects++;active=restore?old:'new';return {client_id:active};},select:()=>{attempts++;if(attempts<3)throw Error('installation_selection_busy');return {saved:true};},retryDelay:async()=>{delays++;if(cancel)current=false;}});
 assert.equal(result.connected,!cancel);assert.equal(active,cancel?'old':'new');assert.equal(attempts,cancel?1:3);assert.equal(connects,cancel?2:1);assert.equal(delays,cancel?1:2);
});
test('persistent local contention is bounded and restores prior connection',async()=>{
 let attempts=0,active='old';const result=await switchApproved({previous:'old',isCurrent:()=>true,canRestore:()=>true,stop:async()=>{active=null;},connect:async(old,{restore})=>{active=restore?old:'new';return {client_id:active};},select:()=>{attempts++;throw Error('installation_selection_busy');},retryDelay:async()=>{}});assert.equal(attempts,20);assert.equal(result.error,'installation_selection_busy');assert.equal(active,'old');
});
