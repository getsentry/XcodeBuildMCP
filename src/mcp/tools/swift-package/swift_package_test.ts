import * as z from 'zod';
import path from 'node:path';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTextResponse, createErrorResponse } from '../../../utils/responses/index.ts';
import { log } from '../../../utils/logging/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';

// Define schema as ZodObject
const baseSchemaObject = z.object({
  packagePath: z.string(),
  testProduct: z.string().optional(),
  filter: z.string().optional().describe('regex: pattern'),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  parallel: z.boolean().optional(),
  showCodecov: z.boolean().optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

const swiftPackageTestSchema = baseSchemaObject;

// Use z.infer for type safety
type SwiftPackageTestParams = z.infer<typeof swiftPackageTestSchema>;

export async function swift_package_testLogic(
  params: SwiftPackageTestParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const resolvedPath = path.resolve(params.packagePath);
  const swiftArgs = ['test', '--package-path', resolvedPath];

  if (params.configuration?.toLowerCase() === 'release') {
    swiftArgs.push('-c', 'release');
  } else if (params.configuration && params.configuration.toLowerCase() !== 'debug') {
    return createTextResponse("Invalid configuration. Use 'debug' or 'release'.", true);
  }

  if (params.testProduct) {
    swiftArgs.push('--test-product', params.testProduct);
  }

  if (params.filter) {
    swiftArgs.push('--filter', params.filter);
  }

  if (params.parallel === false) {
    swiftArgs.push('--no-parallel');
  }

  if (params.showCodecov) {
    swiftArgs.push('--show-code-coverage');
  }

  if (params.parseAsLibrary) {
    swiftArgs.push('-Xswiftc', '-parse-as-library');
  }

  log('info', `Running swift ${swiftArgs.join(' ')}`);
  try {
    const result = await executor(['swift', ...swiftArgs], 'Swift Package Test', false, undefined);
    if (!result.success) {
      const errorMessage = result.error || result.output || 'Unknown error';
      return createErrorResponse('Swift package tests failed', errorMessage);
    }

    return {
      content: [
        { type: 'text', text: '✅ Swift package tests completed.' },
        {
          type: 'text',
          text: '💡 Next: Execute your app with swift_package_run if tests passed',
        },
        { type: 'text', text: result.output },
      ],
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Swift package test failed: ${message}`);
    return createErrorResponse('Failed to execute swift test', message);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageTestParams>({
  internalSchema: swiftPackageTestSchema,
  logicFunction: swift_package_testLogic,
  getExecutor: getDefaultCommandExecutor,
});
