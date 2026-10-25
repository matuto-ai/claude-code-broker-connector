// Standalone reviewed Psst helper, separate from the older transport snapshot.
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const ENROLLMENT_COMMIT='4a9d604e1107a92c94f8b8a2f0e1cb2d1e2ecc39';
const source=new URL('../vendor/enrollment.mjs',import.meta.url),stat=lstatSync(source);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||createHash('sha256').update(readFileSync(source)).digest('hex')!=='72318244ac7b799570704f59e167a0684b6c567cb6cda90303f32d7056ee0a06')throw Error('enrollment_snapshot_mismatch');
export const {connectPairingFile,connectPairingSecret,readEnrollmentReceipt}=await import(source.href);
