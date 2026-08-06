import type { McpServer } from '@modelcontextprotocol/server';

/**
 * How long a server instance serves.
 *
 * A `connection` instance is pinned for the lifetime of a transport connection
 * (stdio). A `request` instance serves exactly one HTTP request and is closed
 * as soon as the response is written.
 */
export type McpServingScope = 'connection' | 'request';

/**
 * Active MCP server instances for this process.
 *
 * SDK v2 builds a fresh server per serving context (one per stdio connection,
 * one per HTTP request), so this is a set rather than a singleton. Registration
 * order is preserved.
 *
 * This tracks *protocol* instances only. Application session state
 * (`sessionStore`, debugger sessions, log capture) is deliberately process
 * scoped and outlives any individual server instance.
 */
const activeServers = new Map<McpServer, McpServingScope>();

export type ServerInstanceListener = (server: McpServer | undefined) => void;

const listeners = new Set<ServerInstanceListener>();

/**
 * The instance a process-level singleton should target.
 *
 * Connection-scoped instances win: a per-request HTTP instance must never
 * shadow the live stdio connection, and it is closed before any process-level
 * consumer could usefully hold on to it.
 */
function currentServer(): McpServer | undefined {
  let latestConnection: McpServer | undefined;
  let latestAny: McpServer | undefined;
  for (const [server, scope] of activeServers) {
    latestAny = server;
    if (scope === 'connection') {
      latestConnection = server;
    }
  }
  return latestConnection ?? latestAny;
}

function notifyListeners(): void {
  const server = currentServer();
  for (const listener of listeners) {
    listener(server);
  }
}

/** The active server instance a process-level singleton should target, if any. */
export function getServer(): McpServer | undefined {
  return currentServer();
}

/** Every currently active server instance, in registration order. */
export function getActiveServers(): McpServer[] {
  return [...activeServers.keys()];
}

/** Registers a freshly built server instance as active. */
export function registerActiveServer(
  server: McpServer,
  scope: McpServingScope = 'connection',
): void {
  activeServers.set(server, scope);
  notifyListeners();
}

/** Removes a server instance that is no longer serving. */
export function unregisterActiveServer(server: McpServer): void {
  if (activeServers.delete(server)) {
    notifyListeners();
  }
}

/**
 * Subscribes to active-instance changes. Used by process-level singletons that
 * must re-bind their registrations when a serving context is replaced.
 */
export function onActiveServerChanged(listener: ServerInstanceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetServerStateForTests(): void {
  activeServers.clear();
  listeners.clear();
}
