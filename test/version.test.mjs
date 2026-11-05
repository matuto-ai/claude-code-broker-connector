import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
test('package, native plugin and both marketplace catalogs share the release version',()=>{
 const pkg=read('package.json'),plugin=read('.claude-plugin/plugin.json');
 const github=read('.claude-plugin/marketplace.json'),npm=read('distribution/npm-marketplace.json');
 assert.equal(pkg.version,'0.9.0');assert.equal(plugin.version,pkg.version);
 assert.equal(github.plugins.find(p=>p.name===plugin.name).version,pkg.version);
 const source=npm.plugins.find(p=>p.name===plugin.name).source;
 assert.equal(source.source,'npm');assert.equal(source.package,pkg.name);assert.equal(source.version,pkg.version);
});


test('active migration checklist targets the current release while preserving its stable URL',()=>{
 const text=readFileSync(new URL('../docs/migration-0.6.0.md',import.meta.url),'utf8');
 assert(text.includes('release `v'+read('package.json').version+'`'));
 assert(!text.includes('release `v0.6.0`'));
 assert(text.includes('requires separate owner authorization'));
});
