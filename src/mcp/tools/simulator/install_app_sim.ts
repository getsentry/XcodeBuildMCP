import * as z from 'zod';
import type { InstallResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { installAppOnSimulator } from '../../../utils/simulator-steps.ts';
import {
  buildInstallFailure,
  buildInstallSuccess,
  setInstallResultStructuredOutput,
} from '../../../utils/app-lifecycle-results.ts';

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
  const executeInstallAppSim = createInstallAppSimExecutor(executor, fileSystem);
  const result = await executeInstallAppSim(params);

  setInstallResultStructuredOutput(ctx, result);

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

export function createInstallAppSimExecutor(
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): NonStreamingExecutor<InstallAppSimParams, InstallResultDomainResult> {
  return async (params) => {
    const artifacts = { simulatorId: params.simulatorId, appPath: params.appPath };

    const appPathExistsValidation = validateFileExists(params.appPath, fileSystem);
    if (!appPathExistsValidation.isValid) {
      const message = appPathExistsValidation.errorMessage ?? `File not found: '${params.appPath}'`;
      return buildInstallFailure(artifacts, message);
    }

    log('info', `Starting xcrun simctl install request for simulator ${params.simulatorId}`);

    try {
      const installResult = await installAppOnSimulator(
        params.simulatorId,
        params.appPath,
        executor,
      );

      if (!installResult.success) {
        return buildInstallFailure(
          artifacts,
          `Install app in simulator operation failed: ${installResult.error}`,
        );
      }

      return buildInstallSuccess(artifacts);
    } catch (error) {
      return buildInstallFailure(
        artifacts,
        `Install app in simulator operation failed: ${toErrorMessage(error)}`,
      );
    }
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<InstallAppSimParams>({
  internalSchema: toInternalSchema<InstallAppSimParams>(internalSchemaObject),
  logicFunction: install_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
