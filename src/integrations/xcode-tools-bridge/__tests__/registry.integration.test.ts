import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XcodeToolsBridgeClient } from '../client.ts';
import { XcodeToolsProxyRegistry } from '../registry.ts';

function fixturePath(rel: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'fixtures', rel);
}

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (true) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('XcodeToolsProxyRegistry (stdio integration)', () => {
  let localServer: McpServer;
  let localClient: Client;
  let bridgeClient: XcodeToolsBridgeClient;
  let registry: XcodeToolsProxyRegistry;

  const doSync = async (): Promise<void> => {
    const tools = await bridgeClient.listTools();
    registry.sync(tools, async (remoteName, args) => bridgeClient.callTool(remoteName, args));
    if (localServer.isConnected()) {
      localServer.sendToolListChanged();
    }
  };

  beforeAll(async () => {
    localServer = new McpServer(
      { name: 'local-test-server', version: '0.0.0' },
      { capabilities: { tools: { listChanged: true } } },
    );

    registry = new XcodeToolsProxyRegistry(localServer);

    const fakeServerScript = fixturePath('fake-xcode-tools-server.mjs');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
    bridgeClient = new XcodeToolsBridgeClient({
      serverParams: {
        command: process.execPath,
        args: [fakeServerScript],
        stderr: 'pipe',
        env,
      },
      onToolsListChanged: () => {
        void doSync();
      },
    });

    await bridgeClient.connectOnce();
    await doSync();

    // Connect after initial tool registration so MCP server can register capabilities before connect.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await localServer.connect(serverTransport);

    localClient = new Client({ name: 'local-test-client', version: '0.0.0' });
    await localClient.connect(clientTransport);
  });

  afterAll(async () => {
    await bridgeClient.disconnect();
    await localClient.close();
    await localServer.close();
  });

  it('registers proxied tools and forwards calls', async () => {
    const tools = await localClient.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('xcode_tools_Alpha');
    expect(names).toContain('xcode_tools_Beta');
    expect(names).toContain('xcode_tools_TriggerChange');

    const res = (await localClient.callTool({
      name: 'xcode_tools_Alpha',
      arguments: { value: 'hi' },
    })) as CallToolResult;
    expect(res.isError).not.toBe(true);
    expect(res.content[0]).toMatchObject({ type: 'text', text: 'Alpha:hi' });
  });

  it('fills approval annotations for proxied tools when the remote tool omits them', async () => {
    const tools = await localClient.listTools();
    const alpha = tools.tools.find((tool) => tool.name === 'xcode_tools_Alpha');
    const beta = tools.tools.find((tool) => tool.name === 'xcode_tools_Beta');

    expect(alpha?.annotations).toMatchObject({
      title: 'Alpha',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(beta?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('updates registered tools on remote list change', async () => {
    await localClient.callTool({ name: 'xcode_tools_TriggerChange', arguments: {} });

    await waitFor(() => registry.getRegisteredToolNames().includes('xcode_tools_Gamma'));

    const tools = await localClient.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('xcode_tools_Alpha');
    expect(names).not.toContain('xcode_tools_Beta');
    expect(names).toContain('xcode_tools_Gamma');

    const res = (await localClient.callTool({
      name: 'xcode_tools_Alpha',
      arguments: { value: 'hi', extra: 'e' },
    })) as CallToolResult;
    expect(res.content[0]).toMatchObject({ type: 'text', text: 'Alpha2:hi:e' });
  });
});
