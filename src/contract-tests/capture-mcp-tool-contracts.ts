import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPackageRoot, loadManifest } from '../core/manifest/load-manifest.ts';
import { initConfigStore } from '../utils/config-store.ts';
import { getDefaultFileSystemExecutor } from '../utils/execution/index.ts';
import { importToolModule } from '../core/manifest/import-tool-module.ts';
import { registerMcpTool } from '../utils/tool-registry.ts';

type ContractMode = 'adaptive' | 'full';

interface ToolContract {
  name: string;
  inputSchema: unknown;
  outputSchema: string | null;
}

export interface McpToolContractFixture {
  mode: ContractMode;
  tools: ToolContract[];
  outputSchemas: Record<string, unknown>;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function assertCodexCompatibleSchema(schema: unknown, label: string): void {
  if (JSON.stringify(schema).includes('propertyNames')) {
    throw new Error(`Codex-incompatible propertyNames keyword in ${label}`);
  }
}

function hasSessionDefaultsStructuredOutput(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schema' in value &&
    value.schema === 'xcodebuildmcp.output.session-defaults'
  );
}

function parseMode(args: string[]): ContractMode {
  if (args.length < 1 || args.length > 2 || (args[0] !== 'adaptive' && args[0] !== 'full')) {
    throw new Error('Usage: capture-mcp-tool-contracts <adaptive|full>');
  }
  if (args.length === 2 && args[1] !== '--write') {
    throw new Error('Usage: capture-mcp-tool-contracts <adaptive|full> [--write]');
  }
  return args[0];
}

function outputSchemaReference(
  outputSchema: { schema: string; version: string } | undefined,
): string | null {
  return outputSchema ? `${outputSchema.schema}@${outputSchema.version}` : null;
}

export async function captureMcpToolContracts(mode: ContractMode): Promise<McpToolContractFixture> {
  await initConfigStore({
    cwd: process.cwd(),
    fs: getDefaultFileSystemExecutor(),
    overrides: { disableSessionDefaults: mode === 'full' },
  });

  const manifest = loadManifest();
  const server = new McpServer({ name: 'mcp-tool-contract-test', version: '1.0.0' });
  const outputSchemaReferences = new Map<string, string | null>();

  for (const tool of manifest.tools.values()) {
    const module = await importToolModule(tool.module);
    registerMcpTool(server, tool, module);
    outputSchemaReferences.set(tool.names.mcp, outputSchemaReference(tool.outputSchema));
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'mcp-tool-contract-client', version: '1.0.0' });
  await client.connect(clientTransport);

  try {
    const result = await client.listTools();
    const sessionDefaultsResult = await client.callTool({
      name: 'session_set_defaults',
      arguments: { env: { FEATURE_FLAG: mode } },
    });
    if (!hasSessionDefaultsStructuredOutput(sessionDefaultsResult.structuredContent)) {
      throw new Error('session_set_defaults did not reach its domain result through MCP.');
    }
    const outputSchemas: Record<string, unknown> = {};
    return {
      mode,
      tools: result.tools
        .map((tool) => {
          const outputSchemaReference = outputSchemaReferences.get(tool.name);
          if (outputSchemaReference === undefined) {
            throw new Error(`MCP returned an unknown static tool: ${tool.name}`);
          }
          if (outputSchemaReference === null) {
            if (tool.outputSchema !== undefined) {
              throw new Error(`MCP returned an unexpected output schema for ${tool.name}`);
            }
          } else if (tool.outputSchema === undefined) {
            throw new Error(`MCP omitted the output schema for ${tool.name}`);
          } else {
            const normalizedOutputSchema = sortJson(tool.outputSchema);
            assertCodexCompatibleSchema(normalizedOutputSchema, `${tool.name} output schema`);
            const existingOutputSchema = outputSchemas[outputSchemaReference];
            if (
              existingOutputSchema !== undefined &&
              JSON.stringify(existingOutputSchema) !== JSON.stringify(normalizedOutputSchema)
            ) {
              throw new Error(
                `MCP returned inconsistent output schemas for ${outputSchemaReference}`,
              );
            }
            outputSchemas[outputSchemaReference] = normalizedOutputSchema;
          }

          const inputSchema = sortJson(tool.inputSchema);
          assertCodexCompatibleSchema(inputSchema, `${tool.name} input schema`);
          return {
            name: tool.name,
            inputSchema,
            outputSchema: outputSchemaReference,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
      outputSchemas: sortJson(outputSchemas) as Record<string, unknown>,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

async function writeFixture(mode: ContractMode): Promise<void> {
  const fixture = await captureMcpToolContracts(mode);
  const fixturesDirectory = join(getPackageRoot(), 'src', 'contract-tests', 'fixtures');
  await mkdir(fixturesDirectory, { recursive: true });
  await writeFile(
    join(fixturesDirectory, `mcp-tool-contracts.${mode}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const args = process.argv.slice(2);
  const mode = parseMode(args);
  if (args[1] === '--write') {
    await writeFixture(mode);
  } else {
    const fixture = await captureMcpToolContracts(mode);
    process.stdout.write(`${JSON.stringify(fixture)}\n`);
  }
}
