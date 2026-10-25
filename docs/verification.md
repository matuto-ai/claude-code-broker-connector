# Native plugin verification — October 24, 2026

The `0.2.0` native plugin replaces the wrapper-only installation path described
in the historical notes below. The legacy wrapper remains tested but is not the
normal operator entry point.

On cloud Linux, Node 24.22.1:

- Syntax checks passed for all adapter and vendored modules.
- Unit tests cover native binding/lifecycle, config bundle restrictions, source
  pins, stdio boundaries, explicit cooperative acknowledgment, malformed/unread/
  departed/uncertain message rejection, durable receipt retries and storage faults.
- A real `npm pack` artifact was installed offline with scripts disabled into an
  empty temporary prefix. Native manifests/hooks/MCP/runtime/license were present;
  helper CLI and local doctor ran without a sibling broker checkout or network call.
- Two real-broker integration tests passed, including native-plugin startup before
  SessionStart, multiple messages, exact receipt acknowledgment, reply, same-native-
  session MCP restart preserving identity/inbox, and native SessionEnd closure.
  Their native parent is synthetic, not a logged-in Claude model session.
- Official Claude Code **2.1.309** (`@anthropic-ai/claude-code-linux-x64`) validated
  the native plugin/marketplace manifest. The only remaining warning is cosmetic:
  no directory listing icon. This is not a marketplace approval claim.
- With a fresh isolated HOME and **no authentication/model credentials**, actual
  Claude `--plugin-dir ... --init-only` launched an instrumented MCP process and
  exec-form SessionStart hook. Both reported the same native Claude parent PID and
  Linux process-start identity; SessionStart supplied the real native session UUID.
  This verifies the critical direct-parent binding assumption, independently of
  synthetic transport tests. A repeatable `scripts/audit-native.mjs` probe accepts
  an existing official executable via `CLAUDE_AUDIT_BIN` and makes no model request.

```sh
CLAUDE_AUDIT_BIN=/absolute/path/to/claude npm run audit:claude
```

Shared runtime hashes remain byte-identical to the reviewed Psst commit below.
The separately attributed adapter files add explicit application read ACK and
bounded MCP tool schemas; **they do not fabricate native acceptance receipts**.

Not tested here: authenticated Claude/model round-trip in Bruno's sandbox,
permission UI, his TLS/token mounts, all Claude versions, non-Linux platforms,
or automatic wakeup. Those are not implied by health checks or the native ABI
probe. Restart after installation; after `/clear`, reconnect Psst or restart.
No user credentials, production configuration, npm release or main merge occurred.

## Historical wrapper foundation evidence


2026-10-23 cloud Linux, Node 24.19.0 / SQLite 3.53.3:
`npm run check` and **12/12 tests passed** against shared broker commit
`ba2219cd87a1feac23e01b23d2c2b3d3bdd65359`.

The end-to-end fixture spawns a **synthetic Claude CLI**, real native-hook helper
processes, the real standard MCP subprocess, shared HTTP broker and SQLite inbox.
It checks lifecycle confirmation, exact ownership, delivery ACK, model-visible
AGENT warning, cooperative non-consumption and clean native shutdown. Focused
tests cover main/subagent guards, unknown/switched lifetime, PID reuse defense,
model metadata, EOF during registration, bounded arguments and tamper-rejected
reference source. The fake executable's `0.0.0` version is not a vendor version.

Not run: actual authenticated Claude TUI/broker flow, provider calls, real permission
UI, native hook ordering under clear/resume/compact/model switch, rootless Podman
or two-host TLS LAN. Ordinary MCP tools may require human approval; none was
bypassed. This PR is not a full issue #9 completion claim.

Required next gates:

1. Pin an official CLI version and verify all launch/hook events against it,
   including root session and subagent tool routing and MCP restart.
2. Confirm actual provider-visible tool-result provenance with hostile body text
   (`yes`, fake channel boundaries and prompt-injection strings).
3. Keep human drafts, active work and approvals untouched. Cooperative tools are
   invoked only in native flow; no automatic event may inject a prompt.
4. Establish a supported durable native acceptance receipt before consuming any
   inbox head. Channel opt-in alone is insufficient and permission relay must
   remain disabled.
5. Package and test separate CLI+adapter rootless containers and two-host LAN.


## Official Claude 2.1.309 compatibility audit

On 2026-10-23, the official npm packages `@anthropic-ai/claude-code@2.1.309`
and `@anthropic-ai/claude-code-linux-x64@2.1.309` were unpacked in a disposable
cloud directory with npm lifecycle scripts disabled. No user installation,
credentials, login, model request or existing configuration was used.

The actual native Linux x64 executable reported `2.1.309 (Claude Code)` and
internal commit `1ce7e4ff2da8`. Its SHA256 was:

```text
4d704a8aecbe038affa3000f498ae17c1b4f753add8facb8764120affc99b658
```

Verified with a fresh private HOME and empty test project:

1. Actual `--help` lists `--session-id`, `--settings` and `--mcp-config`. The
   version output matches the existing launcher's exact-version check.
2. `claude --settings <generated-settings.json> doctor` accepted the launcher's
   SessionStart/SessionEnd/PostModelSwitch/PreToolUse hook configuration. A
   negative control changing `args` from an array to a number produced an explicit
   invalid-settings diagnostic. Doctor exits zero even for that diagnostic, so
   the output—not exit code alone—was checked.
3. `claude --settings <isolated-setup-hook.json> --init-only` executed a Setup hook
   with the same `command` plus `args` form. One argument containing spaces,
   apostrophe, dollar sign, semicolon and backtick arrived unchanged. It exited
   zero without authentication or a model call. This verifies exec-form mechanics;
   it does not claim that Setup is an adapter lifecycle event.

This agrees with the official [hook exec-form reference](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form)
and [CLI flags reference](https://code.claude.com/docs/en/cli-reference#cli-flags).
No runtime source change was needed. Shared reference pin and the 12-test
synthetic/real-broker fixture coverage above are unchanged.

For a user-local test, set `expectedCliVersion` to `2.1.309` and `claudeBinary`
to the absolute installed executable path in each private adapter config. Launch
`bin/launch.mjs` with an explicit Node 24.19.0 executable: that exact Node path is
propagated to hooks and MCP subprocesses, without changing global Node. Use two
fresh interactive sessions with separate state directories/names, and approve
ordinary native MCP prompts yourself. See [launch configuration](integration.md).

**Still unverified by this audit:** authenticated SessionStart-to-MCP ordering,
actual two-session broker/model exchange, permission UI, clear/resume/compact and
subagent routing in the real TUI. There were no live broker or model calls in this
compatibility audit. The adapter still peeks rather than consumes its inbox.
