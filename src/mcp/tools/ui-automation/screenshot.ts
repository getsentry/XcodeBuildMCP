import * as path from 'node:path';
import { tmpdir } from 'node:os';
import * as z from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../../../utils/logging/index.ts';
import { SystemError } from '../../../utils/errors.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultFileSystemExecutor,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';

const LOG_PREFIX = '[Screenshot]';

async function getImageDimensions(
  imagePath: string,
  executor: CommandExecutor,
): Promise<string | null> {
  try {
    const result = await executor(
      ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', imagePath],
      `${LOG_PREFIX}: get dimensions`,
      false,
    );
    if (!result.success || !result.output) return null;
    const widthMatch = result.output.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = result.output.match(/pixelHeight:\s*(\d+)/);
    if (widthMatch && heightMatch) {
      return `${widthMatch[1]}x${heightMatch[1]}px`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Type for simctl device list response
 */
interface SimctlDevice {
  udid: string;
  name: string;
  state?: string;
}

interface SimctlDeviceList {
  devices: Record<string, SimctlDevice[]>;
}

function escapeSwiftStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Generates Swift code to detect simulator window dimensions via CoreGraphics.
 * Filters by device name to handle multiple open simulators correctly.
 * Returns "width,height" of the matching simulator window.
 */
function getWindowDetectionSwiftCode(deviceName: string): string {
  const escapedDeviceName = escapeSwiftStringLiteral(deviceName);
  // Match by title separator (en-dash) to avoid "iPhone 15" matching "iPhone 15 Pro"
  // Window titles are formatted like "iPhone 15 Pro \u{2013} iOS 17.2"
  return `
import Cocoa
import CoreGraphics
let deviceName = "${escapedDeviceName}"
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
if let wins = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
  for w in wins {
    if let o = w[kCGWindowOwnerName as String] as? String, o == "Simulator",
       let b = w[kCGWindowBounds as String] as? [String: Any],
       let n = w[kCGWindowName as String] as? String {
      // Check for exact match: name equals deviceName or is followed by the title separator
      // Window titles use en-dash: "iPhone 15 Pro \u{2013} iOS 17.2"
      let isMatch = n == deviceName || n.hasPrefix(deviceName + " \\u{2013}") || n.hasPrefix(deviceName + " -")
      if isMatch {
        print("\\(b["Width"] as? Int ?? 0),\\(b["Height"] as? Int ?? 0)")
        break
      }
    }
  }
}`.trim();
}

/**
 * Gets the device name for a simulator ID using simctl.
 * Returns the device name or null if not found.
 */
export async function getDeviceNameForSimulatorId(
  simulatorId: string,
  executor: CommandExecutor,
): Promise<string | null> {
  try {
    const listCommand = ['xcrun', 'simctl', 'list', 'devices', '-j'];
    const result = await executor(listCommand, `${LOG_PREFIX}: list devices`, false);

    if (result.success && result.output) {
      const data = JSON.parse(result.output) as SimctlDeviceList;
      const devices = data.devices;

      for (const runtime of Object.keys(devices)) {
        for (const device of devices[runtime]) {
          if (device.udid === simulatorId) {
            log('info', `${LOG_PREFIX}: Found device name "${device.name}" for ${simulatorId}`);
            return device.name;
          }
        }
      }
    }
    log('warn', `${LOG_PREFIX}: Could not find device name for ${simulatorId}`);
    return null;
  } catch (error) {
    log('warn', `${LOG_PREFIX}: Failed to get device name: ${error}`);
    return null;
  }
}

/**
 * Detects if the simulator window is in landscape orientation.
 * Uses the device name to filter when multiple simulators are open.
 * Returns true if width > height, indicating landscape mode.
 */
export async function detectLandscapeMode(
  executor: CommandExecutor,
  deviceName?: string,
): Promise<boolean> {
  try {
    // If no device name available, skip orientation detection to avoid incorrect rotation
    // This is safer than guessing, as we don't know if it's iPhone or iPad
    if (!deviceName) {
      log('warn', `${LOG_PREFIX}: No device name available, skipping orientation detection`);
      return false;
    }
    const swiftCode = getWindowDetectionSwiftCode(deviceName);
    const swiftCommand = ['swift', '-e', swiftCode];
    const result = await executor(swiftCommand, `${LOG_PREFIX}: detect orientation`, false);

    if (result.success && result.output) {
      const match = result.output.trim().match(/(\d+),(\d+)/);
      if (match) {
        const width = parseInt(match[1], 10);
        const height = parseInt(match[2], 10);
        const isLandscape = width > height;
        log(
          'info',
          `${LOG_PREFIX}: Window dimensions ${width}x${height}, landscape=${isLandscape}`,
        );
        return isLandscape;
      }
    }
    log('warn', `${LOG_PREFIX}: Could not detect window orientation, assuming portrait`);
    return false;
  } catch (error) {
    log('warn', `${LOG_PREFIX}: Orientation detection failed: ${error}`);
    return false;
  }
}

/**
 * Rotates an image by the specified degrees using sips.
 */
export async function rotateImage(
  imagePath: string,
  degrees: number,
  executor: CommandExecutor,
): Promise<boolean> {
  try {
    const rotateArgs = ['sips', '--rotate', degrees.toString(), imagePath];
    const result = await executor(rotateArgs, `${LOG_PREFIX}: rotate image`, false);
    return result.success;
  } catch (error) {
    log('warn', `${LOG_PREFIX}: Image rotation failed: ${error}`);
    return false;
  }
}

const screenshotSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  returnFormat: z
    .enum(['path', 'base64'])
    .optional()
    .describe('Return image path or base64 data (path|base64)'),
});

type ScreenshotParams = z.infer<typeof screenshotSchema>;

const publicSchemaObject = z.strictObject(
  screenshotSchema.omit({ simulatorId: true } as const).shape,
);

export async function screenshotLogic(
  params: ScreenshotParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
  pathUtils: { tmpdir: () => string; join: (...paths: string[]) => string } = { ...path, tmpdir },
  uuidUtils: { v4: () => string } = { v4: uuidv4 },
): Promise<void> {
  const ctx = getHandlerContext();
  const { simulatorId } = params;
  const headerEvent = header('Screenshot', [{ label: 'Simulator', value: simulatorId }]);
  const runtime = process.env.XCODEBUILDMCP_RUNTIME;
  const defaultFormat = runtime === 'cli' || runtime === 'daemon' ? 'path' : 'base64';
  const returnFormat = params.returnFormat ?? defaultFormat;
  const tempDir = pathUtils.tmpdir();
  const screenshotFilename = `screenshot_${uuidUtils.v4()}.png`;
  const screenshotPath = pathUtils.join(tempDir, screenshotFilename);
  const optimizedFilename = `screenshot_optimized_${uuidUtils.v4()}.jpg`;
  const optimizedPath = pathUtils.join(tempDir, optimizedFilename);
  const commandArgs: string[] = [
    'xcrun',
    'simctl',
    'io',
    simulatorId,
    'screenshot',
    screenshotPath,
  ];

  log('info', `${LOG_PREFIX}/screenshot: Starting capture to ${screenshotPath} on ${simulatorId}`);

  try {
    const result = await executor(commandArgs, `${LOG_PREFIX}: screenshot`, false);

    if (!result.success) {
      throw new SystemError(`Failed to capture screenshot: ${result.error ?? result.output}`);
    }

    log('info', `${LOG_PREFIX}/screenshot: Success for ${simulatorId}`);

    try {
      const deviceName = await getDeviceNameForSimulatorId(simulatorId, executor);
      const isLandscape = await detectLandscapeMode(executor, deviceName ?? undefined);
      if (isLandscape) {
        log('info', `${LOG_PREFIX}/screenshot: Landscape mode detected, rotating +90`);
        const rotated = await rotateImage(screenshotPath, 90, executor);
        if (!rotated) {
          log('warn', `${LOG_PREFIX}/screenshot: Rotation failed, continuing with original`);
        }
      }

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
        log('warn', `${LOG_PREFIX}/screenshot: Image optimization failed, using original PNG`);
        if (returnFormat === 'base64') {
          const base64Image = await fileSystemExecutor.readFile(screenshotPath, 'base64');

          try {
            await fileSystemExecutor.rm(screenshotPath);
          } catch (err) {
            log('warn', `${LOG_PREFIX}/screenshot: Failed to delete temp file: ${err}`);
          }

          ctx.emit(headerEvent);
          ctx.emit(statusLine('success', 'Screenshot captured'));
          ctx.emit(
            detailTree([{ label: 'Format', value: 'image/png (optimization failed)' }]),
          );
          ctx.attach({ data: base64Image, mimeType: 'image/png' });
          return;
        }

        ctx.emit(headerEvent);
        ctx.emit(statusLine('success', 'Screenshot captured'));
        ctx.emit(
          detailTree([
            { label: 'Screenshot', value: screenshotPath },
            { label: 'Format', value: 'image/png (optimization failed)' },
          ]),
        );
        return;
      }

      log('info', `${LOG_PREFIX}/screenshot: Image optimized successfully`);

      if (returnFormat === 'base64') {
        const base64Image = await fileSystemExecutor.readFile(optimizedPath, 'base64');
        const base64Dims = await getImageDimensions(optimizedPath, executor);

        log('info', `${LOG_PREFIX}/screenshot: Successfully encoded image as Base64`);

        try {
          await fileSystemExecutor.rm(screenshotPath);
          await fileSystemExecutor.rm(optimizedPath);
        } catch (err) {
          log('warn', `${LOG_PREFIX}/screenshot: Failed to delete temporary files: ${err}`);
        }

        ctx.emit(headerEvent);
        ctx.emit(statusLine('success', 'Screenshot captured'));
        ctx.emit(
          detailTree([
            { label: 'Format', value: 'image/jpeg' },
            ...(base64Dims ? [{ label: 'Size', value: base64Dims }] : []),
          ] as Array<{ label: string; value: string }>),
        );
        ctx.attach({ data: base64Image, mimeType: 'image/jpeg' });
        return;
      }

      try {
        await fileSystemExecutor.rm(screenshotPath);
      } catch (err) {
        log('warn', `${LOG_PREFIX}/screenshot: Failed to delete temp file: ${err}`);
      }

      const dims = await getImageDimensions(optimizedPath, executor);
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Screenshot captured'));
      ctx.emit(
        detailTree([
          { label: 'Screenshot', value: optimizedPath },
          { label: 'Format', value: 'image/jpeg' },
          ...(dims ? [{ label: 'Size', value: dims }] : []),
        ] as Array<{ label: string; value: string }>),
      );
      return;
    } catch (fileError) {
      log('error', `${LOG_PREFIX}/screenshot: Failed to process image file: ${fileError}`);
      ctx.emit(headerEvent);
      ctx.emit(
        statusLine(
          'error',
          `Screenshot captured but failed to process image file: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
        ),
      );
      return;
    }
  } catch (_error) {
    log('error', `${LOG_PREFIX}/screenshot: Failed - ${_error}`);
    ctx.emit(headerEvent);
    if (_error instanceof SystemError) {
      ctx.emit(statusLine('error', `System error executing screenshot: ${_error.message}`));
      return;
    }
    ctx.emit(
      statusLine(
        'error',
        `An unexpected error occurred: ${_error instanceof Error ? _error.message : String(_error)}`,
      ),
    );
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: screenshotSchema,
});

export const handler = createSessionAwareTool<ScreenshotParams>({
  internalSchema: screenshotSchema as unknown as z.ZodType<ScreenshotParams, unknown>,
  logicFunction: (params: ScreenshotParams, executor: CommandExecutor) =>
    screenshotLogic(params, executor),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
