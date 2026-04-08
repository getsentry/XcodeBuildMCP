import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';
import { launchMacApp } from '../../../utils/macos-steps.ts';

const launchMacAppSchema = z.object({
  appPath: z.string(),
  args: z.array(z.string()).optional(),
});

type LaunchMacAppParams = z.infer<typeof launchMacAppSchema>;

export async function launch_mac_appLogic(
  params: LaunchMacAppParams,
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): Promise<void> {
  const headerEvent = header('Launch macOS App', [{ label: 'App', value: params.appPath }]);

  const fileExistsValidation = validateFileExists(params.appPath, fileSystem);
  if (!fileExistsValidation.isValid) {
    const ctx = getHandlerContext();
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', fileExistsValidation.errorMessage!));
    return;
  }

  log('info', `Starting launch macOS app request for ${params.appPath}`);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const result = await launchMacApp(params.appPath, executor, { args: params.args });

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Launch macOS app operation failed: ${result.error}`));
        return;
      }

      const details: Array<{ label: string; value: string }> = [];
      if (result.bundleId) {
        details.push({ label: 'Bundle ID', value: result.bundleId });
      }
      if (result.processId !== undefined) {
        details.push({ label: 'Process ID', value: String(result.processId) });
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'App launched successfully'));
      if (details.length > 0) {
        ctx.emit(detailTree(details));
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Launch macOS app operation failed: ${message}`,
      logMessage: ({ message }) => `Error during launch macOS app operation: ${message}`,
    },
  );
}

export const schema = launchMacAppSchema.shape;

export const handler = createTypedTool(
  launchMacAppSchema,
  launch_mac_appLogic,
  getDefaultCommandExecutor,
);
