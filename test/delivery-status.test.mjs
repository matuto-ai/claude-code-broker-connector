import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryStatus } from '../src/delivery-status.mjs';

test('delivery status describes local observations, never certification or a message ACK', () => {
  for (const [connected, monitorAttention, readiness] of [
    [false, {state:'not_observed'}, 'not_connected'],
    [false, {attention_required:false}, 'not_connected'],
    [true, {state:'not_observed'}, 'blocked_monitor_not_observed'],
    [true, {attention_required:false}, 'monitor_observed'],
    [true, {attention_required:true,rate_limited:true}, 'monitor_observed'],
  ]) {
    const before=structuredClone(monitorAttention);
    const result=deliveryStatus({connected,monitorAttention});
    assert.deepEqual(result, {
      mode:'automatic_required',readiness,automatic_wakeup:'bounded_monitor_when_interactive',
      read_acknowledgment_mode:'explicit_model_read',
      native_injection_receipt:'not_provided_by_this_delivery_mode',manual_receive:'diagnostic_test_only',
    });
    assert.deepEqual(monitorAttention,before);
    for(const name of ['acknowledged','read_acknowledgment','action_success','native_acceptance_recorded'])assert.equal(Object.hasOwn(result,name),false);
  }
});
