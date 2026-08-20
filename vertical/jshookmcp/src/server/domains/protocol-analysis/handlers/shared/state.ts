import {
  ProtocolPatternEngine as _Engine,
  StateMachineInferrer as _Inferrer,
} from '@modules/protocol-analysis';
import type { EventBus, ServerEventMap } from '@server/EventBus';

export type ProtocolAtomicEvent =
  | 'protocol:pattern_detected'
  | 'protocol:payload_built'
  | 'protocol:payload_mutated'
  | 'protocol:ethernet_frame_built'
  | 'protocol:arp_built'
  | 'protocol:ip_packet_built'
  | 'protocol:icmp_echo_built'
  | 'protocol:checksum_applied'
  | 'protocol:pcap_written'
  | 'protocol:pcap_read'
  | 'protocol:pcapng_written'
  | 'protocol:pcapng_read'
  | 'protocol:dns_dissected'
  | 'protocol:http_dissected';

export type ProtocolAtomicEventPayload<K extends ProtocolAtomicEvent> = Omit<
  ServerEventMap[K],
  'timestamp'
>;

export interface ProtocolSharedState {
  engine?: _Engine;
  inferrer?: _Inferrer;
  eventBus?: EventBus<ServerEventMap>;
}

export function getEngine(state: ProtocolSharedState): _Engine {
  if (!state.engine) {
    state.engine = new _Engine();
  }
  return state.engine;
}

export function getInferrer(state: ProtocolSharedState): _Inferrer {
  if (!state.inferrer) {
    state.inferrer = new _Inferrer();
  }
  return state.inferrer;
}

export function emitProtocolEvent<K extends ProtocolAtomicEvent>(
  state: ProtocolSharedState,
  event: K,
  payload: ProtocolAtomicEventPayload<K>,
): void {
  void state.eventBus?.emit(event, {
    ...payload,
    timestamp: new Date().toISOString(),
  } as ServerEventMap[K]);
}
