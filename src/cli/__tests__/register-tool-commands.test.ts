import yargs from 'yargs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import type { ToolCatalog, ToolDefinition } from '../../runtime/types.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';
import { DefaultToolInvoker } from '../../runtime/tool-invoker.ts';
import type { ResolvedRuntimeConfig } from '../../utils/config-store.ts';
import { registerToolCommands } from '../register-tool-commands.ts';

function createTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    cliName: 'run-tool',
    mcpName: 'run_tool',
    workflow: 'simulator',
    description: 'Run test tool',
    annotations: { readOnlyHint: true },
    cliSchema: {
      workspacePath: z.string().describe('Workspace path'),
      scheme: z.string().optional(),
    },
    mcpSchema: {
      workspacePath: z.string().describe('Workspace path'),
      scheme: z.string().optional(),
    },
    stateful: false,
    handler: vi.fn(async () => {}) as ToolDefinition['handler'],
    ...overrides,
  };
}

function createCatalog(tools: ToolDefinition[]): ToolCatalog {
  return {
    tools,
    getByCliName: (name) => tools.find((tool) => tool.cliName === name) ?? null,
    getByMcpName: (name) => tools.find((tool) => tool.mcpName === name) ?? null,
    getByToolId: (toolId) => tools.find((tool) => tool.id === toolId) ?? null,
    resolve: (input) => {
      const tool = tools.find((candidate) => candidate.cliName === input);
      return tool ? { tool } : { notFound: true };
    },
  };
}

const baseRuntimeConfig: ResolvedRuntimeConfig = {
  enabledWorkflows: [],
  customWorkflows: {},
  debug: false,
  sentryDisabled: false,
  experimentalWorkflowDiscovery: false,
  disableSessionDefaults: true,
  disableXcodeAutoSync: false,
  uiDebuggerGuardMode: 'error',
  incrementalBuildsEnabled: false,
  dapRequestTimeoutMs: 30_000,
  dapLogEvents: false,
  launchJsonWaitMs: 8_000,
  debuggerBackend: 'dap',
  sessionDefaults: {
    workspacePath: 'App.xcworkspace',
  },
  sessionDefaultsProfiles: {
    ios: {
      workspacePath: 'Profile.xcworkspace',
    },
  },
  activeSessionDefaultsProfile: 'ios',
};

function createApp(catalog: ToolCatalog, runtimeConfig: ResolvedRuntimeConfig = baseRuntimeConfig) {
  const app = yargs()
    .scriptName('xcodebuildmcp')
    .exitProcess(false)
    .fail((message, error) => {
      throw error ?? new Error(message);
    });

  registerToolCommands(app, catalog, {
    workspaceRoot: '/repo',
    runtimeConfig,
    cliExposedWorkflowIds: ['simulator'],
    workflowNames: ['simulator'],
  });

  return app;
}

function mockInvokeDirectThroughHandler() {
  return vi
    .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
    .mockImplementation(async (tool, args, opts) => {
      const handlerContext: ToolHandlerContext = opts.handlerContext ?? {
        emit: (fragment) => {
          opts.onProgress?.(fragment);
          opts.renderSession?.emit(fragment);
        },
        attach: (image) => {
          opts.renderSession?.attach(image);
        },
        liveProgressEnabled: Boolean(opts.onProgress),
        streamingFragmentsEnabled: Boolean(opts.onProgress),
      };

      await tool.handler(args, handlerContext);

      if (handlerContext.structuredOutput && opts.onStructuredOutput) {
        opts.onStructuredOutput(handlerContext.structuredOutput);
      }
    });
}

describe('registerToolCommands', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    process.argv = originalArgv;
  });

  it('hydrates required args from the active defaults profile', async () => {
    const invokeDirect = vi
      .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
      .mockResolvedValue(undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const tool = createTool();
    const app = createApp(createCatalog([tool]));

    await expect(app.parseAsync(['simulator', 'run-tool'])).resolves.toBeDefined();

    expect(invokeDirect).toHaveBeenCalledTimes(1);
    expect(invokeDirect).toHaveBeenCalledWith(
      tool,
      {
        workspacePath: 'Profile.xcworkspace',
      },
      expect.objectContaining({
        runtime: 'cli',
        workspaceRoot: '/repo',
      }),
    );

    stdoutWrite.mockRestore();
  });

  it('hydrates required args from the explicit --profile override', async () => {
    process.argv = ['node', 'xcodebuildmcp', 'simulator', 'run-tool', '--profile', 'qa'];

    const invokeDirect = vi
      .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
      .mockResolvedValue(undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const tool = createTool();
    const app = createApp(createCatalog([tool]), {
      ...baseRuntimeConfig,
      sessionDefaultsProfiles: {
        ...baseRuntimeConfig.sessionDefaultsProfiles,
        qa: {
          workspacePath: 'QA.xcworkspace',
        },
      },
    });

    await expect(
      app.parseAsync(['simulator', 'run-tool', '--profile', 'qa']),
    ).resolves.toBeDefined();

    expect(invokeDirect).toHaveBeenCalledWith(
      tool,
      {
        workspacePath: 'QA.xcworkspace',
      },
      expect.any(Object),
    );

    stdoutWrite.mockRestore();
  });

  it('keeps the normal missing-argument error when no hydrated default exists', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tool = createTool();
    const app = createApp(createCatalog([tool]), {
      ...baseRuntimeConfig,
      sessionDefaults: undefined,
      sessionDefaultsProfiles: undefined,
      activeSessionDefaultsProfile: undefined,
    });

    await expect(app.parseAsync(['simulator', 'run-tool'])).resolves.toBeDefined();

    expect(consoleError).toHaveBeenCalledWith('Missing required argument: workspace-path');
    expect(process.exitCode).toBe(1);
  });

  it('hydrates args before daemon-routed invocation', async () => {
    const invokeDirect = vi
      .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
      .mockResolvedValue(undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const tool = createTool({ stateful: true });
    const app = createApp(createCatalog([tool]));

    await expect(app.parseAsync(['simulator', 'run-tool'])).resolves.toBeDefined();

    expect(invokeDirect).toHaveBeenCalledWith(
      tool,
      {
        workspacePath: 'Profile.xcworkspace',
      },
      expect.any(Object),
    );

    stdoutWrite.mockRestore();
  });

  it('lets explicit args override conflicting defaults before invocation', async () => {
    const invokeDirect = vi
      .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
      .mockResolvedValue(undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const tool = createTool({
      cliSchema: {
        projectPath: z.string().describe('Project path'),
        workspacePath: z.string().optional(),
      },
      mcpSchema: {
        projectPath: z.string().describe('Project path'),
        workspacePath: z.string().optional(),
      },
    });
    const app = createApp(createCatalog([tool]));

    await expect(
      app.parseAsync(['simulator', 'run-tool', '--project-path', 'App.xcodeproj']),
    ).resolves.toBeDefined();

    expect(invokeDirect).toHaveBeenCalledWith(
      tool,
      {
        projectPath: 'App.xcodeproj',
      },
      expect.any(Object),
    );

    stdoutWrite.mockRestore();
  });

  it('errors clearly when --profile references an unknown profile', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tool = createTool();
    const app = createApp(createCatalog([tool]));

    await expect(
      app.parseAsync(['simulator', 'run-tool', '--profile', 'missing']),
    ).resolves.toBeDefined();

    expect(consoleError).toHaveBeenCalledWith("Error: Unknown defaults profile 'missing'");
    expect(process.exitCode).toBe(1);

    stderrWrite.mockRestore();
  });

  it('lets --json override configured defaults', async () => {
    const invokeDirect = vi
      .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
      .mockResolvedValue(undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const tool = createTool();
    const app = createApp(createCatalog([tool]));

    await expect(
      app.parseAsync([
        'simulator',
        'run-tool',
        '--json',
        JSON.stringify({ workspacePath: 'Json.xcworkspace' }),
      ]),
    ).resolves.toBeDefined();

    expect(invokeDirect).toHaveBeenCalledWith(
      tool,
      {
        workspacePath: 'Json.xcworkspace',
      },
      expect.any(Object),
    );

    stdoutWrite.mockRestore();
  });

  it('allows --json to satisfy required arguments', async () => {
    const invokeDirect = vi
      .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
      .mockResolvedValue(undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const tool = createTool();
    const app = createApp(createCatalog([tool]), {
      ...baseRuntimeConfig,
      sessionDefaults: undefined,
      sessionDefaultsProfiles: undefined,
      activeSessionDefaultsProfile: undefined,
    });

    await expect(
      app.parseAsync([
        'simulator',
        'run-tool',
        '--json',
        JSON.stringify({ workspacePath: 'FromJson.xcworkspace' }),
      ]),
    ).resolves.toBeDefined();

    expect(invokeDirect).toHaveBeenCalledWith(
      tool,
      {
        workspacePath: 'FromJson.xcworkspace',
      },
      expect.any(Object),
    );

    stdoutWrite.mockRestore();
  });

  it('allows array args that begin with a dash', async () => {
    const invokeDirect = vi
      .spyOn(DefaultToolInvoker.prototype, 'invokeDirect')
      .mockResolvedValue(undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const tool = createTool({
      cliSchema: {
        workspacePath: z.string().describe('Workspace path'),
        extraArgs: z.array(z.string()).optional().describe('Extra args'),
      },
      mcpSchema: {
        workspacePath: z.string().describe('Workspace path'),
        extraArgs: z.array(z.string()).optional().describe('Extra args'),
      },
    });
    const app = createApp(createCatalog([tool]), {
      ...baseRuntimeConfig,
      sessionDefaults: undefined,
      sessionDefaultsProfiles: undefined,
      activeSessionDefaultsProfile: undefined,
    });

    await expect(
      app.parseAsync([
        'simulator',
        'run-tool',
        '--workspace-path',
        'App.xcworkspace',
        '--extra-args',
        '-only-testing:AppTests',
      ]),
    ).resolves.toBeDefined();

    expect(invokeDirect).toHaveBeenCalledWith(
      tool,
      {
        workspacePath: 'App.xcworkspace',
        extraArgs: ['-only-testing:AppTests'],
      },
      expect.any(Object),
    );

    stdoutWrite.mockRestore();
  });

  it('writes a structured envelope for tools that provide structured output', async () => {
    mockInvokeDirectThroughHandler();
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    const tool = createTool({
      handler: vi.fn(async (_args, ctx) => {
        ctx?.emit({
          kind: 'presentation',
          fragment: 'status',
          level: 'info',
          message: 'legacy event',
        });

        if (ctx) {
          ctx.structuredOutput = {
            schema: 'xcodebuildmcp.output.simulator-list',
            schemaVersion: '1',
            result: {
              kind: 'simulator-list',
              didError: false,
              error: null,
              simulators: [
                {
                  name: 'iPhone 15',
                  simulatorId: 'test-uuid-123',
                  state: 'Shutdown',
                  isAvailable: true,
                  runtime: 'iOS 17.0',
                },
              ],
            },
          };
        }
      }) as ToolDefinition['handler'],
    });
    const app = createApp(createCatalog([tool]));

    await expect(
      app.parseAsync(['simulator', 'run-tool', '--output', 'json']),
    ).resolves.toBeDefined();

    expect(stdoutChunks.join('')).toBe(
      `${JSON.stringify(
        {
          schema: 'xcodebuildmcp.output.simulator-list',
          schemaVersion: '1',
          didError: false,
          error: null,
          data: {
            simulators: [
              {
                name: 'iPhone 15',
                simulatorId: 'test-uuid-123',
                state: 'Shutdown',
                isAvailable: true,
                runtime: 'iOS 17.0',
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it('writes one NDJSON line per domain fragment for jsonl output and omits the final envelope', async () => {
    mockInvokeDirectThroughHandler();
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    const tool = createTool({
      handler: vi.fn(async (_args, ctx) => {
        ctx?.emit({
          kind: 'presentation',
          fragment: 'status',
          level: 'info',
          message: 'Starting work',
        });
        ctx?.emit({
          kind: 'presentation',
          fragment: 'artifact',
          name: 'Build Log',
          path: '/tmp/build.log',
        });

        if (ctx) {
          ctx.structuredOutput = {
            schema: 'xcodebuildmcp.output.simulator-list',
            schemaVersion: '1',
            result: {
              kind: 'simulator-list',
              didError: false,
              error: null,
              simulators: [],
            },
          };
        }
      }) as ToolDefinition['handler'],
    });
    const app = createApp(createCatalog([tool]));

    await expect(
      app.parseAsync(['simulator', 'run-tool', '--output', 'jsonl']),
    ).resolves.toBeDefined();

    expect(stdoutChunks.join('')).toBe(
      `${JSON.stringify({ event: 'presentation.status', level: 'info', message: 'Starting work' })}\n` +
        `${JSON.stringify({ event: 'presentation.artifact', name: 'Build Log', path: '/tmp/build.log' })}\n`,
    );
  });

  it('does not duplicate daemon-streamed fragments in the render session for jsonl output', async () => {
    const streamedFragment = {
      kind: 'transcript',
      fragment: 'process-line',
      stream: 'stderr',
      line: 'Build Log: /tmp/build.log\n',
    } as const;
    let observedSessionFragmentCount = 0;

    vi.spyOn(DefaultToolInvoker.prototype, 'invokeDirect').mockImplementation(
      async (_tool, _args, opts) => {
        opts.renderSession?.emit(streamedFragment);
        opts.onProgress?.(streamedFragment);
        observedSessionFragmentCount = opts.renderSession?.getFragments().length ?? 0;
        opts.onStructuredOutput?.({
          schema: 'xcodebuildmcp.output.simulator-list',
          schemaVersion: '1',
          result: {
            kind: 'simulator-list',
            didError: false,
            error: null,
            simulators: [],
          },
        });
      },
    );

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    const tool = createTool({ stateful: true });
    const app = createApp(createCatalog([tool]));

    await expect(
      app.parseAsync(['simulator', 'run-tool', '--output', 'jsonl']),
    ).resolves.toBeDefined();

    expect(observedSessionFragmentCount).toBe(1);
    expect(stdoutChunks.join('')).toBe(
      `${JSON.stringify({
        event: 'transcript.process-line',
        stream: 'stderr',
        line: 'Build Log: /tmp/build.log\n',
      })}\n`,
    );
  });

  it('writes a JSON error envelope when no structured output is available for json mode', async () => {
    mockInvokeDirectThroughHandler();
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    const tool = createTool({
      handler: vi.fn(async (_args, ctx) => {
        ctx?.emit({
          kind: 'presentation',
          fragment: 'status',
          level: 'info',
          message: 'legacy event',
        });
      }) as ToolDefinition['handler'],
    });
    const app = createApp(createCatalog([tool]));

    await expect(
      app.parseAsync(['simulator', 'run-tool', '--output', 'json']),
    ).resolves.toBeDefined();

    expect(stdoutChunks.join('')).toBe(
      `${JSON.stringify(
        {
          schema: 'xcodebuildmcp.output.error',
          schemaVersion: '1',
          didError: true,
          error: 'Tool did not produce structured output for --output json',
          data: null,
        },
        null,
        2,
      )}\n`,
    );
    expect(process.exitCode).toBe(1);
  });

  it('rejects json and jsonl output for xcode-ide tools', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = createTool({ workflow: 'xcode-ide' });
    const app = yargs()
      .scriptName('xcodebuildmcp')
      .exitProcess(false)
      .fail((message, error) => {
        throw error ?? new Error(message);
      });

    registerToolCommands(app, createCatalog([tool]), {
      workspaceRoot: '/repo',
      runtimeConfig: baseRuntimeConfig,
      cliExposedWorkflowIds: ['xcode-ide'],
      workflowNames: ['xcode-ide'],
    });

    await expect(
      app.parseAsync(['xcode-ide', 'run-tool', '--output', 'json']),
    ).resolves.toBeDefined();
    expect(consoleError).toHaveBeenLastCalledWith(
      'Error: --output json is not supported for xcode-ide tools yet',
    );
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;

    await expect(
      app.parseAsync(['xcode-ide', 'run-tool', '--output', 'jsonl']),
    ).resolves.toBeDefined();
    expect(consoleError).toHaveBeenLastCalledWith(
      'Error: --output jsonl is not supported for xcode-ide tools yet',
    );
    expect(process.exitCode).toBe(1);
  });
});
