// Capability, not a per-message failure or a pending user certification step.
export const NATIVE_INJECTION_RECEIPT = 'not_provided_by_this_delivery_mode';

/** Local observations only: monitor presence does not certify model execution. */
export function deliveryStatus({ connected, monitorAttention }) {
  return {
    mode: 'automatic_required',
    readiness: !connected ? 'not_connected'
      : monitorAttention.state === 'not_observed' ? 'blocked_monitor_not_observed' : 'monitor_observed',
    automatic_wakeup: 'bounded_monitor_when_interactive',
    read_acknowledgment_mode: 'explicit_model_read',
    native_injection_receipt: NATIVE_INJECTION_RECEIPT,
    manual_receive: 'diagnostic_test_only',
  };
}
