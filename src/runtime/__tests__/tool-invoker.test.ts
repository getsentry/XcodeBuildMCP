import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolResponse } from '../../types/common.ts';
import type { ToolDefinition } from '../types.ts';
import { createToolCatalog } from '../tool-catalog.ts';
import { DefaultToolInvoker } from '../tool-invoker.ts';
import { ensureDaemonRunning } from '../../cli/daemon-control.ts';

const daemonClientMock = {
  isRunning: vi.fn<() => Promise<boolean>>(),
  invokeXcodeIdeTool:
    vi.fn<(name: string, args: Record<string, unknown>) => Promise<ToolResponse>>(),
  invokeTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<ToolResponse>>(),
  listTools: vi.fn<() => Promise<Array<{ name: string }>>>(),
};

vi.mock('../../cli/daemon-client.ts', () => ({
  DaemonClient: vi.fn().mockImplementation(() => daemonClientMock),
}));

vi.mock('../../cli/daemon-control.ts', () => ({
  ensureDaemonRunning: vi.fn(),
  DEFAULT_DAEMON_STARTUP_TIMEOUT_MS: 5000,
}));

function textResponse(text: string): ToolResponse {
  return {
    content: [{ type: 'text', text }],
  };
}

function makeTool(opts: {
  cliName: string;
  mcpName?: string;
  id?: string;
  nextStepTemplates?: ToolDefinition['nextStepTemplates'];
  workflow: string;
  stateful: boolean;
  handler: ToolDefinition['handler'];
  xcodeIdeRemoteToolName?: string;
}): ToolDefinition {
  return {
    id: opts.id,
    cliName: opts.cliName,
    mcpName: opts.mcpName ?? opts.cliName.replace(/-/g, '_'),
    nextStepTemplates: opts.nextStepTemplates,
    workflow: opts.workflow,
    description: `${opts.cliName} tool`,
    mcpSchema: { value: z.string().optional() },
    cliSchema: { value: z.string().optional() },
    stateful: opts.stateful,
    xcodeIdeRemoteToolName: opts.xcodeIdeRemoteToolName,
    handler: opts.handler,
  };
}

describe('DefaultToolInvoker CLI routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    daemonClientMock.isRunning.mockResolvedValue(true);
    daemonClientMock.invokeXcodeIdeTool.mockResolvedValue(textResponse('daemon-xcode-ide-result'));
    daemonClientMock.invokeTool.mockResolvedValue(textResponse('daemon-result'));
    daemonClientMock.listTools.mockResolvedValue([]);
  });

  it('uses direct invocation for stateless tools', async () => {
    const directHandler = vi.fn().mockResolvedValue(textResponse('direct-result'));
    const catalog = createToolCatalog([
      makeTool({
        cliName: 'list-sims',
        workflow: 'simulator',
        stateful: false,
        handler: directHandler,
      }),
    ]);
    const invoker = new DefaultToolInvoker(catalog);

    const response = await invoker.invoke(
      'list-sims',
      { value: 'hello' },
      {
        runtime: 'cli',
        socketPath: '/tmp/xcodebuildmcp.sock',
      },
    );

    expect(directHandler).toHaveBeenCalledWith({ value: 'hello' });
    expect(daemonClientMock.isRunning).not.toHaveBeenCalled();
    expect(daemonClientMock.invokeTool).not.toHaveBeenCalled();
    expect(response.content[0].text).toBe('direct-result');
  });

  it('routes stateful tools through daemon and auto-starts when needed', async () => {
    daemonClientMock.isRunning.mockResolvedValue(false);
    const directHandler = vi.fn().mockResolvedValue(textResponse('direct-result'));
    const catalog = createToolCatalog([
      makeTool({
        cliName: 'start-sim-log-cap',
        workflow: 'logging',
        stateful: true,
        handler: directHandler,
      }),
    ]);
    const invoker = new DefaultToolInvoker(catalog);

    const response = await invoker.invoke(
      'start-sim-log-cap',
      { value: 'hello' },
      {
        runtime: 'cli',
        socketPath: '/tmp/xcodebuildmcp.sock',
        workspaceRoot: '/repo',
      },
    );

    expect(ensureDaemonRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        socketPath: '/tmp/xcodebuildmcp.sock',
        workspaceRoot: '/repo',
        env: undefined,
      }),
    );
    expect(daemonClientMock.invokeTool).toHaveBeenCalledWith('start_sim_log_cap', {
      value: 'hello',
    });
    expect(directHandler).not.toHaveBeenCalled();
    expect(response.content[0].text).toBe('daemon-result');
  });
});

describe('DefaultToolInvoker xcode-ide dynamic routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    daemonClientMock.isRunning.mockResolvedValue(true);
    daemonClientMock.invokeXcodeIdeTool.mockResolvedValue(textResponse('daemon-result'));
    daemonClientMock.invokeTool.mockResolvedValue(textResponse('daemon-generic'));
    daemonClientMock.listTools.mockResolvedValue([]);
  });

  it('routes dynamic xcode-ide tools through daemon xcode-ide invoke API', async () => {
    daemonClientMock.isRunning.mockResolvedValue(false);
    const directHandler = vi.fn().mockResolvedValue(textResponse('direct-result'));
    const catalog = createToolCatalog([
      makeTool({
        cliName: 'xcode-ide-alpha',
        workflow: 'xcode-ide',
        stateful: false,
        xcodeIdeRemoteToolName: 'Alpha',
        handler: directHandler,
      }),
    ]);
    const invoker = new DefaultToolInvoker(catalog);

    const response = await invoker.invoke(
      'xcode-ide-alpha',
      { value: 'hello' },
      {
        runtime: 'cli',
        socketPath: '/tmp/xcodebuildmcp.sock',
        workspaceRoot: '/repo',
        cliExposedWorkflowIds: ['simulator', 'xcode-ide'],
      },
    );

    expect(ensureDaemonRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        socketPath: '/tmp/xcodebuildmcp.sock',
        workspaceRoot: '/repo',
        env: undefined,
      }),
    );
    expect(daemonClientMock.invokeXcodeIdeTool).toHaveBeenCalledWith('Alpha', { value: 'hello' });
    expect(directHandler).not.toHaveBeenCalled();
    expect(response.content[0].text).toBe('daemon-result');
  });

  it('fails for dynamic xcode-ide tools when socket path is missing', async () => {
    const directHandler = vi.fn().mockResolvedValue(textResponse('direct-result'));
    const catalog = createToolCatalog([
      makeTool({
        cliName: 'xcode-ide-alpha',
        workflow: 'xcode-ide',
        stateful: false,
        xcodeIdeRemoteToolName: 'Alpha',
        handler: directHandler,
      }),
    ]);
    const invoker = new DefaultToolInvoker(catalog);

    const response = await invoker.invoke(
      'xcode-ide-alpha',
      { value: 'hello' },
      {
        runtime: 'cli',
      },
    );

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('No socket path configured');
    expect(directHandler).not.toHaveBeenCalled();
    expect(daemonClientMock.invokeXcodeIdeTool).not.toHaveBeenCalled();
  });
});

describe('DefaultToolInvoker next steps post-processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    daemonClientMock.isRunning.mockResolvedValue(true);
  });

  it('enriches canonical next-step tool names in CLI runtime', async () => {
    const directHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      nextSteps: [
        {
          tool: 'screenshot',
          label: 'Take screenshot',
          params: { simulatorId: '123' },
        },
      ],
    } satisfies ToolResponse);

    const catalog = createToolCatalog([
      makeTool({
        cliName: 'snapshot-ui',
        mcpName: 'snapshot_ui',
        workflow: 'ui-automation',
        stateful: false,
        handler: directHandler,
      }),
      makeTool({
        id: 'screenshot',
        cliName: 'screenshot',
        mcpName: 'screenshot',
        workflow: 'ui-automation',
        stateful: false,
        handler: vi.fn().mockResolvedValue(textResponse('screenshot')),
      }),
    ]);

    const invoker = new DefaultToolInvoker(catalog);
    const response = await invoker.invoke('snapshot-ui', {}, { runtime: 'cli' });

    expect(response.nextSteps).toEqual([
      {
        tool: 'screenshot',
        label: 'Take screenshot',
        params: { simulatorId: '123' },
        workflow: 'ui-automation',
        cliTool: 'screenshot',
      },
    ]);
  });

  it('injects manifest template next steps from dynamic nextStepParams when response omits nextSteps', async () => {
    const directHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      nextStepParams: {
        snapshot_ui: { simulatorId: '12345678-1234-4234-8234-123456789012' },
        tap: { simulatorId: '12345678-1234-4234-8234-123456789012', x: 0, y: 0 },
      },
    } satisfies ToolResponse);
    const catalog = createToolCatalog([
      makeTool({
        id: 'snapshot_ui',
        cliName: 'snapshot-ui',
        mcpName: 'snapshot_ui',
        workflow: 'ui-automation',
        stateful: false,
        nextStepTemplates: [
          {
            label: 'Refresh',
            toolId: 'snapshot_ui',
            params: { simulatorId: 'SIMULATOR_UUID' },
          },
          {
            label: 'Visually verify hierarchy output',
          },
          {
            label: 'Tap on element',
            toolId: 'tap',
            params: { simulatorId: 'SIMULATOR_UUID', x: 0, y: 0 },
          },
        ],
        handler: directHandler,
      }),
      makeTool({
        id: 'tap',
        cliName: 'tap',
        mcpName: 'tap',
        workflow: 'ui-automation',
        stateful: false,
        handler: vi.fn().mockResolvedValue(textResponse('tap')),
      }),
    ]);

    const invoker = new DefaultToolInvoker(catalog);
    const response = await invoker.invoke('snapshot-ui', {}, { runtime: 'cli' });

    expect(response.nextSteps).toEqual([
      {
        tool: 'snapshot_ui',
        label: 'Refresh',
        params: { simulatorId: '12345678-1234-4234-8234-123456789012' },
        workflow: 'ui-automation',
        cliTool: 'snapshot-ui',
      },
      {
        label: 'Visually verify hierarchy output',
      },
      {
        tool: 'tap',
        label: 'Tap on element',
        params: { simulatorId: '12345678-1234-4234-8234-123456789012', x: 0, y: 0 },
        workflow: 'ui-automation',
        cliTool: 'tap',
      },
    ]);
  });

  it('prefers manifest templates over tool-provided next-step labels and tools', async () => {
    const directHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      nextSteps: [
        {
          tool: 'legacy_stop_sim_log_cap',
          label: 'Old label',
          params: { logSessionId: 'session-123' },
          priority: 99,
        },
      ],
      nextStepParams: {
        stop_sim_log_cap: { logSessionId: 'session-123' },
      },
    } satisfies ToolResponse);

    const catalog = createToolCatalog([
      makeTool({
        id: 'start_sim_log_cap',
        cliName: 'start-simulator-log-capture',
        mcpName: 'start_sim_log_cap',
        workflow: 'logging',
        stateful: false,
        nextStepTemplates: [
          {
            label: 'Stop capture and retrieve logs',
            toolId: 'stop_sim_log_cap',
            priority: 1,
          },
        ],
        handler: directHandler,
      }),
      makeTool({
        id: 'stop_sim_log_cap',
        cliName: 'stop-simulator-log-capture',
        mcpName: 'stop_sim_log_cap',
        workflow: 'logging',
        stateful: true,
        handler: vi.fn().mockResolvedValue(textResponse('stop')),
      }),
    ]);

    const invoker = new DefaultToolInvoker(catalog);
    const response = await invoker.invoke('start-simulator-log-capture', {}, { runtime: 'cli' });

    expect(response.nextSteps).toEqual([
      {
        tool: 'stop_sim_log_cap',
        label: 'Stop capture and retrieve logs',
        params: { logSessionId: 'session-123' },
        priority: 1,
        workflow: 'logging',
        cliTool: 'stop-simulator-log-capture',
      },
    ]);
  });

  it('preserves daemon-provided next-step params when nextStepParams are already consumed', async () => {
    daemonClientMock.invokeTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      nextSteps: [
        {
          tool: 'stop_sim_log_cap',
          label: 'Stop capture and retrieve logs',
          params: { logSessionId: 'session-123' },
          priority: 1,
        },
      ],
    } satisfies ToolResponse);

    const catalog = createToolCatalog([
      makeTool({
        id: 'start_sim_log_cap',
        cliName: 'start-simulator-log-capture',
        mcpName: 'start_sim_log_cap',
        workflow: 'logging',
        stateful: true,
        nextStepTemplates: [
          {
            label: 'Stop capture and retrieve logs',
            toolId: 'stop_sim_log_cap',
            priority: 1,
          },
        ],
        handler: vi.fn().mockResolvedValue(textResponse('start')),
      }),
      makeTool({
        id: 'stop_sim_log_cap',
        cliName: 'stop-simulator-log-capture',
        mcpName: 'stop_sim_log_cap',
        workflow: 'logging',
        stateful: true,
        handler: vi.fn().mockResolvedValue(textResponse('stop')),
      }),
    ]);

    const invoker = new DefaultToolInvoker(catalog);
    const response = await invoker.invoke(
      'start-simulator-log-capture',
      {},
      {
        runtime: 'cli',
        socketPath: '/tmp/xcodebuildmcp.sock',
      },
    );

    expect(response.nextSteps).toEqual([
      {
        tool: 'stop_sim_log_cap',
        label: 'Stop capture and retrieve logs',
        params: { logSessionId: 'session-123' },
        priority: 1,
        workflow: 'logging',
        cliTool: 'stop-simulator-log-capture',
      },
    ]);
  });

  it('overrides unresolved template placeholders with dynamic next-step params', async () => {
    const directHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      nextStepParams: {
        boot_sim: { simulatorId: 'ABC-123' },
      },
    } satisfies ToolResponse);

    const catalog = createToolCatalog([
      makeTool({
        id: 'launch_app_sim',
        cliName: 'launch-app-sim',
        mcpName: 'launch_app_sim',
        workflow: 'simulator',
        stateful: false,
        nextStepTemplates: [
          {
            label: 'Boot simulator',
            toolId: 'boot_sim',
            params: { simulatorId: '${simulatorId}' },
          },
        ],
        handler: directHandler,
      }),
      makeTool({
        id: 'boot_sim',
        cliName: 'boot-sim',
        mcpName: 'boot_sim',
        workflow: 'simulator',
        stateful: false,
        handler: vi.fn().mockResolvedValue(textResponse('boot')),
      }),
    ]);

    const invoker = new DefaultToolInvoker(catalog);
    const response = await invoker.invoke('launch-app-sim', {}, { runtime: 'cli' });

    expect(response.nextSteps).toEqual([
      {
        tool: 'boot_sim',
        label: 'Boot simulator',
        params: { simulatorId: 'ABC-123' },
        workflow: 'simulator',
        cliTool: 'boot-sim',
      },
    ]);
  });

  it('maps dynamic params to the correct template tool after catalog filtering', async () => {
    const directHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      nextStepParams: {
        stop_sim_log_cap: { logSessionId: 'session-123' },
      },
    } satisfies ToolResponse);

    const catalog = createToolCatalog([
      makeTool({
        id: 'start_sim_log_cap',
        cliName: 'start-simulator-log-capture',
        mcpName: 'start_sim_log_cap',
        workflow: 'logging',
        stateful: false,
        nextStepTemplates: [
          {
            label: 'Unavailable step',
            toolId: 'missing_tool',
          },
          {
            label: 'Stop capture and retrieve logs',
            toolId: 'stop_sim_log_cap',
            priority: 1,
          },
        ],
        handler: directHandler,
      }),
      makeTool({
        id: 'stop_sim_log_cap',
        cliName: 'stop-simulator-log-capture',
        mcpName: 'stop_sim_log_cap',
        workflow: 'logging',
        stateful: true,
        handler: vi.fn().mockResolvedValue(textResponse('stop')),
      }),
    ]);

    const invoker = new DefaultToolInvoker(catalog);
    const response = await invoker.invoke('start-simulator-log-capture', {}, { runtime: 'cli' });

    expect(response.nextSteps).toEqual([
      {
        tool: 'stop_sim_log_cap',
        label: 'Stop capture and retrieve logs',
        params: { logSessionId: 'session-123' },
        priority: 1,
        workflow: 'logging',
        cliTool: 'stop-simulator-log-capture',
      },
    ]);
  });

  it('always uses manifest templates when they exist', async () => {
    const directHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      nextSteps: [
        {
          tool: 'launch_app_sim',
          label: 'Launch app (platform-specific)',
          params: { simulatorId: '123', bundleId: 'com.example.app' },
          priority: 1,
        },
      ],
    } satisfies ToolResponse);

    const catalog = createToolCatalog([
      makeTool({
        id: 'get_sim_app_path',
        cliName: 'get-app-path',
        mcpName: 'get_sim_app_path',
        workflow: 'simulator',
        stateful: false,
        nextStepTemplates: [
          { label: 'Get bundle ID', toolId: 'get_app_bundle_id', priority: 1 },
          { label: 'Boot simulator', toolId: 'boot_sim', priority: 2 },
        ],
        handler: directHandler,
      }),
      makeTool({
        id: 'launch_app_sim',
        cliName: 'launch-app',
        mcpName: 'launch_app_sim',
        workflow: 'simulator',
        stateful: false,
        handler: vi.fn().mockResolvedValue(textResponse('launch')),
      }),
      makeTool({
        id: 'get_app_bundle_id',
        cliName: 'get-app-bundle-id',
        mcpName: 'get_app_bundle_id',
        workflow: 'project-discovery',
        stateful: false,
        handler: vi.fn().mockResolvedValue(textResponse('bundle')),
      }),
      makeTool({
        id: 'boot_sim',
        cliName: 'boot',
        mcpName: 'boot_sim',
        workflow: 'simulator',
        stateful: false,
        handler: vi.fn().mockResolvedValue(textResponse('boot')),
      }),
    ]);

    const invoker = new DefaultToolInvoker(catalog);
    const response = await invoker.invoke('get-app-path', {}, { runtime: 'cli' });

    expect(response.nextSteps).toEqual([
      {
        tool: 'get_app_bundle_id',
        label: 'Get bundle ID',
        params: {},
        priority: 1,
        workflow: 'project-discovery',
        cliTool: 'get-app-bundle-id',
      },
      {
        tool: 'boot_sim',
        label: 'Boot simulator',
        params: {},
        priority: 2,
        workflow: 'simulator',
        cliTool: 'boot',
      },
    ]);
  });
});
