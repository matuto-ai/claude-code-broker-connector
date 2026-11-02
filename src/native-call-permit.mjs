// Native call provenance only. This is not a same-UID security boundary or permission grant.
import {mkdirSync,readdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync,constants,existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {canonical} from '../vendor/psst/src/protocol.mjs';
import {privateDirectory,readPrivateJson} from './launch-state.mjs';
import {TOOL_DEFINITIONS} from './cooperative-stdio.mjs';
import {verifyBinding} from './plugin-state.mjs';
export const PERMIT_FIELD='_psst_permit';
const PREFIX='mcp__plugin_psst_psst__',MAX_RECORDS=16384,MAX_AGE=600;
const hash=value=>createHash('sha256').update(value).digest('hex');
const uptime=()=>{const n=Number(readFileSync('/proc/uptime','utf8').split(' ')[0]);if(!Number.isFinite(n)||n<0)throw Error('native_clock_unavailable');return n;};
const syncDir=path=>{const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
const exclusiveJson=(path,data)=>{const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,canonical(data)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};
const fail=()=>{throw Error('native_call_provenance_unavailable');};
function cleanArgs(args){if(!args||Array.isArray(args)||![Object.prototype,null].includes(Object.getPrototypeOf(args)))fail();const clean={...args};delete clean[PERMIT_FIELD];const body=canonical(clean);if(Buffer.byteLength(body)>128*1024)fail();return {arguments:clean,digest:hash(body)};}
function ledger(directory,binding){if(!verifyBinding(directory,binding))fail();return privateDirectory(join(directory,'calls-'+hash(canonical({session:binding.sessionId,lifetime:binding.lifetime}))));}
function validate(record,binding,tool,digest,now){
 if(!record||record.version!==1||record.session!==binding.sessionId||record.lifetime!==binding.lifetime||canonical(record.host)!==canonical(binding.host)||record.tool!==tool||record.digest!==digest||!Number.isFinite(record.issuedAt)||now-record.issuedAt<0||now-record.issuedAt>MAX_AGE||typeof record.toolUseId!=='string'||!record.toolUseId||!/^[0-9a-f]{64}$/.test(record.nonce))fail();
}
export function issueNativePermit({directory,binding,event,now=uptime()}){
 if(event?.agent_id||event?.session_id!==binding.sessionId||typeof event.tool_use_id!=='string'||!event.tool_use_id||event.tool_use_id.length>256||/[\u0000-\u001f\u007f]/.test(event.tool_use_id)||typeof event.tool_name!=='string'||!event.tool_name.startsWith(PREFIX))fail();
 const tool=event.tool_name.slice(PREFIX.length);if(!TOOL_DEFINITIONS.some(x=>x.name===tool))fail();
 const clean=cleanArgs(event.tool_input),root=ledger(directory,binding),key=hash(canonical({session:binding.sessionId,lifetime:binding.lifetime,toolUseId:event.tool_use_id})),path=join(root,key);
 let created=false;
 try{if(readdirSync(root).length>=MAX_RECORDS&&!existsSync(path))fail();mkdirSync(path,{mode:0o700});created=true;syncDir(root);}catch(error){if(error.code!=='EEXIST')throw error;}
 privateDirectory(path);
 let record;
 if(created){record={version:1,host:binding.host,session:binding.sessionId,lifetime:binding.lifetime,toolUseId:event.tool_use_id,tool,digest:clean.digest,issuedAt:now,nonce:randomBytes(32).toString('hex')};exclusiveJson(join(path,'record.json'),record);syncDir(path);}
 else record=readPrivateJson(join(path,'record.json')); // Incomplete reservation is uncertainty: never reissue.
 validate(record,binding,tool,clean.digest,now);if(existsSync(join(path,'consumed'))||!verifyBinding(directory,binding))fail();
 return {arguments:{...clean.arguments,[PERMIT_FIELD]:key+'.'+record.nonce},toolUseId:record.toolUseId,issuedAt:record.issuedAt};
}
export function consumeNativePermit({directory,binding,toolName,args,now=uptime()}){
 const token=args?.[PERMIT_FIELD];if(typeof token!=='string'||!(/^[0-9a-f]{64}\.[0-9a-f]{64}$/).test(token))fail();
 const clean=cleanArgs(args),root=ledger(directory,binding),[key,nonce]=token.split('.'),path=join(root,key);
 lstatSync(path);privateDirectory(path);const record=readPrivateJson(join(path,'record.json'));
 validate(record,binding,toolName,clean.digest,now);
 if(key!==hash(canonical({session:binding.sessionId,lifetime:binding.lifetime,toolUseId:record.toolUseId}))||!timingSafeEqual(Buffer.from(nonce,'hex'),Buffer.from(record.nonce,'hex')))fail();
 // O_EXCL tombstone survives crashes and prevents every other consumer/reissued hook.
 exclusiveJson(join(path,'consumed'),{consumed:true});syncDir(path);
 if(!verifyBinding(directory,binding))fail();
 return {arguments:clean.arguments,toolUseId:record.toolUseId,issuedAt:record.issuedAt};
}
