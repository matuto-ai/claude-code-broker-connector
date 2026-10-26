import {setTimeout as delay} from 'node:timers/promises';
// One native session's attachment transaction. Durable selection commits last.
// Cancellation rolls back only this session; explicit disconnect forbids restore.
export async function switchApproved({previous,stop,connect,select,isCurrent,canRestore,onPhase=()=>{},retryDelay=delay}){
 async function rollback(error){
  await onPhase('restoring');await stop();
  let restored;
  if(previous&&canRestore())restored=await connect(previous,{restore:true,isCurrent:canRestore});
  return {connected:false,error,previous_connection_retained:!!restored?.client_id};
 }
 try{
  await onPhase('stopping');if(previous)await stop();
  if(!isCurrent())return await rollback('connection_cancelled');
  await onPhase('attaching');if(!isCurrent())return await rollback('connection_cancelled');
  let attached;try{attached=await connect(null,{restore:false,isCurrent});}catch{attached=null;}
  if(!isCurrent())return await rollback('connection_cancelled');
  if(!attached?.client_id)return await rollback(attached?.error?.code??'connection_failed');
  await onPhase('selecting');if(!isCurrent())return await rollback('connection_cancelled');
  let selected;
  // Contention is local and recoverable; never repeat enrollment or registration.
  // Every retry revalidates the same winner and current native intent under CAS.
  for(let attempt=0;attempt<20;attempt++){
   if(!isCurrent())return await rollback('connection_cancelled');
   try{selected=select();}catch(error){selected={saved:false,reason:error.message==='installation_selection_busy'?'installation_selection_busy':'installation_selection_unavailable'};}
   if(selected.saved||selected.reason!=='installation_selection_busy'||attempt===19)break;
   await retryDelay(Math.min(25*(attempt+1),200));
  }
  if(!selected.saved)return await rollback(selected.reason);
  await onPhase('committed');return {connected:true,installation_selection:selected};
 }finally{await onPhase('finished');}
}
