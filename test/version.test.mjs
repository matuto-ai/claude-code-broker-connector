import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
test('package, native plugin and both marketplace catalogs share the release version',()=>{
 const pkg=read('package.json'),plugin=read('.claude-plugin/plugin.json');
 const github=read('.claude-plugin/marketplace.json'),npm=read('distribution/npm-marketplace.json');
 assert.equal(pkg.version,'0.7.0');assert.equal(plugin.version,pkg.version);
 assert.equal(github.plugins.find(p=>p.name===plugin.name).version,pkg.version);
 const source=npm.plugins.find(p=>p.name===plugin.name).source;
 assert.equal(source.source,'npm');assert.equal(source.package,pkg.name);assert.equal(source.version,pkg.version);
});
