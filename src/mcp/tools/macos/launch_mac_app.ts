/**
 * macOS Workspace Plugin: Launch macOS App
 *
 * Launches a macOS application using the 'open' command.
 * IMPORTANT: You MUST provide the appPath parameter.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';

// Define schema as ZodObject
const launchMacAppSchema = z.object({
  appPath: z.string(),
  args: z.array(z.string()).optional(),
});

// Use z.infer for type safety
type LaunchMacAppParams = z.infer<typeof launchMacAppSchema>;

export async function launch_mac_appLogic(
  params: LaunchMacAppParams,
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): Promise<ToolResponse> {
  // Validate that the app file exists
  const fileExistsValidation = validateFileExists(params.appPath, fileSystem);
  if (!fileExistsValidation.isValid) {
    return { content: [{ type: 'text', text: fileExistsValidation.errorMessage! }], isError: true };
  }

  log('info', `Starting launch macOS app request for ${params.appPath}`);

  try {
    // Construct the command as string array for CommandExecutor
    const command = ['open', params.appPath];

    // Add any additional arguments if provided
    if (params.args && Array.isArray(params.args) && params.args.length > 0) {
      command.push('--args', ...params.args);
    }

    // Execute the command using CommandExecutor
    await executor(command, 'Launch macOS App');

    // Return success response
    return {
      content: [
        {
          type: 'text',
          text: `✅ macOS app launched successfully: ${params.appPath}`,
        },
      ],
    };
  } catch (error) {
    // Handle errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error during launch macOS app operation: ${errorMessage}`);
    return {
      content: [
        {
          type: 'text',
          text: `❌ Launch macOS app operation failed: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

export const schema = launchMacAppSchema.shape;

export const handler = createTypedTool(
  launchMacAppSchema,
  launch_mac_appLogic,
  getDefaultCommandExecutor,
);
