import * as z from 'zod';
import path from 'node:path';
import { createErrorResponse } from '../../../utils/responses/index.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';

// Define schema as ZodObject
const baseSchemaObject = z.object({
  packagePath: z.string(),
  targetName: z.string().optional(),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  architectures: z.array(z.string()).optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

const swiftPackageBuildSchema = baseSchemaObject;

// Use z.infer for type safety
type SwiftPackageBuildParams = z.infer<typeof swiftPackageBuildSchema>;

export async function swift_package_buildLogic(
  params: SwiftPackageBuildParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const resolvedPath = path.resolve(params.packagePath);
  const swiftArgs = ['build', '--package-path', resolvedPath];

  if (params.configuration?.toLowerCase() === 'release') {
    swiftArgs.push('-c', 'release');
  }

  if (params.targetName) {
    swiftArgs.push('--target', params.targetName);
  }

  if (params.architectures) {
    for (const arch of params.architectures) {
      swiftArgs.push('--arch', arch);
    }
  }

  if (params.parseAsLibrary) {
    swiftArgs.push('-Xswiftc', '-parse-as-library');
  }

  log('info', `Running swift ${swiftArgs.join(' ')}`);
  try {
    const result = await executor(['swift', ...swiftArgs], 'Swift Package Build', false, undefined);
    if (!result.success) {
      const errorMessage = result.error || result.output || 'Unknown error';
      return createErrorResponse('Swift package build failed', errorMessage);
    }

    return {
      content: [
        { type: 'text', text: '✅ Swift package build succeeded.' },
        {
          type: 'text',
          text: '💡 Next: Run tests with swift_package_test or execute with swift_package_run',
        },
        { type: 'text', text: result.output },
      ],
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Swift package build failed: ${message}`);
    return createErrorResponse('Failed to execute swift build', message);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageBuildParams>({
  internalSchema: swiftPackageBuildSchema,
  logicFunction: swift_package_buildLogic,
  getExecutor: getDefaultCommandExecutor,
});
