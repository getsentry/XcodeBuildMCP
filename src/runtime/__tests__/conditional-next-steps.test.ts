import { describe, expect, it } from 'vitest';
import { createRenderSession } from '../../rendering/render.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';
import { createToolCatalog } from '../tool-catalog.ts';
import { postProcessSession } from '../tool-invoker.ts';
import type { ToolDefinition } from '../types.ts';
import { createStructuredErrorOutput } from '../../utils/structured-error.ts';

function createTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: 'source',
    cliName: 'source',
    mcpName: 'source',
    workflow: 'simulator',
    cliSchema: {},
    mcpSchema: {},
    stateful: false,
    handler: async () => {},
    ...overrides,
  };
}

function createContext(overrides: Partial<ToolHandlerContext> = {}): ToolHandlerContext {
  return {
    emit: () => {},
    attach: () => {},
    ...overrides,
  };
}

describe('conditional manifest next steps', () => {
  const getAppPath = createTool({
    id: 'get_app_path',
    cliName: 'get-app-path',
    mcpName: 'get_app_path',
  });
  const testTool = createTool({
    id: 'test_sim',
    cliName: 'test',
    mcpName: 'test_sim',
  });
  const source = createTool({
    nextStepTemplates: [
      {
        label: 'Get app path',
        toolId: 'get_app_path',
        when: 'success',
        condition: 'app_build_succeeded',
      },
      {
        label: 'Run prepared tests',
        toolId: 'test_sim',
        when: 'success',
        condition: 'prepared_tests_available',
      },
    ],
  });
  const catalog = createToolCatalog([source, getAppPath, testTool]);

  it('selects an active condition and merges its runtime parameters', () => {
    const session = createRenderSession('text');

    postProcessSession({
      tool: source,
      session,
      catalog,
      runtime: 'mcp',
      ctx: createContext({
        nextStepConditionKeys: ['prepared_tests_available'],
        nextStepParams: {
          test_sim: { testProductsPath: '/tmp/App.xctestproducts' },
        },
      }),
    });

    expect(session.getNextSteps?.()).toEqual([
      {
        tool: 'test_sim',
        cliTool: 'test',
        workflow: 'simulator',
        label: 'Run prepared tests',
        params: { testProductsPath: '/tmp/App.xctestproducts' },
        priority: undefined,
        when: 'success',
      },
    ]);
    expect(session.getNextSteps?.()[0]).not.toHaveProperty('condition');
  });

  it('does not render templates whose condition is inactive', () => {
    const session = createRenderSession('text');

    postProcessSession({
      tool: source,
      session,
      catalog,
      runtime: 'mcp',
      ctx: createContext(),
    });

    expect(session.getNextSteps?.()).toEqual([]);
  });

  it('requires both the status and custom condition to match', () => {
    const session = createRenderSession('text');
    session.setStructuredOutput?.(
      createStructuredErrorOutput({
        category: 'runtime',
        code: 'BUILD_FAILED',
        message: 'Build failed',
      }),
    );

    postProcessSession({
      tool: source,
      session,
      catalog,
      runtime: 'mcp',
      ctx: createContext({ nextStepConditionKeys: ['app_build_succeeded'] }),
    });

    expect(session.getNextSteps?.()).toEqual([]);
  });
});
