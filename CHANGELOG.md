# Changelog

## 0.3.0

- Native `/psst:connect` and `/psst:disconnect` work inside an existing confirmed
  Claude session; MCP tools remain available before broker configuration.
- Opt-in interactive inbox monitor emits bounded, body-free pending notices.
  Explicit receive/receipt acknowledgment remains separate from task completion.
- Private-file pairing creates installation credentials through the broker
  enrollment API; existing legacy connection bundles remain supported.
- Credential-bound durable journals, strict receipt validation and cancellation
  fences prevent cross-principal replay and late connection attachment.

Validation: 29 unit tests and 10 integration cases, including packed installation,
TLS pairing fixtures, cancellation/reconnect and legacy lifecycle preservation.
Authenticated native Claude monitor wakeup remains an explicit live acceptance
step, not a production guarantee. Interactive Claude2.1.310+ and Node24.19+ within
24.x are required for monitor use. Pairing requires the enrollment API to be
actually deployed; testing with existing legacy bundles does not.

No broker deployment, credential migration or managed-policy changes are part
of this release. Existing native permission prompts still require user consent.
