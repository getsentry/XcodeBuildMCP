/**
 * Device Screenshot tool - Capture screenshots from physical iOS devices
 *
 * Uses pymobiledevice3 to capture screenshots from connected physical devices.
 * pymobiledevice3 supports iOS 17+ via the CoreDevice tunnel protocol,
 * and works over both USB and WiFi.
 *
 * Requires: pipx install pymobiledevice3
 * For iOS 17+: sudo pymobiledevice3 remote tunneld (in a separate terminal)
 */
import * as path from 'path';
import { tmpdir } from 'os';
import * as z from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ToolResponse } from '../../../types/common.ts';
import { createImageContent } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import {
  createErrorResponse,
  createTextResponse,
  SystemError,
} from '../../../utils/responses/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultFileSystemExecutor,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';

const LOG_PREFIX = '[DeviceScreenshot]';

// Define schema as ZodObject
const deviceScreenshotSchema = z.object({
  deviceId: z
    .string()
    .min(1, { message: 'Device ID cannot be empty' })
    .describe('UDID of the device (obtained from list_devices)'),
  returnFormat: z
    .enum(['path', 'base64'])
    .optional()
    .describe('Return image path or base64 data (path|base64)'),
});

// Use z.infer for type safety
type DeviceScreenshotParams = z.infer<typeof deviceScreenshotSchema>;

const publicSchemaObject = z.strictObject(
  deviceScreenshotSchema.omit({ deviceId: true } as const).shape,
);

/**
 * Check if pymobiledevice3 is available on the system.
 */
export async function checkPymobiledevice3Available(executor: CommandExecutor): Promise<boolean> {
  try {
    const result = await executor(['which', 'pymobiledevice3'], `${LOG_PREFIX}: check tool`, false);
    return result.success && !!result.output?.trim();
  } catch {
    return false;
  }
}

export async function deviceScreenshotLogic(
  params: DeviceScreenshotParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
  pathUtils: { tmpdir: () => string; join: (...paths: string[]) => string } = { ...path, tmpdir },
  uuidUtils: { v4: () => string } = { v4: uuidv4 },
): Promise<ToolResponse> {
  const { deviceId } = params;
  const runtime = process.env.XCODEBUILDMCP_RUNTIME;
  const defaultFormat = runtime === 'cli' || runtime === 'daemon' ? 'path' : 'base64';
  const returnFormat = params.returnFormat ?? defaultFormat;
  const tempDir = pathUtils.tmpdir();
  const screenshotFilename = `device_screenshot_${uuidUtils.v4()}.png`;
  const screenshotPath = pathUtils.join(tempDir, screenshotFilename);
  const optimizedFilename = `device_screenshot_optimized_${uuidUtils.v4()}.jpg`;
  const optimizedPath = pathUtils.join(tempDir, optimizedFilename);

  // Check if pymobiledevice3 is available
  const isAvailable = await checkPymobiledevice3Available(executor);
  if (!isAvailable) {
    return createErrorResponse(
      'pymobiledevice3 not found',
      'pymobiledevice3 is required to capture screenshots from physical devices.\n' +
        'Install it with: pipx install pymobiledevice3\n' +
        'For iOS 17+, you also need a running tunnel: sudo pymobiledevice3 remote tunneld',
    );
  }

  const commandArgs: string[] = [
    'pymobiledevice3',
    'developer',
    'dvt',
    'screenshot',
    screenshotPath,
    '--udid',
    deviceId,
  ];

  log('info', `${LOG_PREFIX}: Starting capture to ${screenshotPath} on device ${deviceId}`);

  try {
    const result = await executor(commandArgs, `${LOG_PREFIX}: screenshot`, false);

    if (!result.success) {
      const errorMsg = result.error ?? result.output ?? '';
      if (errorMsg.includes('tunneld') || errorMsg.includes('InvalidService')) {
        throw new SystemError(
          'Failed to capture screenshot: Unable to connect to device tunnel.\n' +
            'For iOS 17+, start a tunnel first: sudo pymobiledevice3 remote tunneld',
        );
      }
      throw new SystemError(`Failed to capture screenshot: ${errorMsg}`);
    }

    log('info', `${LOG_PREFIX}: Screenshot captured for device ${deviceId}`);

    try {
      // Optimize the image for LLM consumption: resize to max 800px and convert to JPEG
      const optimizeArgs = [
        'sips',
        '-Z',
        '800',
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '75',
        screenshotPath,
        '--out',
        optimizedPath,
      ];

      const optimizeResult = await executor(optimizeArgs, `${LOG_PREFIX}: optimize image`, false);

      if (!optimizeResult.success) {
        log('warning', `${LOG_PREFIX}: Image optimization failed, using original PNG`);
        if (returnFormat === 'base64') {
          const base64Image = await fileSystemExecutor.readFile(screenshotPath, 'base64');

          try {
            await fileSystemExecutor.rm(screenshotPath);
          } catch (err) {
            log('warning', `${LOG_PREFIX}: Failed to delete temp file: ${err}`);
          }

          return {
            content: [createImageContent(base64Image, 'image/png')],
            isError: false,
          };
        }

        const fileUrl = `file://${screenshotPath}`;
        return createTextResponse(
          `Screenshot captured (image/png, optimization failed):\n[${screenshotPath}](${fileUrl})`,
        );
      }

      log('info', `${LOG_PREFIX}: Image optimized successfully`);

      if (returnFormat === 'base64') {
        const base64Image = await fileSystemExecutor.readFile(optimizedPath, 'base64');

        log('info', `${LOG_PREFIX}: Successfully encoded image as Base64`);

        try {
          await fileSystemExecutor.rm(screenshotPath);
          await fileSystemExecutor.rm(optimizedPath);
        } catch (err) {
          log('warning', `${LOG_PREFIX}: Failed to delete temporary files: ${err}`);
        }

        return {
          content: [createImageContent(base64Image, 'image/jpeg')],
          isError: false,
        };
      }

      try {
        await fileSystemExecutor.rm(screenshotPath);
      } catch (err) {
        log('warning', `${LOG_PREFIX}: Failed to delete temp file: ${err}`);
      }

      const fileUrl = `file://${optimizedPath}`;
      return createTextResponse(
        `Screenshot captured (image/jpeg):\n[${optimizedPath}](${fileUrl})`,
      );
    } catch (fileError) {
      log('error', `${LOG_PREFIX}: Failed to process image file: ${fileError}`);
      return createErrorResponse(
        `Screenshot captured but failed to process image file: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
      );
    }
  } catch (_error) {
    log('error', `${LOG_PREFIX}: Failed - ${_error}`);
    if (_error instanceof SystemError) {
      return createErrorResponse(
        `System error executing screenshot: ${_error.message}`,
        _error.originalError?.stack,
      );
    }
    return createErrorResponse(
      `An unexpected error occurred: ${_error instanceof Error ? _error.message : String(_error)}`,
    );
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: deviceScreenshotSchema,
});

export const handler = createSessionAwareTool<DeviceScreenshotParams>({
  internalSchema: deviceScreenshotSchema as unknown as z.ZodType<DeviceScreenshotParams, unknown>,
  logicFunction: (params: DeviceScreenshotParams, executor: CommandExecutor) => {
    return deviceScreenshotLogic(params, executor);
  },
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId'], message: 'deviceId is required' }],
});
