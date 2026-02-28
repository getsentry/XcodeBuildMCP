import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createSessionAwareTool } from '../typed-tool-factory.ts';
import { sessionStore } from '../session-store.ts';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../test-utils/mock-executors.ts';
import {
  __resetConfigStoreForTests,
  initConfigStore,
  type RuntimeConfigOverrides,
} from '../config-store.ts';

const cwd = '/repo';

async function initConfigStoreForTest(overrides?: RuntimeConfigOverrides): Promise<void> {
  __resetConfigStoreForTests();
  await initConfigStore({ cwd, fs: createMockFileSystemExecutor(), overrides });
}

describe('createSessionAwareTool', () => {
  beforeEach(async () => {
    sessionStore.clearAll();
    await initConfigStoreForTest({ disableSessionDefaults: false });
  });

  const internalSchema = z
    .object({
      scheme: z.string(),
      projectPath: z.string().optional(),
      workspacePath: z.string().optional(),
      simulatorId: z.string().optional(),
      simulatorName: z.string().optional(),
    })
    .refine((v) => !!v.projectPath !== !!v.workspacePath, {
      message: 'projectPath and workspacePath are mutually exclusive',
      path: ['projectPath'],
    })
    .refine((v) => !!v.simulatorId !== !!v.simulatorName, {
      message: 'simulatorId and simulatorName are mutually exclusive',
      path: ['simulatorId'],
    });

  type Params = z.infer<typeof internalSchema>;

  async function logic(_params: Params): Promise<import('../../types/common.ts').ToolResponse> {
    return { content: [{ type: 'text', text: 'OK' }], isError: false };
  }

  const handler = createSessionAwareTool<Params>({
    internalSchema,
    logicFunction: logic,
    getExecutor: () => createMockExecutor({ success: true }),
    requirements: [
      { allOf: ['scheme'], message: 'scheme is required' },
      { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
      { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    ],
  });

  it('should merge session defaults and satisfy requirements', async () => {
    sessionStore.setDefaults({
      scheme: 'App',
      projectPath: '/path/proj.xcodeproj',
      simulatorId: 'SIM-1',
    });

    const result = await handler({});
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('OK');
  });

  it('should prefer explicit args over session defaults (same key wins)', async () => {
    // Create a handler that echoes the chosen scheme
    const echoHandler = createSessionAwareTool<Params>({
      internalSchema,
      logicFunction: async (params) => ({
        content: [{ type: 'text', text: params.scheme }],
        isError: false,
      }),
      getExecutor: () => createMockExecutor({ success: true }),
      requirements: [
        { allOf: ['scheme'], message: 'scheme is required' },
        { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
        {
          oneOf: ['simulatorId', 'simulatorName'],
          message: 'Provide simulatorId or simulatorName',
        },
      ],
    });

    sessionStore.setDefaults({
      scheme: 'Default',
      projectPath: '/a.xcodeproj',
      simulatorId: 'SIM-A',
    });
    const result = await echoHandler({ scheme: 'FromArgs' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('FromArgs');
  });

  it('should return friendly error when allOf requirement missing', async () => {
    const result = await handler({ projectPath: '/p.xcodeproj', simulatorId: 'SIM-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required session defaults');
    expect(result.content[0].text).toContain('scheme is required');
  });

  it('should return friendly error when oneOf requirement missing', async () => {
    const result = await handler({ scheme: 'App', simulatorId: 'SIM-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required session defaults');
    expect(result.content[0].text).toContain('Provide a project or workspace');
  });

  it('uses opt-out messaging when session defaults schema is disabled', async () => {
    await initConfigStoreForTest({ disableSessionDefaults: true });

    const result = await handler({ projectPath: '/p.xcodeproj', simulatorId: 'SIM-1' });
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('Missing required parameters');
    expect(text).toContain('scheme is required');
    expect(text).not.toContain('session defaults');
  });

  it('should surface Zod validation errors when invalid', async () => {
    const badHandler = createSessionAwareTool<any>({
      internalSchema,
      logicFunction: logic,
      getExecutor: () => createMockExecutor({ success: true }),
    });
    const result = await badHandler({ scheme: 123 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Parameter validation failed');
  });

  it('exclusivePairs should NOT prune session defaults when user provides null (treat as not provided)', async () => {
    const handlerWithExclusive = createSessionAwareTool<Params>({
      internalSchema,
      logicFunction: logic,
      getExecutor: () => createMockExecutor({ success: true }),
      requirements: [
        { allOf: ['scheme'], message: 'scheme is required' },
        { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
      ],
      exclusivePairs: [['projectPath', 'workspacePath']],
    });

    sessionStore.setDefaults({
      scheme: 'App',
      projectPath: '/path/proj.xcodeproj',
      simulatorId: 'SIM-1',
    });

    const res = await handlerWithExclusive({ workspacePath: null as unknown as string });
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toBe('OK');
  });

  it('exclusivePairs should NOT prune when user provides undefined (treated as not provided)', async () => {
    const handlerWithExclusive = createSessionAwareTool<Params>({
      internalSchema,
      logicFunction: logic,
      getExecutor: () => createMockExecutor({ success: true }),
      requirements: [
        { allOf: ['scheme'], message: 'scheme is required' },
        { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
      ],
      exclusivePairs: [['projectPath', 'workspacePath']],
    });

    sessionStore.setDefaults({
      scheme: 'App',
      projectPath: '/path/proj.xcodeproj',
      simulatorId: 'SIM-1',
    });

    const res = await handlerWithExclusive({ workspacePath: undefined as unknown as string });
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toBe('OK');
  });

  it('rejects when multiple explicit args in an exclusive pair are provided (factory-level)', async () => {
    const internalSchemaNoXor = z.object({
      scheme: z.string(),
      projectPath: z.string().optional(),
      workspacePath: z.string().optional(),
    });

    const handlerNoXor = createSessionAwareTool<z.infer<typeof internalSchemaNoXor>>({
      internalSchema: internalSchemaNoXor,
      logicFunction: (async () => ({
        content: [{ type: 'text', text: 'OK' }],
        isError: false,
      })) as any,
      getExecutor: () => createMockExecutor({ success: true }),
      requirements: [{ allOf: ['scheme'], message: 'scheme is required' }],
      exclusivePairs: [['projectPath', 'workspacePath']],
    });

    const res = await handlerNoXor({
      scheme: 'App',
      projectPath: '/path/a.xcodeproj',
      workspacePath: '/path/b.xcworkspace',
    });

    expect(res.isError).toBe(true);
    const msg = res.content[0].text;
    expect(msg).toContain('Parameter validation failed');
    expect(msg).toContain('Mutually exclusive parameters provided');
    expect(msg).toContain('projectPath');
    expect(msg).toContain('workspacePath');
  });

  it('prefers first key when both values of exclusive pair come from session defaults', async () => {
    // Create handler that echoes which simulator param was used
    const echoHandler = createSessionAwareTool<Params>({
      internalSchema: z.object({
        scheme: z.string(),
        projectPath: z.string().optional(),
        simulatorId: z.string().optional(),
        simulatorName: z.string().optional(),
      }),
      logicFunction: async (params) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              simulatorId: params.simulatorId,
              simulatorName: params.simulatorName,
            }),
          },
        ],
        isError: false,
      }),
      getExecutor: () => createMockExecutor({ success: true }),
      requirements: [{ allOf: ['scheme'] }],
      exclusivePairs: [['simulatorId', 'simulatorName']],
    });

    // Set both simulatorId and simulatorName in session defaults
    sessionStore.setDefaults({
      scheme: 'App',
      projectPath: '/a.xcodeproj',
      simulatorId: 'SIM-123',
      simulatorName: 'iPhone 17',
    });

    // Call with no args - both come from session defaults
    const result = await echoHandler({});
    expect(result.isError).toBe(false);

    const content = result.content[0] as { type: 'text'; text: string };
    const parsed = JSON.parse(content.text);
    // simulatorId should be kept (first in pair), simulatorName should be pruned
    expect(parsed.simulatorId).toBe('SIM-123');
    expect(parsed.simulatorName).toBeUndefined();
  });

  it('deep-merges env so user-provided env vars are additive with session defaults', async () => {
    const envSchema = z.object({
      scheme: z.string(),
      projectPath: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    });

    const envHandler = createSessionAwareTool<z.infer<typeof envSchema>>({
      internalSchema: envSchema,
      logicFunction: async (params) => ({
        content: [{ type: 'text', text: JSON.stringify(params.env) }],
        isError: false,
      }),
      getExecutor: () => createMockExecutor({ success: true }),
      requirements: [{ allOf: ['scheme'] }],
    });

    sessionStore.setDefaults({
      scheme: 'App',
      projectPath: '/a.xcodeproj',
      env: { API_KEY: 'abc123', VERBOSE: '1' },
    });

    // User provides additional env var; session default env vars should be preserved
    const result = await envHandler({ env: { DEBUG: 'true', VERBOSE: '0' } });
    expect(result.isError).toBe(false);

    const envContent = result.content[0] as { type: 'text'; text: string };
    const parsed = JSON.parse(envContent.text);
    expect(parsed).toEqual({ API_KEY: 'abc123', DEBUG: 'true', VERBOSE: '0' });
  });

  it('rejects array passed as env instead of deep-merging it', async () => {
    const envSchema = z.object({
      scheme: z.string(),
      projectPath: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    });

    const envHandler = createSessionAwareTool<z.infer<typeof envSchema>>({
      internalSchema: envSchema,
      logicFunction: async (params) => ({
        content: [{ type: 'text', text: JSON.stringify(params.env) }],
        isError: false,
      }),
      getExecutor: () => createMockExecutor({ success: true }),
      requirements: [{ allOf: ['scheme'] }],
    });

    sessionStore.setDefaults({
      scheme: 'App',
      projectPath: '/a.xcodeproj',
      env: { API_KEY: 'abc123' },
    });

    // Array should not be deep-merged; Zod validation should reject it
    const result = await envHandler({ env: ['not', 'a', 'record'] as unknown });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Parameter validation failed');
  });
});
