import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Keep this source-only guard cheap: publishing must exercise the same Psst
// fixture as pull-request verification, including registration-v2 behavior.
function fixtureRef(workflow) {
  const steps = workflow.split(/^\s*- uses:/m).filter(step =>
    /^\s*repository: matuto-ai\/psst\s*$/m.test(step));
  assert.equal(steps.length, 1, 'Expected one Psst fixture checkout');
  assert.match(steps[0], /^\s*path: ai-agent-msg-broker\s*$/m);
  const refs = [...steps[0].matchAll(/^\s*ref: ([^\s#]+)\s*$/gm)];
  assert.equal(refs.length, 1, 'Expected one Psst fixture ref');
  assert.match(refs[0][1], /^[a-f0-9]{40}$/, 'Pin the Psst fixture to a commit');
  return refs[0][1];
}

const readWorkflow = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('release and verify workflows use the same immutable Psst fixture', () => {
  assert.equal(fixtureRef(readWorkflow('npm-publish.yml')), fixtureRef(readWorkflow('verify.yaml')));
});

test('fixture guard rejects missing, duplicate and mutable fixture references', () => {
  const workflow = readWorkflow('verify.yaml');
  const ref = fixtureRef(workflow);
  assert.throws(() => fixtureRef(workflow.replace('repository: matuto-ai/psst', 'repository: example/other')));
  assert.throws(() => fixtureRef(workflow + workflow));
  assert.throws(() => fixtureRef(workflow.replace(`ref: ${ref}`, 'ref: main')));
});
