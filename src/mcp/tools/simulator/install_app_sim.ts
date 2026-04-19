import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { displayPath } from '../../../utils/build-preflight.ts';
import { installAppOnSimulator } from '../../../utils/simulator-steps.ts';

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
  const simulatorDisplayName = params.simulatorName
    ? `"${params.simulatorName}" (${params.simulatorId})`
    : params.simulatorId;

  const headerEvent = header('Install App', [
    { label: 'Simulator', value: simulatorDisplayName },
    { label: 'App Path', value: displayPath(params.appPath) },
  ]);

  const ctx = getHandlerContext();

  const appPathExistsValidation = validateFileExists(params.appPath, fileSystem);
  if (!appPathExistsValidation.isValid) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', appPathExistsValidation.errorMessage!));
    return;
  }

  log('info', `Starting xcrun simctl install request for simulator ${params.simulatorId}`);

  return withErrorHandling(
    ctx,
    async () => {
      const installResult = await installAppOnSimulator(
        params.simulatorId,
        params.appPath,
        executor,
      );

      if (!installResult.success) {
        ctx.emit(headerEvent);
        ctx.emit(
          statusLine('error', `Install app in simulator operation failed: ${installResult.error}`),
        );
        return;
      }

      let bundleId = '';
      try {
        const bundleIdResult = await executor(
          ['defaults', 'read', `${params.appPath}/Info`, 'CFBundleIdentifier'],
          'Extract Bundle ID',
          false,
        );
        if (bundleIdResult.success) {
          bundleId = bundleIdResult.output.trim();
        }
      } catch (error) {
        log('warn', `Could not extract bundle ID from app: ${error}`);
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'App installed successfully'));
      ctx.nextStepParams = {
        open_sim: {},
        launch_app_sim: {
          simulatorId: params.simulatorId,
          bundleId: bundleId || 'YOUR_APP_BUNDLE_ID',
        },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Install app in simulator operation failed: ${message}`,
      logMessage: ({ message }) => `Error during install app in simulator operation: ${message}`,
    },
  );
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
