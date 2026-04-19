import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

async function executeSyncCommand(command: string, executor: CommandExecutor): Promise<string> {
  const result = await executor(['/bin/sh', '-c', command], 'macOS Bundle ID Extraction');
  if (!result.success) {
    throw new Error(result.error ?? 'Command failed');
  }
  return result.output || '';
}

const getMacBundleIdSchema = z.object({
  appPath: z.string().describe('Path to the .app bundle'),
});

type GetMacBundleIdParams = z.infer<typeof getMacBundleIdSchema>;

export async function get_mac_bundle_idLogic(
  params: GetMacBundleIdParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): Promise<void> {
  const appPath = params.appPath;
  const headerEvent = header('Get macOS Bundle ID', [{ label: 'App', value: appPath }]);

  if (!fileSystemExecutor.existsSync(appPath)) {
    const ctx = getHandlerContext();
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine('error', `File not found: '${appPath}'. Please check the path and try again.`),
    );
    return;
  }

  log('info', `Starting bundle ID extraction for macOS app: ${appPath}`);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      let bundleId;

      try {
        bundleId = await executeSyncCommand(
          `defaults read "${appPath}/Contents/Info" CFBundleIdentifier`,
          executor,
        );
      } catch {
        try {
          bundleId = await executeSyncCommand(
            `/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "${appPath}/Contents/Info.plist"`,
            executor,
          );
        } catch (innerError) {
          throw new Error(
            `Could not extract bundle ID from Info.plist: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
          );
        }
      }

      log('info', `Extracted macOS bundle ID: ${bundleId}`);

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', `Bundle ID\n  \u2514 ${bundleId.trim()}`));
      ctx.nextStepParams = {
        launch_mac_app: { appPath },
        build_macos: { scheme: 'SCHEME_NAME' },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => message,
      logMessage: ({ message }) => `Error extracting macOS bundle ID: ${message}`,
      mapError: ({ message, headerEvent: hdr, emit }) => {
        emit?.(hdr);
        emit?.(statusLine('error', message));
        emit?.(
          statusLine(
            'info',
            'Make sure the path points to a valid macOS app bundle (.app directory).',
          ),
        );
      },
    },
  );
}

export const schema = getMacBundleIdSchema.shape;

export const handler = createTypedTool(
  getMacBundleIdSchema,
  (params: GetMacBundleIdParams) =>
    get_mac_bundle_idLogic(params, getDefaultCommandExecutor(), getDefaultFileSystemExecutor()),
  getDefaultCommandExecutor,
);
