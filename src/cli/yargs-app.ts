import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { ToolCatalog } from '../runtime/types.ts';
import type { ResolvedRuntimeConfig } from '../utils/config-store.ts';
import { registerDaemonCommands } from './commands/daemon.ts';
import { registerInitCommand } from './commands/init.ts';
import { registerMcpCommand } from './commands/mcp.ts';
import { registerSetupCommand } from './commands/setup.ts';
import { registerToolsCommand } from './commands/tools.ts';
import { registerToolCommands } from './register-tool-commands.ts';
import { version } from '../version.ts';
import { coerceLogLevel, setLogLevel, type LogLevel } from '../utils/logger.ts';

export interface YargsAppOptions {
  catalog: ToolCatalog;
  runtimeConfig: ResolvedRuntimeConfig;
  defaultSocketPath: string;
  workspaceRoot: string;
  workspaceKey: string;
  workflowNames: string[];
  cliExposedWorkflowIds: string[];
}

/**
 * Build the main yargs application with all commands registered.
 */
export function buildYargsApp(opts: YargsAppOptions): ReturnType<typeof yargs> {
  const app = yargs(hideBin(process.argv))
    .scriptName('')
    .usage('Usage: xcodebuildmcp <command> [options]')
    .strict()
    .recommendCommands()
    .wrap(Math.min(120, yargs().terminalWidth()))
    .parserConfiguration({
      // Accept --derived-data-path -> derivedDataPath
      'camel-case-expansion': true,
    })
    .option('socket', {
      type: 'string',
      describe: 'Override daemon unix socket path',
      default: opts.defaultSocketPath,
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
    })
    .version(String(version))
    .help()
    .alias('h', 'help')
    .alias('v', 'version')
    .demandCommand(1, '')
    .epilogue(
      `Run 'xcodebuildmcp mcp' to start the MCP server.\n` +
        `Run 'xcodebuildmcp tools' to see all available tools.\n` +
        `Run 'xcodebuildmcp <workflow> <tool> --help' for tool-specific help.`,
    );

  // Register command groups with workspace context
  registerMcpCommand(app);
  registerInitCommand(app, { workspaceRoot: opts.workspaceRoot });
  registerSetupCommand(app);
  registerToolsCommand(app);
  registerToolCommands(app, opts.catalog, {
    workspaceRoot: opts.workspaceRoot,
    cliExposedWorkflowIds: opts.cliExposedWorkflowIds,
    workflowNames: opts.workflowNames,
  });
  // Daemon management is an advanced debugging tool - register last
  registerDaemonCommands(app, {
    defaultSocketPath: opts.defaultSocketPath,
    workspaceRoot: opts.workspaceRoot,
    workspaceKey: opts.workspaceKey,
  });

  return app;
}
