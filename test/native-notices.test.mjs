import test from 'node:test';
import assert from 'node:assert/strict';
import {noticeBudget} from '../src/native-notices.mjs';
test('same unread head has finite retries and explicit attention, never an automatic ACK',()=>{
 const b=noticeBudget(),s={connected:true,pending_id:'one'};
 assert.equal(b.next(s,0),true);assert.equal(b.next(s,1),false);
 assert.equal(b.next(s,30000),true);assert.equal(b.next(s,119999),false);
 assert.equal(b.next(s,120000),true);assert.equal(b.snapshot.attention_required,true);
 assert.equal(b.next({...s,connected:false},120001),false);
 assert.equal(b.next(s,120002),false);assert.equal(b.snapshot.attention_required,true);
 assert.equal(b.next(s,1e9),false);assert.equal(b.snapshot.attention_required,true);
 assert.equal(b.next({...s,pending_id:'two'},1e9),true);assert.equal(b.snapshot.attention_required,false);
 assert.deepEqual(s,{connected:true,pending_id:'one'});
});
test('rolling rate window limits floods but does not silence more than 30 distinct messages forever',()=>{
 const b=noticeBudget({maxWindowNotices:30,windowMs:600000});
 for(let i=0;i<30;i++)assert.equal(b.next({connected:true,pending_id:`message-${i}`},i),true);
 assert.equal(b.next({connected:true,pending_id:'next'},30),false);assert.equal(b.snapshot.rate_limited,true);assert.equal(b.snapshot.next_retry_at,600000);
 assert.equal(b.next({connected:true,pending_id:'next'},600000),true);
 for(let i=31;i<61;i++)assert.equal(b.next({connected:true,pending_id:`message-${i}`},1200000+i),true);
 assert.equal(b.total,61);
});
test('empty inbox and disconnected status never create notifications',()=>{
 const b=noticeBudget();for(const s of [null,{}, {connected:false,pending_id:'x'},{connected:true,pending_id:null}])assert.equal(b.next(s),false);
 assert.equal(b.total,0);
});
test('transport hint checkpoint preserves finite retries and window across monitor restarts',()=>{
 const status={connected:true,pending_id:'event-one'},a=noticeBudget();
 assert(a.next(status,100));
 const b=noticeBudget({initialState:a.checkpoint});assert.equal(b.next(status,101),false);
 assert(b.next(status,30100));const c=noticeBudget({initialState:b.checkpoint});
 assert(c.next(status,120100));const d=noticeBudget({initialState:c.checkpoint});
 assert.equal(d.next(status,1e9),false);assert(d.snapshot.attention_required);
 assert(d.next({...status,pending_id:'event-two'},1e9));
 assert.throws(()=>noticeBudget({initialState:{...a.checkpoint,attempts:-1}}),/checkpoint/);
 assert.throws(()=>noticeBudget({initialState:{...a.checkpoint,events:Array(31).fill(0)}}),/checkpoint/);
});
