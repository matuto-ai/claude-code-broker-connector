// Public command planning only. Credential contents never leave the existing helper.
export const REAUTHORIZE_USAGE = 'Usage: /psst:reauthorize <https://broker.example> (configured HTTPS broker origin; no path, query, fragment or credentials).';
export function setupEndpoint({replace=false,expectedBrokerUrl}){
 if(!replace&&expectedBrokerUrl===undefined)return undefined;
 try{
  const url=new URL(expectedBrokerUrl);
  if(typeof expectedBrokerUrl!=='string'||expectedBrokerUrl.length>2048||!/^https:\/\//i.test(expectedBrokerUrl)||/[\u0000-\u0020\u007f\\?#]/u.test(expectedBrokerUrl)||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();
  return url.origin;
 }catch{throw Error('invalid_reauthorization_endpoint');}
}
export function setupPlan({replace,context,candidate,brokerUrl,selection,expectedBrokerUrl}){
 if(expectedBrokerUrl!==undefined&&expectedBrokerUrl!==brokerUrl)throw Error('configured_broker_mismatch');
 const same=context?.broker_url===brokerUrl;
 const unfinished=same&&['requested','pending','approved'].includes(context.state);
 const resume=replace&&candidate?.state==='pending';
 return {resume,keepContext:unfinished&&(!replace||resume),replace:replace&&!resume};
}
export function setupPresentation({brokerUrl,state,connected=false,candidateConnected=false}){
 return {broker_url:brokerUrl,approval_url:brokerUrl?`${brokerUrl}/admin`:null,
  ...Object.fromEntries(Object.entries(state??{}).filter(([key])=>['state','requestId','requestExpiresAt','error','connection','previous_connection_retained'].includes(key))),
  connected, candidate_connected:candidateConnected,
  outcome:state?.state==='pending'?'pending':state?.state==='approved'?(candidateConnected?'connected':'approved_not_connected'):(state?.state??'setup_required')};
}
