import { Client, specTypeSchemas } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import process from 'node:process';

function parseArgs(argv: string[]): { limit: number; callWindows: boolean } {
  let limit = 20;
  let callWindows = true;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit' && argv[i + 1]) {
      limit = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--no-windows') {
      callWindows = false;
      continue;
    }
  }
  return { limit: Number.isFinite(limit) ? limit : 20, callWindows };
}

function mapXcodeEnvForMcpBridge(env: NodeJS.ProcessEnv): Record<string, string> {
  const mapped: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      mapped[key] = value;
    }
  }

  if (typeof env.XCODEBUILDMCP_XCODE_PID === 'string' && mapped.MCP_XCODE_PID === undefined) {
    mapped.MCP_XCODE_PID = env.XCODEBUILDMCP_XCODE_PID;
  }
  if (
    typeof env.XCODEBUILDMCP_XCODE_SESSION_ID === 'string' &&
    mapped.MCP_XCODE_SESSION_ID === undefined
  ) {
    mapped.MCP_XCODE_SESSION_ID = env.XCODEBUILDMCP_XCODE_SESSION_ID;
  }

  return mapped;
}

async function main(): Promise<void> {
  const { limit, callWindows } = parseArgs(process.argv);

  const transport = new StdioClientTransport({
    command: 'xcrun',
    args: ['mcpbridge'],
    stderr: 'inherit',
    env: mapXcodeEnvForMcpBridge(process.env),
  });

  const client = new Client({ name: 'xcodebuildmcp-probe', version: '0.0.0' });
  await client.connect(transport, { timeout: 15_000 });

  const serverInfo = client.getServerVersion();
  const capabilities = client.getServerCapabilities();

  console.log('serverInfo:', serverInfo);
  console.log('capabilities.tools.listChanged:', capabilities?.tools?.listChanged ?? false);

  const toolsResult = await client.listTools(undefined, { timeout: 15_000 });
  console.log(`tools: ${toolsResult.tools.length}`);
  console.log(
    'first tools:',
    toolsResult.tools.slice(0, limit).map((t) => t.name),
  );

  if (callWindows) {
    const windows = await client.request(
      { method: 'tools/call', params: { name: 'XcodeListWindows', arguments: {} } },
      specTypeSchemas.CompatibilityCallToolResult,
      { timeout: 15_000 },
    );
    console.log('XcodeListWindows:', windows);
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
