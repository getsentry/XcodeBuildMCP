import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';

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

// Internal schema requires simulatorId (factory resolves simulatorName → simulatorId)
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
): Promise<ToolResponse> {
  const appPathExistsValidation = validateFileExists(params.appPath, fileSystem);
  if (!appPathExistsValidation.isValid) {
    return {
      content: [{ type: 'text', text: appPathExistsValidation.errorMessage! }],
      isError: true,
    };
  }

  log('info', `Starting xcrun simctl install request for simulator ${params.simulatorId}`);

  try {
    const command = ['xcrun', 'simctl', 'install', params.simulatorId, params.appPath];
    const result = await executor(command, 'Install App in Simulator', false, undefined);

    if (!result.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Install app in simulator operation failed: ${result.error}`,
          },
        ],
      };
    }

    let bundleId = '';
    try {
      const bundleIdResult = await executor(
        ['defaults', 'read', `${params.appPath}/Info`, 'CFBundleIdentifier'],
        'Extract Bundle ID',
        false,
        undefined,
      );
      if (bundleIdResult.success) {
        bundleId = bundleIdResult.output.trim();
      }
    } catch (error) {
      log('warn', `Could not extract bundle ID from app: ${error}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: `App installed successfully in simulator ${params.simulatorId}.`,
        },
      ],
      nextStepParams: {
        open_sim: {},
        launch_app_sim: {
          simulatorId: params.simulatorId,
          bundleId: bundleId || 'YOUR_APP_BUNDLE_ID',
        },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error during install app in simulator operation: ${errorMessage}`);
    return {
      content: [
        {
          type: 'text',
          text: `Install app in simulator operation failed: ${errorMessage}`,
        },
      ],
    };
  }
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
