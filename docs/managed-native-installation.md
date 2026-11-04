# Native installation and administrator-owned upgrades

This candidate supplies an identity-preserving distribution path. It does not change a live sandbox, publish a release,
or certify authenticated automatic delivery. Issue #11 remains open for those gates.

## Keep the existing identity and source registration

`psst@psst-connectors` is the native plugin identity. The npm package name is a
download location, not that identity. Installing a new npm prefix does not replace
the source already registered in Claude. Do not remove/re-add the marketplace,
copy over an unknown managed folder, edit native caches/registries, create a
parallel MCP entry, or install a second differently named connector.

The read-only `psst-claude doctor` queries the exposed native launcher's marketplace
and plugin lists. It reports sanitized scope, enabled status, recorded version,
in-place folder version when present, declared Psst MCP, load-error count, source
conflict and seed ownership. It never includes raw plugin command/environment,
error text, source paths or native options. Matching paths alone do not prove
ownership. These facts are declarations, not evidence that a running session has
attached the MCP server or connected to Psst.

## Supported catalog update for the administrator

After the reviewed npm publication is verified, `distribution/npm-marketplace.json`
provides the `psst` entry pointing to the exact candidate package version. The
administrator who owns the existing persistent `psst-connectors` catalog can
update **that entry's contents** through its normal controlled distribution
workflow. Preserve the marketplace's name and registered source, the plugin name,
all unrelated entries, the installed scope, existing enabled state and native
options. The artifact is a reference catalog, not an instruction to overwrite an
unknown live catalog. The normal source checkout retains `source: "./"` for
reviewed source installations.

Once the catalog owner has updated it, the exposed native manager can refresh the
same marketplace and update the same plugin at its verified existing scope. In
the user's existing session use `/plugin` to select that installation. Where its
non-interactive CLI is exposed, the corresponding commands are:

```sh
claude plugin marketplace update psst-connectors
claude plugin update psst@psst-connectors --scope user
```

`user` above is an example, not permission to change a managed/project/local
installation's scope. Restart the native session after the update and verify the
loaded version. There is no supported source-rebind instruction here. A different
same-name marketplace is a conflict, not a fallback installation route.

For ordinary local `./` sources, native loading may read the source folder in
place. Its folder version can differ from the install record. The source owner
must distribute the intended contents; updating an unrelated npm prefix will
not do that. For a marketplace supplied under `CLAUDE_CODE_PLUGIN_SEED_DIR`,
the runtime source is read-only: its owner rebuilds and distributes the seed
through the documented container workflow. A native user update cannot replace
that administrative step. Seed ownership and installation scope are different.

Do not recommend direct `<package>@npm` as a migration: in official 2.1.310 it has
a different native identity and account-gated availability. Use the documented
npm **entry inside the existing marketplace** instead.

## Attach and authorize separately

Only the existing native surfaces are needed, including when shell access is
limited to in-session `!` commands. No separate terminal, nested Claude process,
startup flag, internal binary or new API key is required of the user.

1. In `/plugin`, inspect the existing Psst installation, version, scope and load
   errors after the administrator's distribution step.
2. In `/mcp`, verify the existing `plugin:psst:psst` server. If failed, one native
   Reconnect is a diagnostic step. If absent, disabled or restricted, stop with
   the sanitized evidence. A hook or skill appearing is not an MCP attachment.
3. If `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS` is observed, ask the owner of the
   approved launcher/settings to resolve the policy decision. Do not unset or
   override it, and do not add a separate MCP server to evade it.
4. When the real native tools are present, configure only `broker_url` in the
   existing plugin's native configuration. Explicit `/psst:connect` requests
   approval. The broker administrator approves that exact request in `/admin`.
   A URL, an MCP connection and a successful plugin install are not authorization.

## Qualification and remaining acceptance

The maintained automatic suite checks connector decisions with focused unit tests.
The former official-host/container qualification harness has been removed. Unit
results do not certify the native package manager, a live upgrade or authenticated
automatic delivery.

The remaining live prerequisites are concrete:

- Identify the actual sandbox launcher/bootstrap or seed owner. The connector
  repository does not own an unidentified managed marketplace or launch policy.
- Publish the reviewed package through the owner's approved release workflow and
  have that owner update the existing catalog/seed without changing its identity.
- In an accessible authenticated native session, verify actual `/mcp` attachment,
  then URL-only setup, exact broker admin approval and two independent sessions.
- Exercise automatic monitor delivery while idle, busy and typing, reconnect,
  broker restart, native restart and persisted sandbox recreation. Record native
  model read/ACK evidence separately from transport storage or fixture tool calls.

Unit tests do not substitute for those authenticated automatic-delivery checks.
Current repository evidence must not close
#11 or mark the release as fully accepted by itself.

References: [native plugin commands](https://code.claude.com/docs/en/plugins/cli-reference),
[npm marketplace entries](https://code.claude.com/docs/en/plugins/marketplace-reference#npm-plugin-source),
[in-place loading](https://code.claude.com/docs/en/plugins/loading#in-place-and-copied-plugins),
[container seeds](https://code.claude.com/docs/en/plugins/org#seed-containers-and-ci).
