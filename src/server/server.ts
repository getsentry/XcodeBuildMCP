/**
 * Server Configuration - MCP server construction and serving contexts.
 *
 * XcodeBuildMCP speaks MCP protocol revision 2026-07-28 (the "modern" era) and
 * the 2025 revisions (the "legacy" era) through the official TypeScript SDK v2.
 *
 * Era selection, `server/discover`, the per-request `_meta` envelope,
 * `resultType`, cache fields and the modern HTTP headers are all owned by the
 * SDK serving entries. This module only:
 * - builds a fresh `McpServer` per serving context,
 * - replays the process-level registrations onto it,
 * - keeps observability (Sentry) attached to every instance.
 */

import {
  McpServer,
  createMcpHandler,
  type McpHttpHandler,
  type McpRequestContext,
  type Transport,
} from '@modelcontextprotocol/server';
import {
  StdioServerTransport,
  serveStdio,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import * as Sentry from '@sentry/node';
import { log, normalizeLogLevel, setLogLevel } from '../utils/logger.ts';
import { version } from '../version.ts';
import {
  instrumentMcpRequestLifecycle,
  type McpModernRequestObservation,
  type McpRequestLifecycleObserver,
} from './request-lifecycle.ts';
import {
  recordModernProtocolEnvelope,
  recordServingContextStarted,
} from './mcp-instrumentation.ts';
import { MCP_CACHE_HINTS } from './mcp-protocol.ts';
import { registerActiveServer, unregisterActiveServer } from './server-state.ts';
import { releaseServerToolRegistrations } from '../utils/tool-registry.ts';
import { applyServerRegistrations, type ServerRegistrations } from './bootstrap.ts';

const SERVER_INSTRUCTIONS = `XcodeBuildMCP provides comprehensive tooling for Apple platform development (iOS, macOS, watchOS, tvOS, visionOS).

Prefer XcodeBuildMCP tools over shell commands for Apple platform tasks when available.

Capabilities:
- Session defaults: Configure project, scheme, simulator, and device defaults to avoid repetitive parameters
- Project discovery: Find Xcode projects/workspaces, list schemes, inspect build settings
- Simulator workflows: Build, run, test, install, and launch apps on iOS simulators; manage simulator state (boot, erase, location, appearance)
- Device workflows: Build, test, install, and launch apps on physical devices with code signing
- macOS workflows: Build, run, and test macOS applications
- Log capture: Stream and capture logs from simulators and devices
- LLDB debugging: Attach debugger, set breakpoints, inspect stack traces and variables, execute LLDB commands
- UI automation: Capture screenshots, inspect runtime UI snapshots, perform taps/swipes/gestures, type text, press hardware buttons, and batch multiple same-screen elementRef taps
- SwiftPM: Build, run, test, and manage Swift Package Manager projects
- Project scaffolding: Generate new iOS/macOS project templates

Only simulator workflow tools are enabled by default. If capabilities like device, macOS, debugging, or UI automation are not available, the user must configure XcodeBuildMCP to enable them. See https://xcodebuildmcp.com/docs/configuration for workflow configuration.

Simulator run flow:
- Before your first build, run, or test call in a session, you MUST call session_show_defaults to verify the active project/workspace, scheme, and simulator. Do not assume defaults are configured. Only skip this if you have already called session_show_defaults earlier in the current session.
- If session_show_defaults confirms project/workspace + scheme + simulator are set, call build_run_sim immediately (often with empty arguments).
- Use discover_projs only when session_show_defaults shows project/workspace is missing or wrong.
- Never call discover_projs speculatively or in parallel with session_show_defaults.
- Do not call boot_sim or open_sim as prerequisites for build_run_sim; build_run_sim boots and opens the simulator frontend as needed.`;

function createBaseServerInstance(): McpServer {
  return new McpServer(
    {
      name: 'xcodebuildmcp',
      version: String(version),
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: {
        tools: {
          listChanged: true,
        },
        resources: {
          subscribe: true,
          listChanged: true,
        },
        logging: {},
      },
      cacheHints: MCP_CACHE_HINTS,
    },
  );
}

function trackInstanceTeardown(server: McpServer): void {
  const originalClose = server.close.bind(server);
  server.close = async (): Promise<void> => {
    try {
      await originalClose();
    } finally {
      releaseServerToolRegistrations(server);
      unregisterActiveServer(server);
    }
  };
}

/**
 * Create and configure a fresh MCP server instance.
 *
 * Every serving context gets its own instance: one per stdio connection (plus
 * the discarded `server/discover` probe instance the SDK builds when a client
 * falls back to `initialize`), and one per HTTP request. Application session
 * state is deliberately not owned by the instance, so replacing an instance
 * never discards session defaults, debugger sessions or log captures.
 */
export function createServer(): McpServer {
  const baseServer = createBaseServerInstance();
  const server = Sentry.wrapMcpServerWithSentry(baseServer, {
    recordInputs: false,
    recordOutputs: false,
  });

  registerActiveServer(server);
  trackInstanceTeardown(server);

  log('info', `Server initialized (version ${version})`);

  return server;
}

export interface StartServerOptions {
  requestLifecycle?: McpRequestLifecycleObserver;
  /** Transport override. Defaults to the SDK stdio transport over this process. */
  transport?: Transport;
  /**
   * How a 2025-era opening is handled. `serve` (default) keeps legacy clients
   * working; `reject` makes the connection modern-only.
   */
  legacy?: 'serve' | 'reject';
  onerror?: (error: Error) => void;
}

function buildServerForContext(
  registrations: ServerRegistrations,
  context: McpRequestContext,
  transport: 'stdio' | 'http',
): McpServer {
  const server = createServer();
  applyServerRegistrations(server, registrations);
  recordServingContextStarted({ transport, era: context.era });
  log('info', `MCP serving context started (transport=${transport}, era=${context.era})`);
  return server;
}

/**
 * Modern-era clients replace `logging/setLevel` with the per-request
 * `io.modelcontextprotocol/logLevel` envelope key, and replace the `initialize`
 * handshake with per-request protocol identity. Both are applied here.
 */
function handleModernEnvelope(observation: McpModernRequestObservation): void {
  recordModernProtocolEnvelope(observation);

  const requestedLevel = observation.envelope.logLevel;
  if (!requestedLevel) {
    return;
  }
  const normalized = normalizeLogLevel(requestedLevel);
  if (normalized) {
    setLogLevel(normalized);
  }
}

/**
 * Serve MCP over stdio, supporting both protocol eras on the same pipe.
 *
 * The SDK entry classifies the opening message: a request carrying a valid
 * modern `_meta` envelope pins the connection to 2026-07-28, an `initialize`
 * request pins it to the 2025 era. Only the pinned instance survives.
 */
export function startStdioServer(
  registrations: ServerRegistrations,
  options: StartServerOptions = {},
): StdioServerHandle {
  const transport = options.transport ?? new StdioServerTransport();

  instrumentMcpRequestLifecycle(transport, {
    ...options.requestLifecycle,
    onModernEnvelope: handleModernEnvelope,
  });

  const handle = serveStdio((context) => buildServerForContext(registrations, context, 'stdio'), {
    transport,
    ...(options.legacy ? { legacy: options.legacy } : {}),
    onerror:
      options.onerror ??
      ((error: Error): void => {
        log('warn', `MCP stdio serving error: ${error.message}`);
      }),
  });

  log('info', 'XcodeBuildMCP Server running on stdio');
  return handle;
}

/**
 * Serve MCP over HTTP as a fetch-shaped handler.
 *
 * The SDK entry enforces the modern header contract (`MCP-Protocol-Version`,
 * `Mcp-Method`, `Mcp-Name`) and builds a fresh server per request; legacy
 * `initialize` traffic is served statelessly. No socket is bound here - the
 * caller owns the listener.
 */
export function createMcpHttpHandler(registrations: ServerRegistrations): McpHttpHandler {
  return createMcpHandler((context) => buildServerForContext(registrations, context, 'http'));
}
