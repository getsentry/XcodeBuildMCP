import * as z from 'zod';
import type { BundleIdDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import {
  buildBundleIdResult,
  setBundleIdStructuredOutput,
} from '../../../utils/app-query-results.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

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
type GetMacBundleIdResult = BundleIdDomainResult;

export function createGetMacBundleIdExecutor(
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): NonStreamingExecutor<GetMacBundleIdParams, GetMacBundleIdResult> {
  return async (params) => {
    const appPath = params.appPath;

    if (!fileSystemExecutor.existsSync(appPath)) {
      const message = `File not found: '${appPath}'. Please check the path and try again.`;
      return buildBundleIdResult(
        appPath,
        undefined,
        'Failed to get macOS bundle ID.',
        createBasicDiagnostics({ errors: [message] }),
      );
    }

    try {
      let bundleId: string;

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

      return buildBundleIdResult(appPath, bundleId.trim());
    } catch (error) {
      const message = toErrorMessage(error);
      return buildBundleIdResult(
        appPath,
        undefined,
        'Failed to get macOS bundle ID.',
        createBasicDiagnostics({ errors: [message] }),
      );
    }
  };
}

export async function get_mac_bundle_idLogic(
  params: GetMacBundleIdParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): Promise<void> {
  const appPath = params.appPath;
  log('info', `Starting bundle ID extraction for macOS app: ${appPath}`);

  const ctx = getHandlerContext();
  const executeGetMacBundleId = createGetMacBundleIdExecutor(executor, fileSystemExecutor);
  const result = await executeGetMacBundleId(params);

  setBundleIdStructuredOutput(ctx, result, { headerTitle: 'Get macOS Bundle ID' });

  if (result.didError) {
    log('error', `Error extracting macOS bundle ID: ${result.error ?? 'Unknown error'}`);
  } else if (result.artifacts.bundleId) {
    log('info', `Extracted macOS bundle ID: ${result.artifacts.bundleId}`);
  }

  if (!result.didError && result.artifacts.bundleId) {
    ctx.nextStepParams = {
      launch_mac_app: { appPath },
      build_macos: { scheme: 'SCHEME_NAME' },
    };
  }
}

export const schema = getMacBundleIdSchema.shape;

export const handler = createTypedTool(
  getMacBundleIdSchema,
  (params: GetMacBundleIdParams) =>
    get_mac_bundle_idLogic(params, getDefaultCommandExecutor(), getDefaultFileSystemExecutor()),
  getDefaultCommandExecutor,
);
