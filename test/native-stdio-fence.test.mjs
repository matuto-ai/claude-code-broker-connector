import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {serveStdio} from '../src/cooperative-stdio.mjs';
const settle=()=>delay(15);
test('native admission strips permit before strict schema and exposes it only in native catalog',async t=>{
 const input=new PassThrough(),rows=[];let calls=0;
 const tools={broker_identity:async(args)=>{calls++;assert.deepEqual(args,{});return {ok:true};}};
 const output=new Writable({write(c,e,done){rows.push(JSON.parse(c));done();}});
 const server=serveStdio({input,output,tools,nativeAdmission:async(name,args)=>{assert.equal(args._psst_permit,'fixture');return{arguments:{},tools,isCurrent:()=>true};}});t.after(()=>server.close());
 const send=(id,method,params)=>input.write(JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params})+'\n');
 send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});send(null,'notifications/initialized');send(2,'tools/list');send(3,'tools/call',{name:'broker_identity',arguments:{_psst_permit:'fixture'}});await settle();await server.flush();
 assert.equal(calls,1);assert.equal(rows.find(x=>x.id===2).result.tools[0].inputSchema.properties._psst_permit.maxLength,129);assert(!JSON.stringify(rows.find(x=>x.id===3)).includes('_psst_permit'));
});
for(const failure of [false,true])test('queued '+(failure?'error':'success')+' cannot expose retired epoch behind output backpressure',async t=>{
 const input=new PassThrough(),rows=[];let blocked,block=false,current=true,calls=0;
 const output=new Writable({write(c,e,done){rows.push(JSON.parse(c));if(block){block=false;blocked=done;}else done();}});
 const tools={broker_identity:async()=>{calls++;return failure?{error:{code:'PRIVATE_A_FAILURE',detail:'SECRET_A'}}:{secret:'SECRET_A'};}};
 const server=serveStdio({input,output,tools,nativeAdmission:async()=>({arguments:{},tools,isCurrent:()=>current})});t.after(()=>server.close());
 const send=(id,method,params)=>input.write(JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params})+'\n');
 send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});send(null,'notifications/initialized');await settle();block=true;send(2,'ping');await settle();assert(blocked);
 send(3,'tools/call',{name:'broker_identity',arguments:{}});await settle();assert.equal(calls,1);assert(!rows.some(x=>x.id===3));
 send(3,'tools/call',{name:'broker_identity',arguments:{}});await settle();assert.equal(calls,1,'queued result retains its request-id ownership');current=false;blocked();await settle();await server.flush();
 const result=rows.filter(x=>x.id===3);assert(result.length>=1);assert(result.every(x=>x.error));assert(!JSON.stringify(rows).includes('SECRET_A'));assert(!JSON.stringify(rows).includes('PRIVATE_A_FAILURE'));
});
