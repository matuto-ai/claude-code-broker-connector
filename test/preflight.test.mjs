import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { supportedRuntime, pluginMcpDiagnostic, sessionCapabilityContext, installationPlan, inspectNativeMarketplace, SKIP_PLUGIN_MCP } from '../src/preflight.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'psst-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('runtime enforces Linux and the actual minimum Node minor version', () => {
  for (const version of ['22.22.0', '24.0.0', '24.18.9', '25.0.0', 'garbage']) assert.equal(supportedRuntime('linux', version), false);
  for (const version of ['24.19.0', '24.22.2']) assert.equal(supportedRuntime('linux', version), true);
  assert.equal(supportedRuntime('darwin', '24.22.2'), false);
});

test('hook never claims MCP availability, even when no restriction is visible', () => {
  for (const env of [{}, { [SKIP_PLUGIN_MCP]: '0' }, { [SKIP_PLUGIN_MCP]: '1' }, { [SKIP_PLUGIN_MCP]: 'true' }]) {
    const message = sessionCapabilityContext(env);
    assert.match(message, /does not prove native MCP/);
    assert.doesNotMatch(message, /broker tools are available/);
    if (['1', 'true'].includes(env[SKIP_PLUGIN_MCP])) {
      assert.match(message, /Stop setup/);
      assert.match(message, /Do not change policy/);
    }
  }
});

test('diagnostics separate inherited suppression, configured observation and native proof; never leak settings', t => {
  const root = fixture(t), path = join(root, 'settings.json');
  const content = JSON.stringify({ env: { [SKIP_PLUGIN_MCP]: '1', SECRET: 'never-show-this' }, apiKey: 'also-private' });
  writeFileSync(path, content);
  const settingsPaths = [{ path, source: 'managed_settings' }];
  const configured = pluginMcpDiagnostic({ env: { [SKIP_PLUGIN_MCP]: '0' }, settingsPaths });
  assert.equal(configured.state, 'suppression_configured_effective_state_unverified');
  assert.equal(pluginMcpDiagnostic({ env: { [SKIP_PLUGIN_MCP]: '1' }, settingsPaths: [] }).state, 'suppressed_in_process_environment');
  assert.equal(pluginMcpDiagnostic({ env: {}, settingsPaths: [] }).state, 'native_attachment_unverified');
  assert.doesNotMatch(JSON.stringify(configured), /never-show|also-private|apiKey|SECRET/);
  assert.equal(readFileSync(path, 'utf8'), content, 'read-only');
  writeFileSync(path, '{');
  assert.equal(pluginMcpDiagnostic({ env: {}, settingsPaths }).settings[0].status, 'unreadable');
  assert.equal(pluginMcpDiagnostic({ env: {}, settingsPaths: [{path: join(root, 'absent'),source:'managed_settings'}] }).settings[0].status, 'not_present');
});

test('fresh and same-source native plans are actionable; different/duplicate sources stop without surgery', t => {
  const root = fixture(t);
  const fresh = installationPlan(root, []);
  assert.equal(fresh.state, 'new_local_source');
  assert.match(fresh.next_action, /\/plugin install psst --marketplace/);
  assert.equal(installationPlan(root, [{ name: 'psst-connectors', source: 'directory', path: root }]).state, 'same_local_source');
  for (const source of [{ source: 'directory', path: join(root, 'other') }, { source: 'github', repo: 'matuto-ai/claude-code-psst-connector' }, { source: 'directory' }]) {
    const result = installationPlan(root, [{ name: 'psst-connectors', ...source }]);
    assert.equal(result.state, 'source_conflict');
    assert.match(result.next_action, /do not copy over/);
  }
  assert.equal(installationPlan(root, [{ name: 'psst-connectors', source: 'directory' }, { name: 'psst-connectors', source: 'directory' }]).state, 'source_conflict');
});

test('only documented read-only launcher invocation; missing/locked/unknown launcher stops safely', () => {
  const calls = [];
  const result = inspectNativeMarketplace('/not-secret', (...args) => { calls.push(args); return { status: 0, stdout: '[]' }; });
  assert.equal(result.state, 'new_local_source');
  assert.deepEqual(calls[0].slice(0, 2), ['claude', ['plugin','marketplace','list','--json']]);
  for (const response of [{ error: Error('secret path') }, { status: 1, stderr: 'sensitive lock details' }, { status: 0, stdout: 'not-json' }, { status: 0, stdout: '{}' }, { status: 0, stdout: '[{}]' }]) {
    const failure = inspectNativeMarketplace('/not-secret', () => response);
    assert.equal(failure.state, 'inspection_unavailable');
    assert.doesNotMatch(JSON.stringify(failure), /secret path|sensitive lock/);
  }
});

test('missing native tools have bounded native recovery, not an attachment assertion or bypass', () => {
  const diagnostic = pluginMcpDiagnostic({ env: {}, settingsPaths: [] });
  assert.equal(diagnostic.state, 'native_attachment_unverified');
  for (const message of [diagnostic.next_action, sessionCapabilityContext({})]) {
    assert.match(message, /interactive terminal/);
    assert.match(message, /existing plugin:psst:psst server is failed, select Reconnect once/);
    assert.match(message, /If absent, inspect \/plugin load errors/);
    assert.match(message, /if connected but tools remain unavailable, report that discrepancy/);
    assert.match(message, /If recovery fails, stop/);
    assert.match(message, /Never change policy, add a parallel server, edit bindings/);
    assert.doesNotMatch(message, /never attached|tools are available/);
  }
  const suppressed = pluginMcpDiagnostic({ env: { [SKIP_PLUGIN_MCP]: '1' }, settingsPaths: [] });
  assert.doesNotMatch(suppressed.next_action, /select Reconnect/);
  assert.doesNotMatch(sessionCapabilityContext({ [SKIP_PLUGIN_MCP]: '1' }), /select Reconnect/);
  const skill = readFileSync(new URL('../skills/connect/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /Entry disabled or policy restriction observed: stop/);
  assert.match(skill, /Non-interactive sessions do not/);
  assert.match(skill, /never request\nreplacement enrollment/);
});
