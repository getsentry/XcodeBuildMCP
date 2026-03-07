#!/usr/bin/env node

/**
 * MCP Server Startup Module
 *
 * This module provides the logic to start the XcodeBuildMCP server.
 * It can be invoked from the CLI via the `mcp` subcommand.
 */

import { createServer, startServer } from './server.ts';
import { log, setLogLevel } from '../utils/logger.ts';
import {
  enrichSentryContext,
  flushAndCloseSentry,
  initSentry,
  setSentryRuntimeContext,
} from '../utils/sentry.ts';
import { getDefaultDebuggerManager } from '../utils/debugger/index.ts';
import { version } from '../version.ts';
import process from 'node:process';
import { bootstrapServer } from './bootstrap.ts';
import { shutdownXcodeToolsBridge } from '../integrations/xcode-tools-bridge/index.ts';
import { createStartupProfiler, getStartupProfileNowMs } from './startup-profiler.ts';
import { getConfig } from '../utils/config-store.ts';
import { getRegisteredWorkflows } from '../utils/tool-registry.ts';
import { hydrateSentryDisabledEnvFromProjectConfig } from '../utils/sentry-config.ts';

/**
 * Start the MCP server.
 * This function initializes Sentry, creates and bootstraps the server,
 * sets up signal handlers for graceful shutdown, and starts the server.
 */
export async function startMcpServer(): Promise<void> {
  try {
    const profiler = createStartupProfiler('start-mcp-server');

    // MCP mode defaults to info level logging
    // Clients can override via logging/setLevel MCP request
    setLogLevel('info');

    await hydrateSentryDisabledEnvFromProjectConfig();

    let stageStartMs = getStartupProfileNowMs();
    initSentry({ mode: 'mcp' });
    profiler.mark('initSentry', stageStartMs);

    stageStartMs = getStartupProfileNowMs();
    const server = createServer();
    profiler.mark('createServer', stageStartMs);

    stageStartMs = getStartupProfileNowMs();
    const bootstrap = await bootstrapServer(server);
    profiler.mark('bootstrapServer', stageStartMs);

    stageStartMs = getStartupProfileNowMs();
    await startServer(server);
    profiler.mark('startServer', stageStartMs);

    const config = getConfig();
    const enabledWorkflows = getRegisteredWorkflows();
    setSentryRuntimeContext({
      mode: 'mcp',
      enabledWorkflows,
      disableSessionDefaults: config.disableSessionDefaults,
      disableXcodeAutoSync: config.disableXcodeAutoSync,
      incrementalBuildsEnabled: config.incrementalBuildsEnabled,
      debugEnabled: config.debug,
      uiDebuggerGuardMode: config.uiDebuggerGuardMode,
      xcodeIdeWorkflowEnabled: enabledWorkflows.includes('xcode-ide'),
    });

    void bootstrap.runDeferredInitialization().catch((error) => {
      log(
        'warn',
        `Deferred bootstrap initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    setImmediate(() => {
      enrichSentryContext();
    });

    type ShutdownReason = NodeJS.Signals | 'stdin-end' | 'stdin-close';

    let shuttingDown = false;
    const shutdown = async (reason: ShutdownReason): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;

      if (reason === 'stdin-end') {
        log('info', 'MCP stdin ended; shutting down MCP server');
      } else if (reason === 'stdin-close') {
        log('info', 'MCP stdin closed; shutting down MCP server');
      } else {
        log('info', `Received ${reason}; shutting down MCP server`);
      }

      let exitCode = 0;

      if (reason === 'stdin-end' || reason === 'stdin-close') {
        // Allow span completion/export to settle after the client closes stdin.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      try {
        await shutdownXcodeToolsBridge();
      } catch (error) {
        exitCode = 1;
        log('error', `Failed to shutdown Xcode tools bridge: ${String(error)}`, { sentry: true });
      }

      try {
        await getDefaultDebuggerManager().disposeAll();
      } catch (error) {
        exitCode = 1;
        log('error', `Failed to dispose debugger sessions: ${String(error)}`, { sentry: true });
      }

      try {
        await server.close();
      } catch (error) {
        exitCode = 1;
        log('error', `Failed to close MCP server: ${String(error)}`, { sentry: true });
      }

      await flushAndCloseSentry(2000);
      process.exit(exitCode);
    };

    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });

    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });

    process.stdin.once('end', () => {
      void shutdown('stdin-end');
    });

    process.stdin.once('close', () => {
      void shutdown('stdin-close');
    });

    log('info', `XcodeBuildMCP server (version ${version}) started successfully`);
  } catch (error) {
    log('error', `Fatal error in startMcpServer(): ${String(error)}`, { sentry: true });
    console.error('Fatal error in startMcpServer():', error);
    await flushAndCloseSentry(2000);
    process.exit(1);
  }
}
