import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { openSync, closeSync, fstatSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { privateDirectory, readPrivateJson, writePrivateJson } from './launch-state.mjs';
import { readPluginConfig } from './plugin-state.mjs';

// Installation scope is the existing Claude config volume, never a native session ID.
export function installationRoot(env=process.env){
 if(env.CLAUDE_CONFIG_DIR){if(!isAbsolute(env.CLAUDE_CONFIG_DIR))throw Error('absolute_claude_config_directory_required');return join(env.CLAUDE_CONFIG_DIR,'psst');}
 return join(homedir(),'.config','psst');
}
export function readSelection(root=installationRoot()){
 let value;
 try{value=readPrivateJson(join(root,'selected-installation.json'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!value||value.format!=='psst-selected-installation-v1'||typeof value.revision!=='string'||!isAbsolute(value.connection_file??'')||Object.keys(value).some(k=>!['format','revision','connection_file'].includes(k)))throw Error('invalid_installation_selection');
 return value;
}
export function selectedConfig(root=installationRoot()){
 const selection=readSelection(root);
 return selection?readPluginConfig(selection.connection_file):null;
}
export function saveSelection(connectionFile,expectedRevision,root=installationRoot(),expectedConfig){
 // Revalidate private file and, where marked, strict enrollment receipt. Never copy credentials.
 const config=readPluginConfig(connectionFile);
 if(expectedConfig&&JSON.stringify(config)!==JSON.stringify(expectedConfig))return {saved:false,reason:'installation_config_changed'};
 return withInstallationLock(root,()=>{
  const current=readSelection(root);
  if(current?.connection_file===connectionFile)return {saved:true,revision:current.revision};
  if((current?.revision??null)!==expectedRevision)return {saved:false,reason:'installation_selection_changed'};
  const revision=randomUUID();
  writePrivateJson(join(root,'selected-installation.json'),{format:'psst-selected-installation-v1',revision,connection_file:connectionFile});
  return {saved:true,revision};
 });
}
export function withInstallationLock(root,operation){
 privateDirectory(root);
 const lockPath=join(root,'.selection-owner.sqlite');let lock;
 const fd=openSync(lockPath,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
 try{const s=fstatSync(fd);if(!s.isFile()||(s.mode&0o077)||(process.getuid&&s.uid!==process.getuid()))throw Error('private_selection_lock_required');}finally{closeSync(fd);}
 try{
  lock=new DatabaseSync(lockPath);
  try{lock.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;');}catch{throw Error('installation_selection_busy');}
  return operation();
 }finally{lock?.close();}
}

export function configuredBrokerUrl(env=process.env){
 const input=env.PSST_PLUGIN_BROKER_URL||env.PSST_BROKER_URL;
 if(!input)return null;
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('https_broker_origin_required');
 return url.origin;
}
export function enforceConfiguredBroker(config,env=process.env){
 const origin=configuredBrokerUrl(env);
 if(origin&&new URL(config.brokerUrl).origin!==origin)throw Error('configured_broker_mismatch');
 return config;
}
