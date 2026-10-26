// Host-owned polling for an explicitly requested setup only. No startup enrollment.
// Helper owns durable request/key; this class owns just this native-session intent.
export class ApprovalSession {
 constructor({beginApproval,pollApproval,readApprovalState,onApproved,isCurrent,onState=()=>{},intervalMs=2000}){
  Object.assign(this,{beginApproval,pollApproval,readApprovalState,onApproved,isCurrent,onState,intervalMs});
  this.epoch=0;this.timer=null;this.busy=false;this.status={state:'not_started'};
 }
 cancel(){this.epoch++;clearTimeout(this.timer);this.timer=null;this.status={state:'cancelled'};this.onState(this.status);return this.status;}
 async resume(options){
  const existing=this.readApprovalState(options);
  if(!existing||!['pending','approved'].includes(existing.state))return existing?{state:existing.state,requestId:existing.requestId}:{state:'not_started'};
  clearTimeout(this.timer);const epoch=++this.epoch;
  this.status={state:existing.state,requestId:existing.requestId,...(existing.requestExpiresAt?{requestExpiresAt:existing.requestExpiresAt}:{})};
  if(existing.state==='approved')return this.accept(existing,options,epoch);
  this.onState(this.status);this.schedule(options,epoch);return this.status;
 }
 async start(options,{replace=false}={}){
  if(this.busy)return {state:'busy'};
  clearTimeout(this.timer);const epoch=++this.epoch;this.busy=true;
  const current=()=>epoch===this.epoch&&this.isCurrent();
  try{
   const previous=this.readApprovalState(options);
   const result=await this.beginApproval({...options,...(replace&&previous?{replaceRequestId:previous.requestId}:{})});
   if(!current())return {state:'cancelled'};
   return await this.accept(result,options,epoch);
  }finally{this.busy=false;}
 }
 async accept(result,options,epoch){
  if(epoch!==this.epoch||!this.isCurrent())return {state:'cancelled'};
  // No connectionFile, candidate token or credential data enter public status.
  this.status={state:result.state,requestId:result.requestId,...(result.requestExpiresAt?{requestExpiresAt:result.requestExpiresAt}:{})};
  if(result.state==='approved'){
   let applied;
   try{applied=await this.onApproved(result,()=>epoch===this.epoch&&this.isCurrent());}
   catch{applied={connected:false,error:'approved_installation_not_applied'};}
   if(epoch!==this.epoch||!this.isCurrent())return {state:'cancelled'};
   this.status={...this.status,...applied};
  }
  this.onState(this.status);
  if(result.state==='pending')this.schedule(options,epoch);
  return this.status;
 }
 schedule(options,epoch,waitMs=this.intervalMs){
  this.timer=setTimeout(async()=>{
   if(epoch!==this.epoch||!this.isCurrent())return;
   try{await this.accept(await this.pollApproval(options),options,epoch);}
   catch(error){
    if(epoch!==this.epoch||!this.isCurrent())return;
    if(error.retryable===false){this.status={...this.status,connection:'blocked'};this.onState(this.status);return;}
    if(this.status.requestExpiresAt&&Date.parse(this.status.requestExpiresAt)<=Date.now()){this.status={...this.status,state:'expired'};this.onState(this.status);return;}
    // Keep the exact durable request. A failed poll never invokes beginApproval.
    this.status={...this.status,connection:'temporarily_unavailable'};this.onState(this.status);
    const retryAfter=Number.isFinite(error.retryAfterMs)?Math.max(1000,Math.min(300000,error.retryAfterMs)):this.intervalMs;
    this.schedule(options,epoch,Math.max(this.intervalMs,retryAfter));
   }
  },waitMs);
 }
}
