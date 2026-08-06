import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';

const server = new McpServer(
  { name: 'fake-xcode-tools', version: '0.0.0' },
  {
    capabilities: {
      tools: { listChanged: true },
    },
  },
);

let alphaRegistered;
let betaRegistered;
let gammaRegistered;

function registerInitialTools() {
  alphaRegistered = server.registerTool(
    'Alpha',
    {
      description: 'Alpha tool',
      inputSchema: z
        .object({
          value: z.string(),
        })
        .passthrough(),
      annotations: { readOnlyHint: true, title: 'Alpha' },
    },
    async (args) => ({
      content: [{ type: 'text', text: `Alpha:${args.value}` }],
      isError: false,
    }),
  );

  betaRegistered = server.registerTool(
    'Beta',
    {
      description: 'Beta tool',
      inputSchema: z
        .object({
          n: z.number().int(),
        })
        .passthrough(),
    },
    async (args) => ({
      content: [{ type: 'text', text: `Beta:${args.n}` }],
      isError: false,
    }),
  );

  server.registerTool(
    'TriggerChange',
    {
      description: 'Mutate tool catalog and emit list_changed',
      inputSchema: z.object({}).passthrough(),
    },
    async () => {
      applyCatalogChange();
      return { content: [{ type: 'text', text: 'changed' }], isError: false };
    },
  );
}

function applyCatalogChange() {
  betaRegistered?.remove();
  betaRegistered = undefined;

  alphaRegistered?.remove();
  alphaRegistered = server.registerTool(
    'Alpha',
    {
      description: 'Alpha tool (changed schema)',
      inputSchema: z
        .object({
          value: z.string(),
          extra: z.string().optional(),
        })
        .passthrough(),
    },
    async (args) => ({
      content: [{ type: 'text', text: `Alpha2:${args.value}:${args.extra ?? ''}` }],
      isError: false,
    }),
  );

  gammaRegistered?.remove();
  gammaRegistered = server.registerTool(
    'Gamma',
    {
      description: 'Gamma tool',
      inputSchema: z.object({ ok: z.boolean() }).passthrough(),
    },
    async (args) => ({
      content: [{ type: 'text', text: `Gamma:${args.ok}` }],
      isError: false,
    }),
  );

  server.sendToolListChanged();
}

registerInitialTools();

await server.connect(new StdioServerTransport());
