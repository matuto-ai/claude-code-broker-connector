/** Bounded hints only: stdout success never advances the durable inbox. */
export function noticeBudget({maxNotices=3,retryDelays=[0,30000,90000],maxWindowNotices=30,windowMs=600000,initialState=null}={}) {
 let head=null,attempts=0,nextAt=0,total=0,attention=false,rateLimited=false;
 const events=[];
 if(initialState!==null){
  const s=initialState;
  if(!s||typeof s.head!=='string'||s.head.length>256||!Number.isSafeInteger(s.attempts)||s.attempts<1||s.attempts>maxNotices
   ||s.next_at!==null&&(!Number.isFinite(s.next_at)||s.next_at<0)||!Array.isArray(s.events)||s.events.length>maxWindowNotices
   ||s.events.some(n=>!Number.isFinite(n)||n<0))throw Error('invalid_notice_checkpoint');
  head=s.head;attempts=s.attempts;nextAt=s.next_at??Infinity;events.push(...s.events);
 }
 return {next(status,now=Date.now()) {
  attention=false;rateLimited=false;
  if(!status?.connected||!status.pending_id)return false;
  if(status.pending_id!==head){head=status.pending_id;attempts=0;nextAt=now;}
  while(events.length&&now-events[0]>=windowMs)events.shift();
  if(attempts>=maxNotices){attention=true;return false;}
  if(events.length>=maxWindowNotices){rateLimited=true;return false;}
  if(now<nextAt)return false;
  events.push(now);attempts++;total++;nextAt=now+(retryDelays[attempts]??Infinity);
  attention=attempts>=maxNotices;return true;
 },get checkpoint(){return {head,attempts,next_at:Number.isFinite(nextAt)?nextAt:null,events:[...events]};},get total(){return total;},get snapshot(){return {attempts,attention_required:attention,rate_limited:rateLimited,next_retry_at:rateLimited?events[0]+windowMs:Number.isFinite(nextAt)?nextAt:null};}};
}
