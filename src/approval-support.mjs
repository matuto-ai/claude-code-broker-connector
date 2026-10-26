// Source: matuto-ai/psst@72f5d2d1b834e02cfb6b2f7dc11c6f1a55729344 reference/approval.mjs.
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=new URL('../vendor/approval.mjs',import.meta.url),stat=lstatSync(source);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||createHash('sha256').update(readFileSync(source)).digest('hex')!=='a60c3a0ccd7deb50556586cd67841bb89a300ea3c7f1af3a91d437f856b7a2d5')throw Error('approval_snapshot_mismatch');
export const {beginApproval,pollApproval,readApprovalState}=await import(source.href);
