import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryStatus } from '../src/delivery-status.mjs';

test('transport health takes precedence over monitor presence without confusing pauses with retry', () => {
  const healthy={heartbeat:'healthy',reception:'healthy',recovery:'idle',error_code:null};
  for(const [change,readiness] of [
    [{},'monitor_observed'],
    [{reception:'polling'},'monitor_observed'],
    [{heartbeat:'unreachable'},'transport_retry_waiting'],
    [{reception:'retry_waiting',recovery:'retry_waiting',error_code:'request_failed'},'transport_retry_waiting'],
    [{reception:'recovering',recovery:'recovering'},'transport_recovering'],
    [{reception:'blocked',recovery:'blocked',error_code:'invalid_response'},'blocked_transport'],
    [{heartbeat:'blocked',error_code:'forbidden'},'blocked_transport'],
    [{reception:'paused'},'paused_receiving'],
    [{reception:'paused',recovery:'retry_waiting',heartbeat:'unreachable'},'paused_receiving'],
    [{reception:'stopped',recovery:'stopped'},'transport_stopped'],
    [{reception:'disabled'},'receiving_disabled'],
    [{reception:'starting'},'transport_starting'],
  ]){
    const transport={...healthy,...change};
    const result=deliveryStatus({connected:true,monitorAttention:{attention_required:false},transport});
    assert.equal(result.readiness,readiness);assert.deepEqual(result.transport,transport);
    assert.equal(result.read_acknowledgment_mode,'explicit_model_read');
  }
  const blocked={...healthy,recovery:'blocked',error_code:'session_expired'};
  assert.equal(deliveryStatus({connected:false,monitorAttention:{state:'not_observed'},transport:blocked}).readiness,'blocked_transport');
});

test('delivery status describes local observations, never certification or a message ACK', () => {
  for (const [connected, monitorAttention, readiness] of [
    [false, {state:'not_observed'}, 'not_connected'],
    [false, {attention_required:false}, 'not_connected'],
    [true, {state:'not_observed'}, 'blocked_monitor_not_observed'],
    [true, {state:'notice_budget_unavailable',attention_required:true}, 'blocked_notice_budget_unavailable'],
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
