import {
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type Transport,
  type TransportSendOptions,
} from '@modelcontextprotocol/server';
import {
  cancelledRequestId,
  isLongLivedRequestMethod,
  readModernRequestEnvelope,
  type ModernRequestEnvelope,
} from './mcp-protocol.ts';

export interface McpModernRequestObservation {
  method: string;
  envelope: ModernRequestEnvelope;
}

export interface McpRequestLifecycleObserver {
  onRequestStarted?: () => void;
  onRequestCompleted?: () => void;
  /**
   * Called once when a long-lived request opens.
   *
   * Opening a `subscriptions/listen` stream is real client activity, so it must
   * restart the idle window, but it is answered out of band and so must never
   * be counted as in-flight work or the process could never idle out.
   */
  onRequestActivity?: () => void;
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

/**
 * Observes the transport so idle shutdown knows when the server is busy.
 *
 * Three settle paths exist and all of them must be honoured, otherwise the
 * in-flight count never returns to zero and the process never idles out:
 * - an ordinary request settles when its result or error response is written;
 * - a cancelled request settles on `notifications/cancelled`, because the SDK
 *   deliberately writes no response for an aborted request;
 * - a long-lived request (`subscriptions/listen`) is answered out-of-band by
 *   the serving entry, so it is tracked separately and never counted as
 *   in-flight work. Opening one still reports activity once, so a subscription
 *   opened near the idle deadline restarts the window instead of racing it.
 */
export function instrumentMcpRequestLifecycle(
  transport: Transport,
  observer: McpRequestLifecycleObserver,
): void {
  const pendingRequestIds = new Set<string>();
  const longLivedRequestIds = new Set<string>();
  const originalStart = transport.start.bind(transport);
  const originalSend = transport.send.bind(transport);
  let onMessageWrapped = false;

  const settleRequest = (requestId: string): void => {
    if (longLivedRequestIds.delete(requestId)) {
      // Never counted as in-flight, so there is nothing to release.
      return;
    }
    if (pendingRequestIds.delete(requestId)) {
      observer.onRequestCompleted?.();
    }
  };

  const observeInbound = (message: JSONRPCMessage): string | null => {
    if (isJSONRPCRequest(message)) {
      const requestId = requestIdKey(message.id);

      if (isLongLivedRequestMethod(message.method)) {
        if (!longLivedRequestIds.has(requestId)) {
          longLivedRequestIds.add(requestId);
          observer.onRequestActivity?.();
        }
        return null;
      }

      if (!pendingRequestIds.has(requestId)) {
        pendingRequestIds.add(requestId);
        observer.onRequestStarted?.();
        return requestId;
      }
      return null;
    }

    if (isJSONRPCNotification(message)) {
      const cancelledId = cancelledRequestId(message.method, message.params);
      if (cancelledId !== null) {
        settleRequest(requestIdKey(cancelledId));
      }
    }

    return null;
  };

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
    transport.onmessage = (message, extra): void => {
      const startedRequestId = observeInbound(message);

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
    const completesLongLivedRequest =
      completedRequestId !== null && longLivedRequestIds.delete(completedRequestId);
    const completesPendingRequest =
      !completesLongLivedRequest &&
      completedRequestId !== null &&
      pendingRequestIds.delete(completedRequestId);

    try {
      await originalSend(message, options);
    } finally {
      if (completesPendingRequest) {
        observer.onRequestCompleted?.();
      }
    }
  };
}
