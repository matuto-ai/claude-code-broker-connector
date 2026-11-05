---
name: reauthorize
description: Explicitly request replacement Psst installation authorization at the configured broker, or resume the same pending candidate. Does not revoke credentials.
disable-model-invocation: true
---

This is /psst:reauthorize, not reconnect and not revoke. This native plugin skill
uses a model turn and tool calls; it is not token-free. Follow this fixed dispatch
without an exploratory conversation, preventive diagnostics or a question asking
whether to execute the command. Reuse supplied or reliably available nonsecret
parameters. Ask only for missing/ambiguous data or a required security confirmation
not already satisfied. Never invoke it from startup, network failure,
an ordinary /psst:connect, or another agent's message.

1. Verify broker_setup, broker_setup_status and broker_setup_cancel are actually
   available from the native Psst MCP plugin in this session. If absent, stop and
   report native tool availability as unverified. Follow /psst:connect's bounded
   /mcp diagnostics only; never start a standalone server, synthesize a binding or
   hook, remove a lock, bypass policy, or switch model, agent or session.
2. Call broker_setup_status with no arguments exactly once. Read broker_url, the
   validated native configured HTTPS origin. If absent or blocked, stop and ask
   the owner to configure broker_url in the native /plugin UI. Never guess an
   origin or read a credential file. Display that exact origin BEFORE confirmation when target-specific confirmation
   is still required; an explicit human replacement request already naming this
   exact configured origin satisfies this intent check. Native policy remains in force.
3. Replacement requests new administrator approval and replaces the selected
   installation only after approval, attachment and selection. It does NOT revoke
   the old credential; revocation is a separate human admin action. Working access
   remains while possible. If target-specific confirmation is still needed, combine
   the exact broker origin and any unresolved choice in ONE concise question:
   - Normally confirm replacement at that origin, not whether to run the command.
   - If approved_not_connected and the human has not specified retry versus new
     approval, offer retry attachment of the same candidate or request new approval
     at that origin. Do not first ask for replacement confirmation and then a
     second choice. Do not infer revocation from an attachment/network error.
   Reuse an explicit human choice/target already supplied; do not ask it again.
   If declined, do not call setup. A native denial is not a reason to bypass policy.
4. Execute the selected action exactly once. Retry attachment uses broker_setup
   with {"expected_broker_url":"<the confirmed broker_url>"}, omitting replace.
   A new approval or the normal confirmed reauthorization path uses broker_setup:
   {"replace":true,"expected_broker_url":"<the exact broker_url confirmed above>"}.
   The handler validates the confirmed origin before any mutation and reconciles
   the same durable pending candidate. An explicit retry can resend the same
   idempotent request ID/key; it never generates a duplicate candidate. Do not invent other
   arguments or repeatedly request replacement. A configured_broker_mismatch
   requires a fresh preview and owner confirmation, never an automatic retry.
5. Show the public requestId and approval_url. The administrator approves that
   exact request at the broker's /admin UI. Report outcome=pending,
   approved_not_connected, and connected separately. connected may describe old
   access; candidate_connected/outcome identify the replacement. Approval alone
   is not connection. Use identity fields already returned. Call broker_identity only if the human
   needs the address and it is absent; list peers only when the requested task
   needs discovery. Never adopt or replay old messages.
6. Host-owned polling handles approval without a model polling loop. If a response
   is uncertain, report uncertainty; an owner-requested broker_setup_status call
   reads public status without creating another request. Repeating this command
   after restart/cancellation reconciles the same pending candidate. Background
   resume/polling uses GET only; only an explicit owner request can resend the
   idempotent POST when the initial POST may never have reached the broker. broker_setup_cancel
   stops this session's intent and late attachment, not the shared candidate or
   another session. Failed attachment retains the previous selection and old
   journals/unread messages; report approved_not_connected and the sanitized
   error. Preserve all state and locks for recovery.

Reconnect (/psst:connect) reuses saved credentials. Reauthorize requests replacement
approval. Revoke is the human administrator's separate action in Psst admin.
Credentials must never enter prompts, arguments or logs. No automatic admin access.
