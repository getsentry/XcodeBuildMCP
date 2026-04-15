import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { InstallResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { displayPath } from '../../../utils/build-preflight.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { installAppOnSimulator } from '../../../utils/simulator-steps.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const baseSchemaObject = z.object({
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator to use (obtained from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  appPath: z.string().describe('Path to the .app bundle to install'),
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
  appPath: z.string(),
});

type InstallAppSimParams = z.infer<typeof internalSchemaObject>;
type InstallAppSimResult = InstallResultDomainResult;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.install-result';

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
  } as const).shape,
);

export async function install_app_simLogic(
  params: InstallAppSimParams,
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const simulatorDisplayName = params.simulatorName
    ? `"${params.simulatorName}" (${params.simulatorId})`
    : params.simulatorId;
  ctx.emit(
    header('Install App', [
      { label: 'Simulator', value: simulatorDisplayName },
      { label: 'App Path', value: displayPath(params.appPath) },
    ]),
  );
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeInstallAppSim = createInstallAppSimExecutor(executor, fileSystem);
  const result = await executeInstallAppSim(params, executionContext);

  setStructuredOutput(ctx, result);

  executionContext.emitResult(result);

  if (result.didError) {
    log(
      'error',
      `Error during install app in simulator operation: ${result.error ?? 'Unknown error'}`,
    );
    return;
  }

  const bundleId = await extractBundleId(params.appPath, executor);
  ctx.nextStepParams = {
    open_sim: {},
    launch_app_sim: {
      simulatorId: params.simulatorId,
      bundleId: bundleId || 'YOUR_APP_BUNDLE_ID',
    },
  };
}

function createInstallAppSimResult(params: InstallAppSimParams): InstallAppSimResult {
  return {
    kind: 'install-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: {
      appPath: params.appPath,
      simulatorId: params.simulatorId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createInstallAppSimErrorResult(
  params: InstallAppSimParams,
  message: string,
): InstallAppSimResult {
  return {
    kind: 'install-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: {
      appPath: params.appPath,
      simulatorId: params.simulatorId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

async function extractBundleId(
  appPath: string,
  executor: CommandExecutor,
): Promise<string | undefined> {
  try {
    const bundleIdResult = await executor(
      ['defaults', 'read', `${appPath}/Info`, 'CFBundleIdentifier'],
      'Extract Bundle ID',
      false,
    );
    if (bundleIdResult.success) {
      const bundleId = bundleIdResult.output.trim();
      return bundleId.length > 0 ? bundleId : undefined;
    }
  } catch (error) {
    log('warn', `Could not extract bundle ID from app: ${toErrorMessage(error)}`);
  }

  return undefined;
}

function setStructuredOutput(ctx: ToolHandlerContext, result: InstallAppSimResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createInstallAppSimExecutor(
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): ToolExecutor<InstallAppSimParams, InstallAppSimResult> {
  return async (params, ctx) => {
    const appPathExistsValidation = validateFileExists(params.appPath, fileSystem);
    if (!appPathExistsValidation.isValid) {
      const message = appPathExistsValidation.errorMessage ?? `File not found: '${params.appPath}'`;
      ctx.emitProgress(statusLine('error', message));
      return createInstallAppSimErrorResult(params, message);
    }

    log('info', `Starting xcrun simctl install request for simulator ${params.simulatorId}`);

    try {
      const installResult = await installAppOnSimulator(
        params.simulatorId,
        params.appPath,
        executor,
      );

      if (!installResult.success) {
        const message = `Install app in simulator operation failed: ${installResult.error}`;
        ctx.emitProgress(statusLine('error', message));
        return createInstallAppSimErrorResult(params, message);
      }

      ctx.emitProgress(statusLine('success', 'App installed successfully'));

      return createInstallAppSimResult(params);
    } catch (error) {
      const message = `Install app in simulator operation failed: ${toErrorMessage(error)}`;
      ctx.emitProgress(statusLine('error', message));
      return createInstallAppSimErrorResult(params, message);
    }
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<InstallAppSimParams>({
  internalSchema: internalSchemaObject as unknown as z.ZodType<InstallAppSimParams, unknown>,
  logicFunction: install_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
