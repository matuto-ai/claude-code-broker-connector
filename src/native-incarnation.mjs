import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {lstatSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync} from 'node:fs';
import {privateDirectory,readPrivateJson} from './launch-state.mjs';
import {Inbox,newSessionIdentity} from '../vendor/psst/reference/inbox.mjs';

function durableJson(path,value,directory){
 const tmp=path+'.'+randomUUID()+'.tmp';let fd;
 try{fd=openSync(tmp,'wx',0o600);writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}
 renameSync(tmp,path);fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
/** Own the original Inbox lock for the entire native lifetime attachment. Older
 * workers use this SAME lock, so cannot attach the root while we use a successor. */
export class NativeIncarnation {
 constructor({directory,scope,registrationVersion=1,now=Date.now}){
  this.directory=privateDirectory(directory);this.scope=JSON.stringify(scope);this.version=registrationVersion;this.now=now;this.closed=false;
  const identityPath=join(directory,'identity.json');let identity;
  try{identity=readPrivateJson(identityPath);}catch(e){if(e.code!=='ENOENT')throw e;identity=newSessionIdentity('claude-code');try{writeFileSync(identityPath,JSON.stringify(identity)+'\n',{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;identity=readPrivateJson(identityPath);}}
  if(identity.client_type!=='claude-code')throw Error('incarnation_type_mismatch');
  this.root=new Inbox({directory,identity,now});
  try{
   this.pointer=join(directory,'incarnation.json');let value;
   try{value=readPrivateJson(this.pointer);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(value){
    if(registrationVersion!==2||value.version!==2||value.scope!==this.scope||!/^generation-[0-9a-f-]{36}$/.test(value.name))throw Error('incarnation_mismatch');
    const child=join(directory,value.name);
    // A selected generation is not a template. Missing durable journal means
    // uncertainty, never permission to create a new empty state under its UUID.
    const db=lstatSync(join(child,'inbox.sqlite'));if(!db.isFile()||db.isSymbolicLink()||(db.mode&0o077))throw Error('incarnation_journal_missing');
    const childIdentity=readPrivateJson(join(child,'identity.json'));if(childIdentity.client_type!=='claude-code')throw Error('incarnation_type_mismatch');
    this.inbox=new Inbox({directory:child,identity:childIdentity,now});
   }else this.inbox=this.root;
  }catch(e){this.root.close();throw e;}
 }
 assertSelection({directory,scope,registrationVersion}){if(this.closed||directory!==this.directory||JSON.stringify(scope)!==this.scope||registrationVersion!==this.version)throw Error('incarnation_mismatch');}
 async replace({client,verifySession,signal}){
  if(this.closed||this.version!==2||client.inbox!==this.inbox||!client.expiredIdentityConfirmed||await verifySession()!==true)throw Error('session_mismatch');
  const name='generation-'+randomUUID(),directory=join(this.directory,name);
  const fresh=await client.createReplacementInbox({directory,verifySession,signal});
  try{
   if(await verifySession()!==true)throw Error('session_mismatch');
   durableJson(join(directory,'identity.json'),fresh.identity,directory);
   // Selection is durable BEFORE any fresh registration. Unknown outcomes always
   // reopen this journal, preserving its immutable registration request/key.
   durableJson(this.pointer,{version:2,scope:this.scope,name},this.directory);
   const previous=this.inbox;this.inbox=fresh;if(previous!==this.root)previous.close();return fresh;
  }catch(e){fresh.close();this.close();throw e;}
 }
 close(){if(this.closed)return;this.closed=true;if(this.inbox&&this.inbox!==this.root)this.inbox.close();this.root?.close();}
}
export function registrationVersion(config={}){const value=config.registrationVersion??1;if(![1,2].includes(value))throw Error('invalid_registration_version');return value;}
