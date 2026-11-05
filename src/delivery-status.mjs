// Capability, not a per-message failure or a pending user certification step.
export const NATIVE_INJECTION_RECEIPT = 'not_provided_by_this_delivery_mode';

/** Local observations only: monitor presence does not certify model execution. */
export function deliveryStatus({ connected, monitorAttention, transport }) {
  const transportReadiness = !transport ? null
    : transport.recovery === 'blocked' || transport.reception === 'blocked' || transport.heartbeat === 'blocked' ? 'blocked_transport'
    : transport.reception === 'paused' ? 'paused_receiving'
    : transport.reception === 'stopped' ? 'transport_stopped'
    : transport.reception === 'disabled' ? 'receiving_disabled'
    : transport.recovery === 'recovering' || transport.reception === 'recovering' ? 'transport_recovering'
    : transport.recovery === 'retry_waiting' || transport.reception === 'retry_waiting' || transport.heartbeat === 'unreachable' ? 'transport_retry_waiting'
    : transport.reception === 'starting' ? 'transport_starting' : null;
  return {
    mode: 'automatic_required',
    readiness: transportReadiness === 'blocked_transport' ? transportReadiness : !connected ? 'not_connected'
      : transportReadiness ?? (monitorAttention.state === 'not_observed' ? 'blocked_monitor_not_observed'
      : monitorAttention.state === 'notice_budget_unavailable' ? 'blocked_notice_budget_unavailable' : 'monitor_observed'),
    ...(transport ? { transport } : {}),
    automatic_wakeup: 'bounded_monitor_when_interactive',
    read_acknowledgment_mode: 'explicit_model_read',
    native_injection_receipt: NATIVE_INJECTION_RECEIPT,
    manual_receive: 'diagnostic_test_only',
  };
}
