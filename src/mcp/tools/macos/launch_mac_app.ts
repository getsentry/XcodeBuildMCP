import * as z from 'zod';
import type { LaunchResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { launchMacApp } from '../../../utils/macos-steps.ts';
import {
  buildLaunchFailure,
  buildLaunchSuccess,
  setLaunchResultStructuredOutput,
} from '../../../utils/app-lifecycle-results.ts';

const launchMacAppSchema = z.object({
  appPath: z.string(),
  args: z.array(z.string()).optional(),
});

type LaunchMacAppParams = z.infer<typeof launchMacAppSchema>;
type LaunchMacAppResult = LaunchResultDomainResult;

export async function launch_mac_appLogic(
  params: LaunchMacAppParams,
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeLaunchMacApp = createLaunchMacAppExecutor(executor, fileSystem);
  const result = await executeLaunchMacApp(params);

  setLaunchResultStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error during launch macOS app operation: ${result.error ?? 'Unknown error'}`);
    return;
  }
}

export function createLaunchMacAppExecutor(
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): NonStreamingExecutor<LaunchMacAppParams, LaunchMacAppResult> {
  return async (params) => {
    const baseArtifacts = { appPath: params.appPath };

    const fileExistsValidation = validateFileExists(params.appPath, fileSystem);
    if (!fileExistsValidation.isValid) {
      return buildLaunchFailure(
        baseArtifacts,
        fileExistsValidation.errorMessage ?? `File not found: '${params.appPath}'`,
      );
    }

    log('info', `Starting launch macOS app request for ${params.appPath}`);

    try {
      const result = await launchMacApp(params.appPath, executor, { args: params.args });

      if (!result.success) {
        return buildLaunchFailure(
          baseArtifacts,
          `Launch macOS app operation failed: ${result.error}`,
        );
      }

      return buildLaunchSuccess({
        ...baseArtifacts,
        ...(result.bundleId ? { bundleId: result.bundleId } : {}),
        ...(result.processId !== undefined ? { processId: result.processId } : {}),
      });
    } catch (error) {
      return buildLaunchFailure(
        baseArtifacts,
        `Launch macOS app operation failed: ${toErrorMessage(error)}`,
      );
    }
  };
}

export const schema = launchMacAppSchema.shape;

export const handler = createTypedTool(
  launchMacAppSchema,
  launch_mac_appLogic,
  getDefaultCommandExecutor,
);
