import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function fixtureRef(workflow) {
  assert.match(workflow, /git ls-remote https:\/\/github\.com\/matuto-ai\/psst\.git refs\/heads\/main/);
  assert.match(workflow, /echo "commit=\$commit" >> "\$GITHUB_OUTPUT"/);
  const steps = workflow.split(/^\s*- uses:/m).filter(step => /^\s*repository: matuto-ai\/psst\s*$/m.test(step));
  assert.equal(steps.length, 1, 'Expected one Psst fixture checkout');
  assert.match(steps[0], /^\s*path: ai-agent-msg-broker\s*$/m);
  assert.match(steps[0], /^\s*ref: \$\{\{ steps\.psst-source\.outputs\.commit \}\}\s*$/m);
  assert.match(workflow, /node scripts\/test-source\.mjs \.\.\/ai-agent-msg-broker '\$\{\{ steps\.psst-source\.outputs\.commit \}\}'/);
}
const read = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
test('release and verification resolve current Psst and verify that exact clean commit', () => {
  fixtureRef(read('verify.yaml')); fixtureRef(read('npm-publish.yml'));
});
test('workflow guard rejects stale literal, unresolved branch and missing provenance check', () => {
  const workflow = read('verify.yaml');
  const ref = 'ref: ${{ steps.psst-source.outputs.commit }}';
  for (const replacement of ['ref: ' + '1'.repeat(40), 'ref: main']) assert.throws(() => fixtureRef(workflow.replace(ref, replacement)));
  assert.throws(() => fixtureRef(workflow.replace('scripts/test-source.mjs', 'missing-check.mjs')));
  assert.throws(() => fixtureRef(workflow + workflow));
});
