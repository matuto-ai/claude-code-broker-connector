import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeEpochManager} from '../src/native-epoch-manager.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('epoch manager drains revoked A before resolving B and keeps a compact lifetime',async()=>{
 const drain=deferred();let valid=true,created=0,resolved=0,retired=0;
 const a={isCurrent:()=>valid,retire:()=>{retired++;return drain.promise;}},b={isCurrent:()=>true,retire:async()=>{}};
 const manager=createNativeEpochManager({hostAlive:()=>true,resolve:()=>{resolved++;return {};},create:()=>++created===1?a:b});
 assert.equal(await manager.synchronize(),a);assert.equal(await manager.synchronize(),a);assert.equal(created,1);assert.equal(resolved,1);
 valid=false;const pending=manager.synchronize();await Promise.resolve();await Promise.resolve();assert.equal(retired,1);assert.equal(resolved,1);assert.equal(manager.isCurrent(a),false);
 drain.resolve();assert.equal(await pending,b);assert.equal(resolved,2);assert.equal(created,2);await manager.close();
});
test('failed retirement remains revoked and never adopts B even on later calls',async()=>{
 let valid=true,created=0;const failed=Promise.reject(Error('retirement_failed'));failed.catch(()=>{});
 const a={isCurrent:()=>valid,retire:()=>failed};const manager=createNativeEpochManager({hostAlive:()=>true,resolve:()=>({}),create:()=>{created++;return a;}});
 await manager.synchronize();valid=false;
 await assert.rejects(manager.synchronize(),/retirement_failed/);await assert.rejects(manager.synchronize(),/retirement_failed/);assert.equal(created,1);assert.equal(manager.isCurrent(a),false);await assert.rejects(manager.close(),/retirement_failed/);
});
test('close while old epoch drains cannot create B',async()=>{
 const drain=deferred();let valid=true,created=0;const a={isCurrent:()=>valid,retire:()=>drain.promise};const manager=createNativeEpochManager({hostAlive:()=>true,resolve:()=>({}),create:()=>{created++;return a;}});
 await manager.synchronize();valid=false;const pending=manager.synchronize();await Promise.resolve();const closing=manager.close();drain.resolve();assert.equal(await pending,null);await closing;assert.equal(created,1);assert.equal(await manager.synchronize(),null);
});
