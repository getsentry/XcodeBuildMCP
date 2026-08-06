import type { McpServer } from '@modelcontextprotocol/server';

/**
 * Active MCP server instances for this process.
 *
 * SDK v2 builds a fresh server per serving context (one per stdio connection,
 * one per HTTP request), so this is a set rather than a singleton. Registration
 * order is preserved: the most recently registered instance is the one a
 * process-level singleton (for example the Xcode tools bridge) should target.
 *
 * This tracks *protocol* instances only. Application session state
 * (`sessionStore`, debugger sessions, log capture) is deliberately process
 * scoped and outlives any individual server instance.
 */
const activeServers = new Set<McpServer>();

export type ServerInstanceListener = (server: McpServer | undefined) => void;

const listeners = new Set<ServerInstanceListener>();

function currentServer(): McpServer | undefined {
  let latest: McpServer | undefined;
  for (const server of activeServers) {
    latest = server;
  }
  return latest;
}

function notifyListeners(): void {
  const server = currentServer();
  for (const listener of listeners) {
    listener(server);
  }
}

/** The most recently registered active server instance, if any. */
export function getServer(): McpServer | undefined {
  return currentServer();
}

/** Every currently active server instance, in registration order. */
export function getActiveServers(): McpServer[] {
  return [...activeServers];
}

/** Registers a freshly built server instance as active. */
export function registerActiveServer(server: McpServer): void {
  activeServers.add(server);
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
