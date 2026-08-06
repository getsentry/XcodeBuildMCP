/**
 * Observability adapters for the MCP serving layer.
 *
 * `Sentry.wrapMcpServerWithSentry` instruments the SDK v2 `McpServer` shape
 * (it detects `connect` plus `registerTool`/`registerResource`/`registerPrompt`)
 * and continues to produce request spans and handler error capture. What it
 * cannot see on protocol revision 2026-07-28 is the connection identity: the
 * modern era removed `initialize`, and the released integration only extracts
 * protocol version and client info from that handshake.
 *
 * This module fills exactly that gap by reading the per-request `_meta`
 * envelope the SDK already validated, so no observability is lost when a client
 * connects on the modern era.
 */

import { log } from '../utils/logger.ts';
import { recordMcpServingContextMetric, setMcpProtocolContext } from '../utils/sentry.ts';
import type { McpModernRequestObservation } from './request-lifecycle.ts';
import type { ProtocolEra } from './mcp-protocol.ts';

interface ObservedProtocolIdentity {
  protocolVersion: string;
  clientName: string | undefined;
  clientVersion: string | undefined;
  capabilityKeys: string;
}

let lastObservedIdentity: ObservedProtocolIdentity | null = null;

function identityChanged(next: ObservedProtocolIdentity): boolean {
  const previous = lastObservedIdentity;
  return (
    previous?.protocolVersion !== next.protocolVersion ||
    previous.clientName !== next.clientName ||
    previous.clientVersion !== next.clientVersion ||
    previous.capabilityKeys !== next.capabilityKeys
  );
}

/**
 * Publishes the modern-era protocol identity to Sentry.
 *
 * Every modern request carries the envelope, so this is called on a hot path:
 * it deduplicates and only re-publishes when the identity actually changes.
 */
export function recordModernProtocolEnvelope(observation: McpModernRequestObservation): void {
  const capabilities = Object.keys(observation.envelope.clientCapabilities).sort();
  const identity: ObservedProtocolIdentity = {
    protocolVersion: observation.envelope.protocolVersion,
    clientName: observation.envelope.clientInfo?.name,
    clientVersion: observation.envelope.clientInfo?.version,
    capabilityKeys: capabilities.join(','),
  };

  if (!identityChanged(identity)) {
    return;
  }

  lastObservedIdentity = identity;

  setMcpProtocolContext({
    era: 'modern',
    protocolVersion: identity.protocolVersion,
    ...(identity.clientName ? { clientName: identity.clientName } : {}),
    ...(identity.clientVersion ? { clientVersion: identity.clientVersion } : {}),
    clientCapabilities: capabilities,
  });

  log(
    'info',
    `[mcp-protocol] modern client observed: version=${identity.protocolVersion} client=${identity.clientName ?? 'unknown'}@${identity.clientVersion ?? 'unknown'} capabilities=${identity.capabilityKeys || 'none'}`,
  );
}

/** Records that a serving context constructed a fresh server instance. */
export function recordServingContextStarted(context: {
  transport: 'stdio' | 'http';
  era: ProtocolEra;
}): void {
  recordMcpServingContextMetric(context);
}

export function __resetMcpInstrumentationForTests(): void {
  lastObservedIdentity = null;
}
