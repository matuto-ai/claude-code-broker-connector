import {join,dirname,isAbsolute} from 'node:path';
import {openSync,closeSync,writeFileSync,fsyncSync,renameSync,constants,lstatSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {canonical} from '../vendor/psst/src/protocol.mjs';
import {readPrivateJson} from './launch-state.mjs';
import {hostDirectory,readBinding,verifyBinding} from './plugin-state.mjs';
const marker=directory=>join(directory,'native-authority.json');
const same=(a,b)=>canonical(a)===canonical(b);
const descriptor=b=>({host:b.host,sessionId:b.sessionId,lifetime:b.lifetime});
function optional(read){try{return read();}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function control(nativeConfig,host){const {directory}=hostDirectory(nativeConfig,host);return {directory,binding:optional(()=>readBinding(directory)),authority:optional(()=>readPrivateJson(marker(directory)))};}
export function resolveNativeBinding({nativeConfig,legacyConfig,host,sessionId}){
 const native=control(nativeConfig,host);
 if(native.binding){
  const a=native.authority;
  if(!verifyBinding(native.directory,native.binding)||(sessionId&&native.binding.sessionId!==sessionId)||!a||a.version!==1||!same(a.native,descriptor(native.binding))||typeof a.authorityRoot!=='string'||!isAbsolute(a.authorityRoot))return null;
  // Root snapshot originates only from the trusted SessionStart's validated config.
  // It remains fixed if installation selection changes during this conversation.
  lstatSync(a.authorityRoot);const {directory}=hostDirectory({stateRoot:a.authorityRoot},host),binding=readBinding(directory);
  if(!same(binding.host,host)||!same(a.authority,descriptor(binding))||binding.sessionId!==native.binding.sessionId||!verifyBinding(directory,binding))return null;
  return {directory,binding,host,authorityRoot:a.authorityRoot};
 }
 if(native.authority||!legacyConfig)return null; // Deleted canonical state never resurrects legacy.
 const {directory}=hostDirectory(legacyConfig,host),binding=optional(()=>readBinding(directory));
 if(binding&&same(binding.host,host)&&(!sessionId||binding.sessionId===sessionId)&&verifyBinding(directory,binding))return {directory,binding,host,authorityRoot:legacyConfig.stateRoot};
 return null;
}
export function isNativeBindingCurrent({nativeConfig,directory,binding,host}){
 try{const found=resolveNativeBinding({nativeConfig,legacyConfig:{stateRoot:dirname(directory)},host,sessionId:binding.sessionId});return !!found&&found.directory===directory&&same(descriptor(found.binding),descriptor(binding));}catch{return false;}
}
export function associateNativeBinding({nativeConfig,legacyConfig,host,sessionId}){
 const nativeDirectory=hostDirectory(nativeConfig,host).directory,native={directory:nativeDirectory,binding:readBinding(nativeDirectory)},chosen=legacyConfig??nativeConfig,{directory}=hostDirectory(chosen,host),binding=readBinding(directory);
 if(!native.binding||!same(native.binding.host,host)||!same(binding.host,host)||native.binding.sessionId!==sessionId||binding.sessionId!==sessionId||!verifyBinding(native.directory,native.binding)||!verifyBinding(directory,binding))throw Error('native_control_unavailable');
 const data={version:1,native:descriptor(native.binding),authority:descriptor(binding),authorityRoot:chosen.stateRoot},path=marker(native.directory),temporary=path+'.'+randomUUID()+'.tmp';
 const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,canonical(data)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temporary,path);const dirfd=openSync(native.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(dirfd);}finally{closeSync(dirfd);}
 if(!isNativeBindingCurrent({nativeConfig,directory,binding,host}))throw Error('native_control_changed');
}
