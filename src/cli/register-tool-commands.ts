import type { Argv } from 'yargs';
import yargsParser from 'yargs-parser';
import type { ToolCatalog, ToolDefinition } from '../runtime/types.ts';
import { DefaultToolInvoker } from '../runtime/tool-invoker.ts';
import { schemaToYargsOptions, getUnsupportedSchemaKeys } from './schema-to-yargs.ts';
import { convertArgvToToolParams } from '../runtime/naming.ts';
import type { OutputFormat } from './output.ts';
import { groupToolsByWorkflow } from '../runtime/tool-catalog.ts';
import { getWorkflowMetadataFromManifest } from '../core/manifest/load-manifest.ts';
import type { ResolvedRuntimeConfig } from '../utils/config-store.ts';
import type { ToolHandlerContext } from '../rendering/types.ts';
import type { AnyFragment } from '../types/domain-fragments.ts';
import { transcriptEmitterStorage } from '../utils/transcript-context.ts';
import {
  getCliSessionDefaultsForTool,
  isKnownCliSessionDefaultsProfile,
  mergeCliSessionDefaults,
} from './session-defaults.ts';
import { createRenderSession } from '../rendering/render.ts';
import { toStructuredEnvelope } from '../utils/structured-output-envelope.ts';
import { toCliJsonlEvent } from './jsonl-event.ts';

export interface RegisterToolCommandsOptions {
  workspaceRoot: string;
  runtimeConfig: ResolvedRuntimeConfig;
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

function readProfileOverrideFromProcessArgv(): string | undefined {
  const parsedArgv = yargsParser(process.argv.slice(2), {
    configuration: {
      'camel-case-expansion': true,
    },
    string: ['profile'],
  }) as { profile?: string | string[] };

  const profile = parsedArgv.profile;
  return typeof profile === 'string' ? profile : undefined;
}

function formatMissingRequiredError(missingFlags: string[]): string {
  if (missingFlags.length === 1) {
    return `Missing required argument: ${missingFlags[0]}`;
  }

  return `Missing required arguments: ${missingFlags.join(', ')}`;
}

function setEnvScoped(key: string, value: string): () => void {
  const previous = process.env[key];
  process.env[key] = value;
  return () => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  };
}

function createBufferedHandlerContext(
  session: ReturnType<typeof createRenderSession>,
  opts: { liveProgressEnabled: boolean; onProgress?: (fragment: AnyFragment) => void },
): ToolHandlerContext {
  return {
    liveProgressEnabled: opts.liveProgressEnabled,
    streamingFragmentsEnabled: opts.liveProgressEnabled,
    emit: (fragment) => {
      session.emit(fragment);
      opts?.onProgress?.(fragment);
    },
    attach: (image) => {
      session.attach(image);
    },
  };
}

const JSON_ERROR_SCHEMA = 'xcodebuildmcp.output.error';
const JSON_ERROR_SCHEMA_VERSION = '1';

function writeJsonOutput(handlerContext: ToolHandlerContext): boolean {
  const structuredOutput = handlerContext.structuredOutput;

  const envelope = structuredOutput
    ? toStructuredEnvelope(
        structuredOutput.result,
        structuredOutput.schema,
        structuredOutput.schemaVersion,
      )
    : {
        schema: JSON_ERROR_SCHEMA,
        schemaVersion: JSON_ERROR_SCHEMA_VERSION,
        didError: true,
        error: 'Tool did not produce structured output for --output json',
        data: null,
      };

  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  return envelope.didError;
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
  const builderProfileOverride = readProfileOverrideFromProcessArgv();
  const hydratedDefaults = getCliSessionDefaultsForTool({
    tool,
    runtimeConfig: opts.runtimeConfig,
    profileOverride: builderProfileOverride,
  });
  const yargsOptions = schemaToYargsOptions(tool.cliSchema, {
    hydratedDefaults,
  });
  const unsupportedKeys = getUnsupportedSchemaKeys(tool.cliSchema);

  const commandName = tool.cliName;
  const requiredFlagNames = [...yargsOptions.entries()]
    .filter(([, config]) => Boolean(config.demandOption))
    .map(([flagName]) => flagName);

  yargs.command(
    commandName,
    tool.description ?? `Run the ${tool.mcpName} tool`,
    (subYargs) => {
      // Hide root-level options from tool help
      subYargs.option('log-level', { hidden: true }).option('style', { hidden: true });

      // Parse option-like values as arguments (e.g. --extra-args "-only-testing:...")
      subYargs.parserConfiguration({
        'unknown-options-as-args': true,
      });

      // Register schema-derived options (tool arguments)
      const toolArgNames: string[] = [];
      for (const [flagName, config] of yargsOptions) {
        subYargs.option(flagName, { ...config, demandOption: false });
        toolArgNames.push(flagName);
      }

      // Add --profile option for per-invocation defaults override
      subYargs.option('profile', {
        type: 'string',
        describe: 'Override the defaults profile for this command only',
      });

      // Add --json option for complex args or full override
      subYargs.option('json', {
        type: 'string',
        describe: 'JSON object of tool args (merged with flags)',
      });

      // Add --output option for format control
      subYargs.option('output', {
        type: 'string',
        choices: ['text', 'json', 'jsonl', 'raw'] as const,
        default: 'text',
        describe: 'Output format',
      });

      // Group options for cleaner help display
      if (toolArgNames.length > 0) {
        subYargs.group(toolArgNames, 'Tool Arguments:');
      }
      subYargs.group(['profile'], 'Session Defaults:');
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
      const unexpectedArgs = (argv._ as unknown[])
        .slice(2)
        .filter((value): value is string => typeof value === 'string' && value.startsWith('-'));

      if (unexpectedArgs.length > 0) {
        console.error(
          `Unknown argument${unexpectedArgs.length === 1 ? '' : 's'}: ${unexpectedArgs.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }

      // Extract our options
      const jsonArg = argv.json as string | undefined;
      const profileOverride = argv.profile as string | undefined;
      const outputFormat = (argv.output as OutputFormat) ?? 'text';
      const socketPath = argv.socket as string;
      const logLevel = argv['log-level'] as string | undefined;

      if (tool.workflow === 'xcode-ide' && (outputFormat === 'json' || outputFormat === 'jsonl')) {
        console.error(`Error: --output ${outputFormat} is not supported for xcode-ide tools yet`);
        process.exitCode = 1;
        return;
      }

      if (
        profileOverride &&
        !isKnownCliSessionDefaultsProfile(opts.runtimeConfig, profileOverride)
      ) {
        console.error(`Error: Unknown defaults profile '${profileOverride}'`);
        process.exitCode = 1;
        return;
      }

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
      const internalKeys = new Set([
        'json',
        'output',
        'profile',
        'style',
        'socket',
        'log-level',
        'logLevel',
        '_',
        '$0',
      ]);
      const flagArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(argv as Record<string, unknown>)) {
        if (!internalKeys.has(key)) {
          flagArgs[key] = value;
        }
      }
      const toolParams = convertArgvToToolParams(flagArgs);

      // Merge: flag args first, then JSON overrides
      const explicitArgs = { ...toolParams, ...jsonArgs };
      const args = mergeCliSessionDefaults({
        defaults: getCliSessionDefaultsForTool({
          tool,
          runtimeConfig: opts.runtimeConfig,
          profileOverride,
        }),
        explicitArgs,
      });

      const missingRequiredFlags = requiredFlagNames.filter((flagName) => {
        const camelKey = convertArgvToToolParams({ [flagName]: true });
        const [toolKey] = Object.keys(camelKey);
        const value = args[toolKey];
        return value === undefined || value === null || value === '';
      });

      if (missingRequiredFlags.length > 0) {
        console.error(formatMissingRequiredError(missingRequiredFlags));
        process.exitCode = 1;
        return;
      }

      const restoreCliOutputFormat = setEnvScoped('XCODEBUILDMCP_CLI_OUTPUT_FORMAT', outputFormat);

      try {
        const session =
          outputFormat === 'text'
            ? createRenderSession('cli-text', {
                interactive: process.stdout.isTTY === true,
              })
            : outputFormat === 'raw'
              ? createRenderSession('raw')
              : createRenderSession('text');
        const writeJsonlFragment =
          outputFormat === 'jsonl'
            ? (fragment: AnyFragment) => {
                process.stdout.write(JSON.stringify(toCliJsonlEvent(fragment)) + '\n');
              }
            : undefined;
        const handlerContext = createBufferedHandlerContext(session, {
          liveProgressEnabled: outputFormat === 'text' || outputFormat === 'jsonl',
          onProgress: writeJsonlFragment,
        });

        const runInvocation = () =>
          invoker.invokeDirect(tool, args, {
            runtime: 'cli',
            renderSession: session,
            handlerContext,
            onProgress: writeJsonlFragment,
            onStructuredOutput: (structuredOutput) => {
              handlerContext.structuredOutput = structuredOutput;
            },
            cliExposedWorkflowIds,
            socketPath,
            workspaceRoot: opts.workspaceRoot,
            logLevel,
          });

        if (outputFormat === 'raw') {
          await transcriptEmitterStorage.run((fragment) => session.emit(fragment), runInvocation);
        } else {
          await runInvocation();
        }

        if (outputFormat === 'json') {
          if (writeJsonOutput(handlerContext)) {
            process.exitCode = 1;
          }
          return;
        }

        if (outputFormat === 'jsonl') {
          if (handlerContext.structuredOutput?.result.didError ?? session.isError()) {
            process.exitCode = 1;
          }
          return;
        }

        session.finalize();

        if (session.isError()) {
          process.exitCode = 1;
        }
      } finally {
        restoreCliOutputFormat();
      }
    },
  );
}
