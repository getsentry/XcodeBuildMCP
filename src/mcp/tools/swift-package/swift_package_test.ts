import * as z from 'zod';
import path from 'node:path';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { log } from '../../../utils/logging/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../../../utils/xcodebuild-output.ts';
import { displayPath } from '../../../utils/build-preflight.ts';

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

type SwiftPackageTestParams = z.infer<typeof swiftPackageTestSchema>;

export async function swift_package_testLogic(
  params: SwiftPackageTestParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const resolvedPath = path.resolve(params.packagePath);
  const swiftArgs = ['test', '--package-path', resolvedPath];

  const headerEvent = header('Swift Package Test', [
    { label: 'Package', value: resolvedPath },
    ...(params.testProduct ? [{ label: 'Test Product', value: params.testProduct }] : []),
    ...(params.configuration ? [{ label: 'Configuration', value: params.configuration }] : []),
  ]);

  if (params.configuration?.toLowerCase() === 'release') {
    swiftArgs.push('-c', 'release');
  } else if (params.configuration && params.configuration.toLowerCase() !== 'debug') {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', "Invalid configuration. Use 'debug' or 'release'."));
    return;
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

  const configText = `Swift Package Test\n  Package: ${displayPath(resolvedPath)}`;
  const started = startBuildPipeline({
    operation: 'TEST',
    toolName: 'swift_package_test',
    params: {
      scheme: params.testProduct ?? path.basename(resolvedPath),
      configuration: params.configuration ?? 'debug',
      platform: 'Swift Package',
      preflight: configText,
    },
    message: configText,
  });

  const { pipeline } = started;

  return withErrorHandling(
    ctx,
    async () => {
      const result = await executor(['swift', ...swiftArgs], 'Swift Package Test', false, {
        onStdout: (chunk: string) => pipeline.onStdout(chunk),
        onStderr: (chunk: string) => pipeline.onStderr(chunk),
      });

      finalizeInlineXcodebuild({
        started,
        emit: ctx.emit,
        succeeded: result.success,
        durationMs: Date.now() - started.startedAt,
      });
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to execute swift test: ${message}`,
      logMessage: ({ message }) => `Swift package test failed: ${message}`,
      mapError: ({ message, headerEvent: hdr, emit }) => {
        if (emit) {
          emit(hdr);
          emit(statusLine('error', `Failed to execute swift test: ${message}`));
        }
      },
    },
  );
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
