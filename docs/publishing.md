# Distribution and npm publishing

The supported native Claude marketplace install works directly from the reviewed
GitHub branch/tag. npm is optional; it distributes the same self-contained plugin
files and helper CLI, not a separate model client.

The npm package is prepared as `@matuto-ai/claude-code-broker-connector` version `0.2.1`.
No package is published by this PR. Version `0.2.0` is already public under the
`@matuto-ai` organization; this patch prepares the next GitHub release for the
owner to publish through the configured trusted publisher.
Native plugin `psst`, marketplace `psst-connectors`, and CLI `psst-claude` remain unchanged.

The release-triggered workflow follows the existing pi-intercom-review-pair
trusted-publishing pattern, adding version matching, full tests, pack/install
checks, pinned Actions, and an integration gate before publishing. It does not
store an npm token in this repository.

For the scoped npm package, configure npm's GitHub Actions trusted publisher for:
- GitHub owner: `matuto-ai`
- Repository: `claude-code-broker-connector`
- Workflow filename: `npm-publish.yml`

Creating/configuring that publisher is an account-security action for the owner.
If npm requires an initial package publication before a trusted publisher can be
configured, complete that one-time bootstrap in your authenticated npm environment.
Do not paste a token into chat or into a committed workflow. The workflow cannot
magically create publisher permissions.

After reviewing and merging the PR, create release `v0.2.1` from the reviewed
commit. The tag must match package.json. Tests run first, then npm publication
uses short-lived OIDC and provenance. Verify the Actions run and npm package
version before giving users npm install instructions. Native GitHub installation
does not require waiting for npm.

Official documentation: https://docs.npmjs.com/trusted-publishers/
