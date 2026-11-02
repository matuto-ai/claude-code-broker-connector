/** Serialize verified native lifetime transitions; failed retirement never licenses adoption. */
export function createNativeEpochManager({hostAlive,resolve,create}) {
 let current=null,closed=false,transition=Promise.resolve(),closing;
 const synchronize=()=>{
  const next=transition.then(async()=>{
   if(closed)return null;
   if(!hostAlive())throw Error('native_host_departed');
   if(current?.isCurrent())return current;
   if(current){const old=current;await old.retire();if(current===old)current=null;}
   if(closed)return null;
   const found=resolve();
   if(found)current=create(found);
   return current;
  });
  // Recover the queue only. A failed old epoch remains current and revoked;
  // its cached failed retirement must succeed before any new epoch is created.
  transition=next.catch(()=>{});return next;
 };
 return Object.freeze({synchronize,
  isCurrent:epoch=>!closed&&current===epoch&&epoch.isCurrent(),
  close(){
   if(closing)return closing;closed=true;
   closing=(async()=>{await transition;const old=current;await old?.retire();if(current===old)current=null;})();
   return closing;
  }
 });
}
