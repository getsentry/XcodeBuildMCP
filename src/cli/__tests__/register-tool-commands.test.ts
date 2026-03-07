import yargs from 'yargs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import type { ToolCatalog, ToolDefinition } from '../../runtime/types.ts';
import { DefaultToolInvoker } from '../../runtime/tool-invoker.ts';
import { createTextContent } from '../../types/common.ts';
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
    handler: vi.fn(async () => ({
      content: [createTextContent('ok')],
      isError: false,
    })),
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

describe('registerToolCommands', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    process.argv = originalArgv;
  });

  it('hydrates required args from the active defaults profile', async () => {
    const invokeDirect = vi.spyOn(DefaultToolInvoker.prototype, 'invokeDirect').mockResolvedValue({
      content: [createTextContent('ok')],
      isError: false,
    });
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

    const invokeDirect = vi.spyOn(DefaultToolInvoker.prototype, 'invokeDirect').mockResolvedValue({
      content: [createTextContent('ok')],
      isError: false,
    });
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
    const tool = createTool();
    const app = createApp(createCatalog([tool]), {
      ...baseRuntimeConfig,
      sessionDefaults: undefined,
      sessionDefaultsProfiles: undefined,
      activeSessionDefaultsProfile: undefined,
    });

    let error: Error | undefined;
    try {
      await app.parseAsync(['simulator', 'run-tool']);
    } catch (thrown) {
      error = thrown as Error;
    }

    expect(error?.message).toContain('Missing required argument: workspace-path');
    expect(error?.message).not.toMatch(/session defaults/i);
  });

  it('hydrates args before daemon-routed invocation', async () => {
    const invokeDirect = vi.spyOn(DefaultToolInvoker.prototype, 'invokeDirect').mockResolvedValue({
      content: [createTextContent('ok')],
      isError: false,
    });
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
    const invokeDirect = vi.spyOn(DefaultToolInvoker.prototype, 'invokeDirect').mockResolvedValue({
      content: [createTextContent('ok')],
      isError: false,
    });
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
    const invokeDirect = vi.spyOn(DefaultToolInvoker.prototype, 'invokeDirect').mockResolvedValue({
      content: [createTextContent('ok')],
      isError: false,
    });
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
});
