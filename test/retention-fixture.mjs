import {isAbsolute,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
// Explicit fixture checkout: missing configuration is a failure, never a skip.
const root=process.env.PSST_TEST_ROOT ?? fileURLToPath(new URL('../../ai-agent-msg-broker/',import.meta.url));
if(!root||!isAbsolute(root))throw Error('PSST_TEST_ROOT must name an absolute pinned Psst fixture checkout');
const fixture=await import(pathToFileURL(join(root,'test/helpers.mjs')).href);
export const {httpFixture,registration}=fixture;
