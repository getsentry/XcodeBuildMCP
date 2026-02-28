import type { Argv } from 'yargs';
import type { ToolCatalog, ToolDefinition } from '../runtime/types.ts';
import type { OutputStyle } from '../types/common.ts';
import { DefaultToolInvoker } from '../runtime/tool-invoker.ts';
import { schemaToYargsOptions, getUnsupportedSchemaKeys } from './schema-to-yargs.ts';
import { convertArgvToToolParams } from '../runtime/naming.ts';
import { printToolResponse, type OutputFormat } from './output.ts';
import { groupToolsByWorkflow } from '../runtime/tool-catalog.ts';
import { getWorkflowMetadataFromManifest } from '../core/manifest/load-manifest.ts';

export interface RegisterToolCommandsOptions {
  workspaceRoot: string;
  cliExposedWorkflowIds?: string[];
  /** Workflows to register as command groups (even if currently empty) */
  workflowNames?: string[];
}

function buildXcodeIdeNoCommandsMessage(workflowName: string): string {
  return (
    `No CLI commands are currently exposed for '${workflowName}'.\n\n` +
    `If you're expecting Xcode IDE tools here:\n` +
    `1. Make sure Xcode MCP Tools is enabled in:\n` +
    `   Settings > Intelligence > Xcode Tools\n\n` +
    `If Xcode showed an authorization prompt, make sure you clicked Allow.\n\n` +
    `Then run this command again.`
  );
}

/**
 * Register all tool commands from the catalog with yargs, grouped by workflow.
 */
export function registerToolCommands(
  app: Argv,
  catalog: ToolCatalog,
  opts: RegisterToolCommandsOptions,
): void {
  const invoker = new DefaultToolInvoker(catalog);
  const toolsByWorkflow = groupToolsByWorkflow(catalog);
  const cliExposedWorkflowIds = opts.cliExposedWorkflowIds ?? [...toolsByWorkflow.keys()];
  const workflowNames = opts.workflowNames ?? [...toolsByWorkflow.keys()];
  const workflowMetadata = getWorkflowMetadataFromManifest();

  for (const workflowName of workflowNames) {
    const tools = toolsByWorkflow.get(workflowName) ?? [];
    const workflowMeta = workflowMetadata[workflowName];
    const workflowDescription = workflowMeta?.name ?? workflowName;

    app.command(
      workflowName,
      workflowDescription,
      (yargs) => {
        // Hide root-level options from workflow help
        yargs.option('log-level', { hidden: true }).option('style', { hidden: true });

        // Register each tool as a subcommand under this workflow
        for (const tool of tools) {
          registerToolSubcommand(yargs, tool, invoker, opts, cliExposedWorkflowIds);
        }

        if (tools.length === 0) {
          const hint =
            workflowName === 'xcode-ide'
              ? buildXcodeIdeNoCommandsMessage(workflowName)
              : `No CLI commands are currently exposed for '${workflowName}'.`;

          yargs.epilogue(hint);
          return yargs.help();
        }

        return yargs.demandCommand(1, '').help();
      },
      () => {
        if (tools.length === 0) {
          console.error(
            workflowName === 'xcode-ide'
              ? buildXcodeIdeNoCommandsMessage(workflowName)
              : `No CLI commands are currently exposed for '${workflowName}'.`,
          );
        }
      },
    );
  }
}

/**
 * Register a single tool as a subcommand.
 */
function registerToolSubcommand(
  yargs: Argv,
  tool: ToolDefinition,
  invoker: DefaultToolInvoker,
  opts: RegisterToolCommandsOptions,
  cliExposedWorkflowIds: string[],
): void {
  const yargsOptions = schemaToYargsOptions(tool.cliSchema);
  const unsupportedKeys = getUnsupportedSchemaKeys(tool.cliSchema);

  const commandName = tool.cliName;

  yargs.command(
    commandName,
    tool.description ?? `Run the ${tool.mcpName} tool`,
    (subYargs) => {
      // Hide root-level options from tool help
      subYargs.option('log-level', { hidden: true }).option('style', { hidden: true });

      // Register schema-derived options (tool arguments)
      const toolArgNames: string[] = [];
      for (const [flagName, config] of yargsOptions) {
        subYargs.option(flagName, config);
        toolArgNames.push(flagName);
      }

      // Add --json option for complex args or full override
      subYargs.option('json', {
        type: 'string',
        describe: 'JSON object of tool args (merged with flags)',
      });

      // Add --output option for format control
      subYargs.option('output', {
        type: 'string',
        choices: ['text', 'json'] as const,
        default: 'text',
        describe: 'Output format',
      });

      // Group options for cleaner help display
      if (toolArgNames.length > 0) {
        subYargs.group(toolArgNames, 'Tool Arguments:');
      }
      subYargs.group(['json', 'output'], 'Output Options:');

      // Add note about unsupported keys if any
      if (unsupportedKeys.length > 0) {
        subYargs.epilogue(
          `Note: Complex parameters (${unsupportedKeys.join(', ')}) must be passed via --json`,
        );
      }

      return subYargs;
    },
    async (argv) => {
      // Extract our options
      const jsonArg = argv.json as string | undefined;
      const outputFormat = (argv.output as OutputFormat) ?? 'text';
      const outputStyle = (argv.style as OutputStyle) ?? 'normal';
      const socketPath = argv.socket as string;
      const logLevel = argv['log-level'] as string | undefined;

      // Parse JSON args if provided
      let jsonArgs: Record<string, unknown> = {};
      if (jsonArg) {
        try {
          jsonArgs = JSON.parse(jsonArg) as Record<string, unknown>;
        } catch {
          console.error(`Error: Invalid JSON in --json argument`);
          process.exitCode = 1;
          return;
        }
      }

      // Convert CLI argv to tool params (kebab-case -> camelCase)
      // Filter out internal CLI options before converting
      const internalKeys = new Set(['json', 'output', 'style', 'socket', 'log-level', '_', '$0']);
      const flagArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(argv as Record<string, unknown>)) {
        if (!internalKeys.has(key)) {
          flagArgs[key] = value;
        }
      }
      const toolParams = convertArgvToToolParams(flagArgs);

      // Merge: flag args first, then JSON overrides
      const args = { ...toolParams, ...jsonArgs };

      // Invoke the tool
      const response = await invoker.invokeDirect(tool, args, {
        runtime: 'cli',
        cliExposedWorkflowIds,
        socketPath,
        workspaceRoot: opts.workspaceRoot,
        logLevel,
      });

      printToolResponse(response, { format: outputFormat, style: outputStyle });
    },
  );
}
