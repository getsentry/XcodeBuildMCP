/**
 * MCP protocol constants and pure helpers shared by every serving context.
 *
 * Everything here is either re-exported from the official SDK v2 packages or a
 * small pure helper over spec-defined names. No protocol behaviour is
 * implemented here - encoding, validation, negotiation and era selection are
 * owned by the SDK serving entries (`serveStdio`, `createMcpHandler`).
 */

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  LOG_LEVEL_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  type CacheHint,
  type ClientCapabilities,
  type Implementation,
  type ProtocolEra,
  type ServerOptions,
} from '@modelcontextprotocol/server';

export {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  LOG_LEVEL_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
};

export type { ProtocolEra };

/**
 * The first modern-era protocol revision. Modern clients send this in every
 * request `_meta` envelope; the SDK keeps its own copy internal, so the value
 * is restated here for logging, telemetry and tests.
 */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/**
 * HTTP header carrying the protocol revision on modern-era requests. It must
 * match `_meta['io.modelcontextprotocol/protocolVersion']` in the body.
 */
export const MCP_PROTOCOL_VERSION_HEADER = 'MCP-Protocol-Version';

/** HTTP header carrying the JSON-RPC method of a modern-era request. */
export const MCP_METHOD_HEADER = 'Mcp-Method';

/**
 * HTTP header carrying the primary target of a modern-era request:
 * `params.name` for `tools/call` and `prompts/get`, `params.uri` for
 * `resources/read`.
 */
export const MCP_NAME_HEADER = 'Mcp-Name';

const NAME_HEADER_METHODS = new Set(['tools/call', 'prompts/get']);
const URI_HEADER_METHODS = new Set(['resources/read']);

/**
 * The `Mcp-Name` header value a modern-era HTTP request must carry for the
 * given method/params, or `undefined` when the method does not require one.
 */
export function mcpNameHeaderValue(method: string, params: unknown): string | undefined {
  if (params === null || typeof params !== 'object') {
    return undefined;
  }

  const record = params as Record<string, unknown>;
  if (NAME_HEADER_METHODS.has(method) && typeof record.name === 'string') {
    return record.name;
  }
  if (URI_HEADER_METHODS.has(method) && typeof record.uri === 'string') {
    return record.uri;
  }
  return undefined;
}

/**
 * Header values that are not printable US-ASCII must be transported using the
 * spec's base64 sentinel form.
 */
export function encodeMcpHeaderValue(value: string): string {
  if (/^[\u0020-\u007e]*$/.test(value)) {
    return value;
  }
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Builds the modern-era HTTP headers required for a JSON-RPC request body.
 */
export function buildModernHttpHeaders(
  method: string,
  params: unknown,
  protocolVersion: string = MODERN_PROTOCOL_VERSION,
): Record<string, string> {
  const headers: Record<string, string> = {
    [MCP_PROTOCOL_VERSION_HEADER]: protocolVersion,
    [MCP_METHOD_HEADER]: method,
  };

  const name = mcpNameHeaderValue(method, params);
  if (name !== undefined) {
    headers[MCP_NAME_HEADER] = encodeMcpHeaderValue(name);
  }

  return headers;
}

/**
 * The modern-era per-request envelope, as observed on the wire.
 *
 * Modern clients do not send `initialize`, so the protocol revision and the
 * client's declared capabilities arrive on every single request instead.
 */
export interface ModernRequestEnvelope {
  protocolVersion: string;
  clientInfo?: Implementation;
  clientCapabilities: ClientCapabilities;
  logLevel?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads the modern-era envelope out of request params, or returns `null` for
 * legacy-era requests (which carry no envelope).
 *
 * Read-only: validation and rejection of malformed envelopes is the SDK's job.
 */
export function readModernRequestEnvelope(params: unknown): ModernRequestEnvelope | null {
  if (!isRecord(params)) {
    return null;
  }

  const meta = params._meta;
  if (!isRecord(meta)) {
    return null;
  }

  const protocolVersion = meta[PROTOCOL_VERSION_META_KEY];
  if (typeof protocolVersion !== 'string') {
    return null;
  }

  const clientInfo = meta[CLIENT_INFO_META_KEY];
  const clientCapabilities = meta[CLIENT_CAPABILITIES_META_KEY];
  const logLevel = meta[LOG_LEVEL_META_KEY];

  return {
    protocolVersion,
    ...(isRecord(clientInfo) ? { clientInfo: clientInfo as unknown as Implementation } : {}),
    clientCapabilities: isRecord(clientCapabilities)
      ? (clientCapabilities as unknown as ClientCapabilities)
      : {},
    ...(typeof logLevel === 'string' ? { logLevel } : {}),
  };
}

const MINUTE_MS = 60_000;

/**
 * Requests the serving entry answers out-of-band rather than with an ordinary
 * JSON-RPC result.
 *
 * `subscriptions/listen` opens a long-lived notification stream: the entry
 * replies with `notifications/subscriptions/acknowledged` immediately and only
 * writes the JSON-RPC result when the subscription ends (client cancellation or
 * connection teardown). Treating it as an ordinary in-flight request would pin
 * idle-shutdown accounting open for the lifetime of the subscription.
 */
export const LONG_LIVED_REQUEST_METHODS: ReadonlySet<string> = new Set(['subscriptions/listen']);

/** Whether a request opens a long-lived stream instead of settling with a result. */
export function isLongLivedRequestMethod(method: string): boolean {
  return LONG_LIVED_REQUEST_METHODS.has(method);
}

/**
 * The request id a `notifications/cancelled` notification settles, or `null`
 * when the notification is not a cancellation.
 *
 * A cancelled request never receives a JSON-RPC response, so this is the only
 * signal that its in-flight accounting can be released.
 */
export function cancelledRequestId(method: string, params: unknown): string | number | null {
  if (method !== 'notifications/cancelled' || params === null || typeof params !== 'object') {
    return null;
  }

  const requestId = (params as Record<string, unknown>).requestId;
  return typeof requestId === 'string' || typeof requestId === 'number' ? requestId : null;
}

/**
 * Cache hints for the modern-era cacheable results (`ttlMs` / `cacheScope`).
 *
 * All XcodeBuildMCP results depend on the local workspace, the enabled
 * workflows and the connected Xcode installation, so nothing is shareable
 * between authorization contexts: every scope is `private`. TTLs are short
 * because the tool and resource catalogues change dynamically (workflow
 * selection, Xcode bridge sync).
 */
export const MCP_CACHE_HINTS: NonNullable<ServerOptions['cacheHints']> = {
  'server/discover': { ttlMs: 5 * MINUTE_MS, cacheScope: 'private' },
  'tools/list': { ttlMs: MINUTE_MS, cacheScope: 'private' },
  'prompts/list': { ttlMs: MINUTE_MS, cacheScope: 'private' },
  'resources/list': { ttlMs: MINUTE_MS, cacheScope: 'private' },
  'resources/templates/list': { ttlMs: MINUTE_MS, cacheScope: 'private' },
  'resources/read': { ttlMs: 0, cacheScope: 'private' },
};

/**
 * Cache hint for a single registered resource. Resource contents are derived
 * from live runtime state (session defaults, device lists), so they are never
 * cached beyond the current request.
 */
export const MCP_RESOURCE_CACHE_HINT: CacheHint = { ttlMs: 0, cacheScope: 'private' };
