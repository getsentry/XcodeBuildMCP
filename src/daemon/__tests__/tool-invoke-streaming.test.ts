import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonClient } from '../../cli/daemon-client.ts';
import { startDaemonServer } from '../daemon-server.ts';
import type { ToolCatalog, ToolDefinition } from '../../runtime/types.ts';

function createCatalog(tools: ToolDefinition[]): ToolCatalog {
  return {
    tools,
    getByCliName: (name) => tools.find((tool) => tool.cliName === name) ?? null,
    getByMcpName: (name) => tools.find((tool) => tool.mcpName === name) ?? null,
    getByToolId: (toolId) => tools.find((tool) => tool.id === toolId) ?? null,
    resolve: (input) => {
      const tool =
        tools.find((candidate) => candidate.cliName === input) ??
        tools.find((candidate) => candidate.mcpName === input);
      return tool ? { tool } : { notFound: true };
    },
  };
}

async function createSocketPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'xcodebuildmcp-daemon-'));
  return path.join(directory, 'daemon.sock');
}

async function listen(server: net.Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

describe('daemon tool.invoke streaming', () => {
  const cleanupPaths: string[] = [];
  const cleanupServers: net.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupServers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    await Promise.all(
      cleanupPaths.splice(0).map(async (socketPath) => {
        await rm(path.dirname(socketPath), { recursive: true, force: true });
      }),
    );
  });

  it('streams fragments to the daemon client callback and still returns a terminal structured result', async () => {
    const tool: ToolDefinition = {
      cliName: 'stream-tool',
      mcpName: 'stream_tool',
      workflow: 'simulator',
      description: 'stream tool',
      cliSchema: {},
      mcpSchema: {},
      stateful: true,
      handler: async (_params, ctx) => {
        ctx.emit({
          kind: 'infrastructure',
          fragment: 'status',
          level: 'info',
          message: 'Starting build',
        });
        ctx.emit({
          kind: 'transcript',
          fragment: 'process-line',
          stream: 'stderr',
          line: 'Build Log: /tmp/build.log',
        });
        ctx.nextSteps = [{ label: 'Open the build log' }];
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
      },
    };

    const socketPath = await createSocketPath();
    cleanupPaths.push(socketPath);

    const server = startDaemonServer({
      socketPath,
      startedAt: new Date().toISOString(),
      enabledWorkflows: ['simulator'],
      catalog: createCatalog([tool]),
      workspaceRoot: '/repo',
      workspaceKey: 'repo-key',
      xcodeIdeWorkflowEnabled: false,
      requestShutdown: () => {},
    });
    cleanupServers.push(server);
    await listen(server, socketPath);

    const client = new DaemonClient({ socketPath, timeout: 1000 });
    const progress: string[] = [];
    const result = await client.invokeTool(
      'stream_tool',
      {},
      {
        onFragment: (fragment) => {
          progress.push(fragment.fragment);
        },
      },
    );

    expect(progress).toEqual(['status', 'process-line']);
    expect(result).toEqual({
      structuredOutput: {
        schema: 'xcodebuildmcp.output.simulator-list',
        schemaVersion: '1',
        result: {
          kind: 'simulator-list',
          didError: false,
          error: null,
          simulators: [],
        },
      },
      nextSteps: [{ label: 'Open the build log' }],
    });
  });

  it('returns an error frame when the handler throws', async () => {
    const tool: ToolDefinition = {
      cliName: 'failing-tool',
      mcpName: 'failing_tool',
      workflow: 'simulator',
      description: 'failing tool',
      cliSchema: {},
      mcpSchema: {},
      stateful: true,
      handler: async () => {
        throw new Error('boom');
      },
    };

    const socketPath = await createSocketPath();
    cleanupPaths.push(socketPath);

    const server = startDaemonServer({
      socketPath,
      startedAt: new Date().toISOString(),
      enabledWorkflows: ['simulator'],
      catalog: createCatalog([tool]),
      workspaceRoot: '/repo',
      workspaceKey: 'repo-key',
      xcodeIdeWorkflowEnabled: false,
      requestShutdown: () => {},
    });
    cleanupServers.push(server);
    await listen(server, socketPath);

    const client = new DaemonClient({ socketPath, timeout: 1000 });

    await expect(client.invokeTool('failing_tool', {})).rejects.toThrow('INTERNAL: boom');
  });
});
