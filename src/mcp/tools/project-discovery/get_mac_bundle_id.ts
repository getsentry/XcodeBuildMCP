import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BundleIdDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
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
type GetMacBundleIdResult = BundleIdDomainResult;

function createToolExecutionContext(ctx: ToolHandlerContext): DefaultToolExecutionContext {
  return new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
}

function createBundleIdResult(
  appPath: string,
  bundleId?: string,
  error?: string,
): GetMacBundleIdResult {
  return {
    kind: 'bundle-id',
    didError: typeof error === 'string',
    error: error ?? null,
    artifacts: {
      appPath,
      ...(bundleId ? { bundleId } : {}),
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: GetMacBundleIdResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.bundle-id',
    schemaVersion: '1',
  };
}

export function createGetMacBundleIdExecutor(
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): ToolExecutor<GetMacBundleIdParams, GetMacBundleIdResult> {
  return async (params) => {
    const appPath = params.appPath;

    if (!fileSystemExecutor.existsSync(appPath)) {
      const result = createBundleIdResult(
        appPath,
        undefined,
        `File not found: '${appPath}'. Please check the path and try again.`,
      );
      return result;
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

      const trimmedBundleId = bundleId.trim();
      return createBundleIdResult(appPath, trimmedBundleId);
    } catch (error) {
      const result = createBundleIdResult(appPath, undefined, toErrorMessage(error));
      return result;
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
  const executionContext = createToolExecutionContext(ctx);
  const executeGetMacBundleId = createGetMacBundleIdExecutor(executor, fileSystemExecutor);
  const result = await executeGetMacBundleId(params, executionContext);

  setStructuredOutput(ctx, result);
  ctx.emit(header('Get macOS Bundle ID', [{ label: 'App', value: appPath }]));

  if (result.didError) {
    ctx.emit(statusLine('error', result.error ?? 'Failed to get macOS bundle ID'));
    log('error', `Error extracting macOS bundle ID: ${result.error ?? 'Unknown error'}`);
  } else if (result.artifacts.bundleId) {
    ctx.emit(statusLine('success', 'Bundle ID'));
    ctx.emit({ type: 'text-block', text: `  └ ${result.artifacts.bundleId}` });
    log('info', `Extracted macOS bundle ID: ${result.artifacts.bundleId}`);
  }

  executionContext.emitResult(result);

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
