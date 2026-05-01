#!/usr/bin/env node
import { bootstrapRuntime } from './runtime/bootstrap-runtime.ts';
import { buildCliToolCatalog } from './cli/cli-tool-catalog.ts';
import { buildYargsApp } from './cli/yargs-app.ts';
import { getSocketPath, getWorkspaceKey, resolveWorkspaceRoot } from './daemon/socket-path.ts';
import { startMcpServer } from './server/start-mcp-server.ts';
import { listCliWorkflowIdsFromManifest } from './runtime/tool-catalog.ts';
import { flushAndCloseSentry, initSentry, recordBootstrapDurationMetric } from './utils/sentry.ts';
import { coerceLogLevel, setLogLevel, type LogLevel } from './utils/logger.ts';
import { hydrateSentryDisabledEnvFromProjectConfig } from './utils/sentry-config.ts';
import { configureRuntimeWorkspaceKey } from './utils/runtime-instance.ts';

function findTopLevelCommand(argv: string[]): string | undefined {
  const flagsWithValue = new Set(['--socket', '--log-level', '--style']);
  let skipNext = false;

  for (const token of argv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (token.startsWith('-')) {
      if (flagsWithValue.has(token)) {
        skipNext = true;
      }
      continue;
    }

    return token;
  }

  return undefined;
}

async function buildLightweightYargsApp(): Promise<ReturnType<typeof import('yargs').default>> {
  const yargs = (await import('yargs')).default;
  const { hideBin } = await import('yargs/helpers');

  return yargs(hideBin(process.argv))
    .scriptName('')
    .strict()
    .help()
    .option('socket', {
      type: 'string',
      describe: 'Override daemon unix socket path',
      hidden: true,
    })
    .option('log-level', {
      type: 'string',
      describe: 'Set log verbosity level',
      choices: ['none', 'error', 'warn', 'info', 'debug'] as const,
      coerce: coerceLogLevel,
      default: 'none',
    })
    .option('style', {
      type: 'string',
      describe: 'Output verbosity (minimal hides next steps)',
      choices: ['normal', 'minimal'] as const,
      default: 'normal',
    })
    .middleware((argv) => {
      const level = argv['log-level'] as LogLevel | undefined;
      if (level) {
        setLogLevel(level);
      }
    });
}

async function runInitCommand(): Promise<void> {
  const { registerInitCommand } = await import('./cli/commands/init.ts');
  const app = await buildLightweightYargsApp();
  registerInitCommand(app, { workspaceRoot: process.cwd() });
  await app.parseAsync();
}

async function runSetupCommand(): Promise<void> {
  const { registerSetupCommand } = await import('./cli/commands/setup.ts');
  const app = await buildLightweightYargsApp();
  registerSetupCommand(app);
  await app.parseAsync();
}

async function runUpgradeCommand(): Promise<void> {
  const { registerUpgradeCommand } = await import('./cli/commands/upgrade.ts');
  const app = await buildLightweightYargsApp();
  registerUpgradeCommand(app);
  await app.parseAsync();
}

async function main(): Promise<void> {
  const cliBootstrapStartedAt = Date.now();
  const earlyCommand = findTopLevelCommand(process.argv.slice(2));
  if (earlyCommand === 'mcp') {
    await startMcpServer();
    return;
  }
  if (earlyCommand === 'init') {
    await runInitCommand();
    return;
  }
  if (earlyCommand === 'setup') {
    await runSetupCommand();
    return;
  }
  if (earlyCommand === 'upgrade') {
    await runUpgradeCommand();
    return;
  }

  await hydrateSentryDisabledEnvFromProjectConfig();
  initSentry({ mode: 'cli' });

  // CLI mode uses disableSessionDefaults to show all tool parameters as flags
  const result = await bootstrapRuntime({
    runtime: 'cli',
    configOverrides: {
      disableSessionDefaults: true,
    },
  });

  // Compute workspace context for daemon routing
  const workspaceRoot = resolveWorkspaceRoot({
    cwd: result.runtime.cwd,
    projectConfigPath: result.configPath,
  });

  const defaultSocketPath = getSocketPath({
    cwd: result.runtime.cwd,
    projectConfigPath: result.configPath,
  });

  const workspaceKey = getWorkspaceKey({
    cwd: result.runtime.cwd,
    projectConfigPath: result.configPath,
  });
  configureRuntimeWorkspaceKey(workspaceKey);

  const cliExposedWorkflowIds = await listCliWorkflowIdsFromManifest({
    excludeWorkflows: ['session-management', 'workflow-discovery'],
  });
  const topLevelCommand = findTopLevelCommand(process.argv.slice(2));
  const discoveryMode = topLevelCommand === 'xcode-ide' ? 'quick' : 'none';

  // CLI uses a manifest-resolved catalog plus daemon-backed xcode-ide dynamic tools.
  const catalog = await buildCliToolCatalog({
    socketPath: defaultSocketPath,
    workspaceRoot,
    cliExposedWorkflowIds,
    discoveryMode,
  });

  const yargsApp = buildYargsApp({
    catalog,
    runtimeConfig: result.runtime.config,
    defaultSocketPath,
    workspaceRoot,
    workspaceKey,
    workflowNames: cliExposedWorkflowIds,
    cliExposedWorkflowIds,
  });

  recordBootstrapDurationMetric('cli', Date.now() - cliBootstrapStartedAt);
  await yargsApp.parseAsync();
}

main()
  .then(async () => {
    if (findTopLevelCommand(process.argv.slice(2)) === 'mcp') {
      return;
    }

    await flushAndCloseSentry(2000);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await flushAndCloseSentry(2000);
    process.exit(1);
  });
