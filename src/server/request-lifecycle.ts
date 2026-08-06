import {
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type Transport,
  type TransportSendOptions,
} from '@modelcontextprotocol/server';
import { readModernRequestEnvelope, type ModernRequestEnvelope } from './mcp-protocol.ts';

export interface McpModernRequestObservation {
  method: string;
  envelope: ModernRequestEnvelope;
}

export interface McpRequestLifecycleObserver {
  onRequestStarted?: () => void;
  onRequestCompleted?: () => void;
  /**
   * Called for every inbound modern-era request. Modern clients never send
   * `initialize`, so this is the only place the protocol revision and the
   * client's declared capabilities are observable at the transport seam.
   */
  onModernEnvelope?: (observation: McpModernRequestObservation) => void;
}

function requestIdKey(id: string | number): string {
  return String(id);
}

function completedRequestIdKey(message: JSONRPCMessage): string | null {
  if (isJSONRPCResultResponse(message)) {
    return requestIdKey(message.id);
  }

  if (isJSONRPCErrorResponse(message) && message.id !== undefined) {
    return requestIdKey(message.id);
  }

  return null;
}

export function instrumentMcpRequestLifecycle(
  transport: Transport,
  observer: McpRequestLifecycleObserver,
): void {
  const pendingRequestIds = new Set<string>();
  const originalStart = transport.start.bind(transport);
  const originalSend = transport.send.bind(transport);
  let onMessageWrapped = false;

  const observeModernEnvelope = (message: JSONRPCMessage): void => {
    if (!observer.onModernEnvelope || !isJSONRPCRequest(message)) {
      return;
    }
    const envelope = readModernRequestEnvelope(message.params);
    if (envelope) {
      observer.onModernEnvelope({ method: message.method, envelope });
    }
  };

  const wrapOnMessage = (): void => {
    if (onMessageWrapped || !transport.onmessage) {
      return;
    }

    onMessageWrapped = true;
    const downstreamOnMessage = transport.onmessage;
    transport.onmessage = (message, extra) => {
      let startedRequestId: string | null = null;

      if (isJSONRPCRequest(message)) {
        const requestId = requestIdKey(message.id);
        if (!pendingRequestIds.has(requestId)) {
          pendingRequestIds.add(requestId);
          startedRequestId = requestId;
          observer.onRequestStarted?.();
        }
      }

      observeModernEnvelope(message);

      try {
        downstreamOnMessage(message, extra);
      } catch (error) {
        if (startedRequestId !== null && pendingRequestIds.delete(startedRequestId)) {
          observer.onRequestCompleted?.();
        }
        throw error;
      }
    };
  };

  transport.start = async (): Promise<void> => {
    wrapOnMessage();
    await originalStart();
  };

  transport.send = async (
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<void> => {
    const completedRequestId = completedRequestIdKey(message);
    const completesPendingRequest =
      completedRequestId !== null && pendingRequestIds.delete(completedRequestId);

    try {
      await originalSend(message, options);
    } finally {
      if (completesPendingRequest) {
        observer.onRequestCompleted?.();
      }
    }
  };
}
