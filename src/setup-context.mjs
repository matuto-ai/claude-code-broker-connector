import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readPrivateJson,writePrivateJson} from './launch-state.mjs';
import {installationRoot,withInstallationLock} from './installation-selection.mjs';
const path=root=>join(root,'setup-context.json');
export function readSetupContext(root=installationRoot()){
 let value;try{value=readPrivateJson(path(root));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 return validate(value);
}
function validate(value){
 if(!value||value.format!=='psst-setup-context-v1'||typeof value.revision!=='string'||typeof value.broker_url!=='string'
  ||!(value.selection_revision===null||typeof value.selection_revision==='string')||!(value.request_id===null||typeof value.request_id==='string')
  ||!['requested','pending','approved','denied','expired','revoked','applied'].includes(value.state)
  ||Object.keys(value).some(k=>!['format','revision','broker_url','selection_revision','request_id','state'].includes(k)))throw Error('invalid_setup_context');
 const url=new URL(value.broker_url);if(url.origin!==value.broker_url||url.protocol!=='https:')throw Error('invalid_setup_context');
 return value;
}
export function saveSetupContext(value,expectedRevision,root=installationRoot()){
 return withInstallationLock(root,()=>{
  const old=readSetupContext(root);if((old?.revision??null)!==expectedRevision)throw Error('setup_context_changed');
  const next=validate({format:'psst-setup-context-v1',revision:randomUUID(),broker_url:value.broker_url,selection_revision:value.selection_revision,request_id:value.request_id,state:value.state});
  writePrivateJson(path(root),next);return next;
 });
}
