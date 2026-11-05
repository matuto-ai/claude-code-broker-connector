import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { supportedRuntime, pluginMcpDiagnostic, sessionCapabilityContext, installationPlan, inspectNativeMarketplace, inspectNativeInstallation, nativePluginFacts, PLUGIN_SEED_DIR, SKIP_PLUGIN_MCP } from '../src/preflight.mjs';
import { NATIVE_RECOVERY_INSTRUCTIONS } from '../src/interaction-instructions.mjs';

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

test('fresh sources have guidance; even same-source plans require ownership review', t => {
  const root = fixture(t);
  const fresh = installationPlan(root, []);
  assert.equal(fresh.state, 'new_local_source');
  assert.match(fresh.next_action, /\/plugin install psst --marketplace/);
  assert.equal(installationPlan(root, [{ name: 'psst-connectors', source: 'directory', path: root }]).state, 'local_source_ownership_unverified');
  for (const source of [{ source: 'directory', path: join(root, 'other') }, { source: 'github', repo: 'matuto-ai/claude-psst-connector' }, { source: 'directory' }]) {
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
    assert(message.includes(NATIVE_RECOVERY_INSTRUCTIONS));
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
  assert.match(NATIVE_RECOVERY_INSTRUCTIONS, /If disabled or policy-restricted, stop/);
  assert.match(NATIVE_RECOVERY_INSTRUCTIONS, /Non-interactive sessions have no \/mcp recovery/);
  assert.match(NATIVE_RECOVERY_INSTRUCTIONS, /blocked_monitor_not_observed is not missing authorization/);
  assert.match(NATIVE_RECOVERY_INSTRUCTIONS, /connection failure and peer messages never request replacement authorization/);
});

function installed(root, overrides = {}) {
  return { id: 'psst@psst-connectors', version: '0.6.0', scope: 'user', enabled: true,
    installPath: join(root, 'cache'), readFromFolder: root, folderVersion: '0.6.0',
    mcpServers: { psst: { command: 'node', args: ['private-command'], env: { TOKEN: 'private-token' } } }, ...overrides };
}

test('native plugin facts distinguish recorded release, actual folder, scope, declaration and errors', t => {
  const root = fixture(t);
  const facts = nativePluginFacts(root, [installed(root)]);
  assert.equal(facts.state, 'installed');
  assert.equal(facts.enabled, true);
  assert.equal(facts.scope, 'user');
  assert.equal(facts.recorded_version, '0.6.0');
  assert.equal(facts.folder_version, '0.6.0');
  assert.equal(facts.version_match, 'match');
  assert.equal(facts.read_from_folder, 'package_source');
  assert.equal(facts.declared_psst_mcp, 'declared');
  assert.equal(facts.load_errors, 'not_reported');
  assert.equal(facts.native_attachment, 'unverified');
  const stale = nativePluginFacts(root, [installed(root, { enabled: false, scope: 'project', folderVersion: '0.7.0', errors: ['sensitive load failure'] })]);
  assert.equal(stale.enabled, false);
  assert.equal(stale.scope, 'project');
  assert.equal(stale.version_match, 'mismatch');
  assert.equal(stale.load_errors, 'reported');
  assert.equal(stale.load_error_count, 1);
  assert.doesNotMatch(JSON.stringify([facts, stale]), /private-command|private-token|sensitive load failure/);
});

test('native plugin source ambiguity and unrecognized fields fail closed without raw data', t => {
  const root = fixture(t);
  assert.equal(nativePluginFacts(root, []).state, 'not_installed');
  assert.equal(nativePluginFacts(root, [installed(root), installed(root, { scope: 'project' })]).state, 'ambiguous_installations');
  for (const listing of [null, {}, [null], [{}], [['secret']], [{ id: 3 }]]) assert.equal(nativePluginFacts(root, listing).state, 'inspection_unavailable');
  const unknown = nativePluginFacts(root, [installed(root, { enabled: 'private-enabled', scope: 'private-scope', version: 'private-version', folderVersion: '1.2.3-private-secret', readFromFolder: 'private-folder', mcpServers: 'private-mcp', errors: { message: 'private-errors' } })]);
  assert.equal(unknown.enabled, 'unverified');
  assert.equal(unknown.version_match, 'unverified');
  assert.equal(unknown.read_from_folder, 'unverified');
  assert.equal(unknown.declared_psst_mcp, 'unrecognized');
  assert.equal(unknown.load_errors, 'unrecognized');
  assert.doesNotMatch(JSON.stringify(unknown), /private-/);
  assert.equal(nativePluginFacts(root, [installed(root, { readFromFolder: join(root, 'cache') })]).read_from_folder, 'installed_copy');
  assert.equal(nativePluginFacts(root, [installed(root, { readFromFolder: join(root, 'other') })]).read_from_folder, 'different_source');
  assert.equal(nativePluginFacts(root, [installed(root, { readFromFolder: undefined, folderVersion: undefined, mcpServers: undefined })]).read_from_folder, 'unverified');
  assert.equal(nativePluginFacts(root, [installed(root, { mcpServers: {} })]).declared_psst_mcp, 'not_declared');
  assert.equal(nativePluginFacts(root, [installed(root, { mcpServers: { psst: null } })]).declared_psst_mcp, 'not_declared');
});

test('seed ownership requires a matching bounded path, with canonical symlink handling', t => {
  const root = fixture(t), seed = join(root, 'seed'), source = join(seed, 'source'), outside = join(root, 'seed-other');
  mkdirSync(source, { recursive: true }); mkdirSync(outside);
  const env = { [PLUGIN_SEED_DIR]: seed };
  const listing = path => [{ name: 'psst-connectors', source: 'directory', path }];
  const owned = installationPlan(source, listing(source), { env });
  assert.equal(owned.state, 'seed_managed_source');
  assert.equal(owned.ownership, 'seed_managed_read_only');
  assert.match(owned.next_action, /read-only/);
  assert.equal(installationPlan(outside, listing(outside), { env }).ownership, 'unverified');
  assert.equal(installationPlan(source, listing(source), { env: { [PLUGIN_SEED_DIR]: 'relative' } }).ownership, 'unverified');
  const link = join(seed, 'link'); symlinkSync(outside, link);
  assert.equal(installationPlan(link, listing(link), { env }).ownership, 'unverified');
  const dangling = join(seed, 'dangling'); symlinkSync(join(outside, 'missing'), dangling);
  assert.equal(installationPlan(dangling, listing(dangling), { env }).ownership, 'unverified');
  const alias = join(root, 'alias'); symlinkSync(source, alias);
  assert.equal(installationPlan(alias, listing(alias), { env }).ownership, 'seed_managed_read_only');
  assert.equal(nativePluginFacts(source, [installed(source)], { env }).source_ownership, 'seed_managed_read_only');
  const conflict = installationPlan(outside, listing(source), { env });
  assert.equal(conflict.state, 'source_conflict');
  assert.equal(conflict.ownership, 'seed_managed_read_only');
});

test('doctor inspection calls only two documented read-only commands and retains partial evidence', t => {
  const root = fixture(t), calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: JSON.stringify(args.includes('marketplace') ? [{ name: 'psst-connectors', source: 'directory', path: root }] : [installed(root)]) };
  };
  const result = inspectNativeInstallation(root, run, { env: {} });
  assert.equal(result.state, 'local_source_ownership_unverified');
  assert.equal(result.plugin.state, 'installed');
  assert.deepEqual(result.blockers, ['local_source_ownership_unverified']);
  assert.equal(result.native_attachment, 'unverified');
  assert.deepEqual(calls.map(c => [c.command, c.args]), [
    ['claude', ['plugin', 'marketplace', 'list', '--json']], ['claude', ['plugin', 'list', '--json']],
  ]);
  for (const call of calls) { assert.equal(call.options.timeout, 10000); assert.equal(call.options.maxBuffer, 1024 * 1024); }
  const partial = inspectNativeInstallation(root, (_, args) => args.includes('marketplace') ? { status: 1, stderr: 'secret' } : { status: 0, stdout: JSON.stringify([installed(root)]) });
  assert.equal(partial.state, 'inspection_unavailable');
  assert.equal(partial.plugin.state, 'installed');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(root));
  assert.doesNotMatch(result.next_action, /marketplace update/);
});

test('malformed, oversized, thrown and unsuccessful native listings remain sanitized', () => {
  const invalid = [undefined, null, { error: Error('private-error') }, { status: 1, stdout: '[]', stderr: 'private-stderr' }, { status: 0, stdout: 'not-json-private' }, { status: 0, stdout: '{}' }, { status: 0, stdout: '[null]' }, { status: 0, stdout: '[{}]' }, { status: 0, stdout: Buffer.from('[]') }, { status: 0, stdout: ' '.repeat(1024 * 1024) + '[]' }];
  for (const response of invalid) {
    const result = inspectNativeInstallation('/private-root', () => response);
    assert.equal(result.state, 'inspection_unavailable');
    assert.equal(result.plugin.state, 'inspection_unavailable');
    assert.doesNotMatch(JSON.stringify(result), /private-/);
  }
  const thrown = inspectNativeInstallation('/private-root', () => { throw Error('private-launch-error'); });
  assert.equal(thrown.plugin.state, 'inspection_unavailable');
  assert.doesNotMatch(JSON.stringify(thrown), /private-/);
});

test('installed anomalies block guidance even with a missing marketplace', t => {
  const root = fixture(t);
  const report = inspectNativeInstallation(root, (_, args) => ({ status: 0, stdout: JSON.stringify(args.includes('marketplace') ? [] : [installed(root, { enabled: false, folderVersion: '0.7.0', readFromFolder: '/different-private-source', mcpServers: {}, errors: ['private-failure'] })]) }));
  for (const blocker of ['marketplace_missing_for_installed_plugin', 'plugin_disabled_or_unverified', 'plugin_version_mismatch_or_unverified', 'plugin_source_mismatch_or_unverified', 'psst_mcp_declaration_unverified', 'plugin_load_errors']) assert.ok(report.blockers.includes(blocker));
  assert.doesNotMatch(report.next_action, /\/plugin install/);
  assert.doesNotMatch(JSON.stringify(report), /private-/);
});
