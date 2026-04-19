import * as z from 'zod';
import path from 'node:path';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { createXcodebuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import type { StartedPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../../../utils/xcodebuild-output.ts';

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

type SwiftPackageBuildParams = z.infer<typeof swiftPackageBuildSchema>;

export async function swift_package_buildLogic(
  params: SwiftPackageBuildParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
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

  const headerEvent = header('Swift Package Build', [
    { label: 'Package', value: resolvedPath },
    ...(params.targetName ? [{ label: 'Target', value: params.targetName }] : []),
    ...(params.configuration ? [{ label: 'Configuration', value: params.configuration }] : []),
  ]);

  const pipeline = createXcodebuildPipeline({
    operation: 'BUILD',
    toolName: `build_spm`,
    params: {},
    emit: ctx.emit,
  });

  pipeline.emitEvent(headerEvent);
  const started: StartedPipeline = { pipeline, startedAt: Date.now() };

  return withErrorHandling(
    ctx,
    async () => {
      const result = await executor(['swift', ...swiftArgs], 'Swift Package Build', false, {
        onStdout: (chunk: string) => pipeline.onStdout(chunk),
        onStderr: (chunk: string) => pipeline.onStderr(chunk),
      });

      if (!result.success) {
        const errorMessage = result.error || result.output || 'Unknown error';
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
          responseContent: [
            {
              type: 'text',
              text: `Swift package build failed: ${errorMessage}`,
            },
          ],
        });
        return;
      }

      finalizeInlineXcodebuild({
        started,
        emit: ctx.emit,
        succeeded: true,
        durationMs: Date.now() - started.startedAt,
      });
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to execute swift build: ${message}`,
      logMessage: ({ message }) => `Swift package build failed: ${message}`,
      mapError: ({ message, emit }) => {
        emit?.(statusLine('error', `Failed to execute swift build: ${message}`));
      },
    },
  );
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
