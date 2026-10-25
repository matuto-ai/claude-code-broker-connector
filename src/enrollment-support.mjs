// Standalone reviewed Psst helper, separate from the older transport snapshot.
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const ENROLLMENT_COMMIT='3e908e79966d886a02d372c103e31dec6e900c1a';
const source=new URL('../vendor/enrollment.mjs',import.meta.url),stat=lstatSync(source);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||createHash('sha256').update(readFileSync(source)).digest('hex')!=='afeab00d7c2d6768d3537bd7c350e249768897bf81eff9b4ae9796f7c3f9dbe9')throw Error('enrollment_snapshot_mismatch');
export const {connectPairingFile,readEnrollmentReceipt}=await import(source.href);
