# 0.6.0 package and repository migration

This is a prepared, unpublished migration. Old package `@matuto-ai/claude-code-broker-connector` remains available. No release, deprecation, repository rename, account permission or user installation is performed by this change.

## Owner release order

1. Review/test this exact candidate and merge it in the existing repository. Regular `verify.yaml` keeps its five stages and does not require the future repository name: checkout uses the current repository; Psst fixture pins stay unchanged.
2. The existing GitHub repository is now `matuto-ai/claude-psst-connector`. Confirm checkout and the required `verify` check work under this final URL before publication. Do not rename it again or delete/recreate it. Update local remotes and external references you control.
3. Create/bootstrap the new public npm package through the owner's supported authenticated npm flow and configure its trusted publisher for owner `matuto-ai`, repository `claude-psst-connector`, workflow `npm-publish.yml`, allowing direct `npm publish`. The old package's trust does not transfer. Follow current npm requirements; never copy a token into source or chat. A first publish used for bootstrap consumes that version: do not attempt to publish `0.6.0` twice. If bootstrap already published the final artifact at `0.6.0`, reconcile that receipt instead of triggering a duplicate publish.
4. Only after the repository rename and publisher setup, publish GitHub release `v0.6.0` from the reviewed commit, when `0.6.0` has not already been published. This triggers publication of the **new** scoped package. Verify the workflow, package name/version and downloaded artifact before announcing availability.
5. Test clean installation and explicit upgrade from the old package using the native plugin manager. Keep exactly one active connector and retain all private Psst state. Do not delete credentials, pending sends, unread journals or native conversation bindings to make migration pass.
6. Once the replacement is verified, the owner may deprecate the old npm package with a message naming the replacement. Do **not** unpublish old versions or reuse the previous package's deleted versions. Deprecation warns; it neither migrates nor disables installed copies.

Repository and package metadata intentionally point to the final name. Version `0.6.0` under the new npm name is independent of versions under the old name. This is not 1.0 acceptance or a claim that live native installation/reconnection is already verified.

## Compatibility boundary

Only distribution names change. Existing MCP tool names, protocol/server identity (including the legacy MCP server name `claude-code-broker-connector`), environment variables, storage paths and credential/journal formats remain unchanged. The intermediate unpublished package name `@matuto-ai/claude-code-psst-connector` is superseded by `@matuto-ai/claude-psst-connector`; it is not an installation target. Never install both package names at once. Updating an npm package does not necessarily update the native plugin source already registered in the host.

Keep plugin `psst`, marketplace `psst-connectors` and CLI `psst-claude`. Do not assume the native manager can safely rebind an existing marketplace to a different source. The verified source owner updates the existing catalog's `psst` entry through its approved distribution workflow; the bundled `distribution/npm-marketplace.json` demonstrates an exact npm source without changing native identity. Preserve unrelated entries, registered source, scope, native options and all private state. A managed seed requires its administrator's rebuild/distribution step. Then use the native manager to update the existing installation and verify the loaded version and `/mcp` attachment in a fresh native session. See [managed installation and exact remaining gates](managed-native-installation.md).

References: [npm deprecation](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/) · [trusted publishers](https://docs.npmjs.com/trusted-publishers/).
