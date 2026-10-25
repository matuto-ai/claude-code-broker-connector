/** Bounded hints only: stdout success never advances the durable inbox. */
export function noticeBudget({maxNotices=3,retryDelays=[0,30000,90000],maxWindowNotices=30,windowMs=600000}={}) {
 let head=null,attempts=0,nextAt=0,total=0,attention=false,rateLimited=false;
 const events=[];
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
 },get total(){return total;},get snapshot(){return {attempts,attention_required:attention,rate_limited:rateLimited,next_retry_at:rateLimited?events[0]+windowMs:Number.isFinite(nextAt)?nextAt:null};}};
}
