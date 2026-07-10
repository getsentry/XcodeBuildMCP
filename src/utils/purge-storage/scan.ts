import type { Dirent, Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ScanAccumulator } from './types.ts';

export function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeFsError(error: unknown, enoentMessage: string): string {
  return isEnoent(error) ? enoentMessage : errorMessage(error);
}

export function warningForPath(filePath: string, message: string): string {
  return `${filePath}: ${message}`;
}

export function zeroAccumulator(): ScanAccumulator {
  return {
    bytes: 0,
    fileCount: 0,
    directoryCount: 0,
    latestMtimeMs: null,
    latestFileMtimeMs: null,
    latestDirectoryMtimeMs: null,
    scanComplete: true,
    warnings: [],
  };
}

function updateLatestMtime(current: number | null, next: number): number {
  return current === null ? next : Math.max(current, next);
}

function appendScanWarning(accumulator: ScanAccumulator, warning: string): void {
  accumulator.scanComplete = false;
  accumulator.warnings.push(warning);
}

function scanErrorMessage(filePath: string, error: unknown): string {
  return warningForPath(filePath, describeFsError(error, 'path disappeared during scan'));
}

export async function scanPath(filePath: string): Promise<ScanAccumulator> {
  const accumulator = zeroAccumulator();
  await scanPathInto(filePath, accumulator, new Set<string>());
  return accumulator;
}

async function scanPathInto(
  filePath: string,
  accumulator: ScanAccumulator,
  countedInodes: Set<string>,
): Promise<void> {
  let stat: Stats;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    appendScanWarning(accumulator, scanErrorMessage(filePath, error));
    return;
  }

  accumulator.latestMtimeMs = updateLatestMtime(accumulator.latestMtimeMs, stat.mtimeMs);

  if (stat.isSymbolicLink()) {
    appendScanWarning(accumulator, warningForPath(filePath, 'symbolic link skipped'));
    return;
  }

  if (stat.isDirectory()) {
    accumulator.latestDirectoryMtimeMs = updateLatestMtime(
      accumulator.latestDirectoryMtimeMs,
      stat.mtimeMs,
    );
    accumulator.directoryCount += 1;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(filePath, { withFileTypes: true });
    } catch (error) {
      appendScanWarning(accumulator, scanErrorMessage(filePath, error));
      return;
    }
    for (const entry of entries) {
      await scanPathInto(path.join(filePath, entry.name), accumulator, countedInodes);
    }
    return;
  }

  if (stat.isFile()) {
    accumulator.latestFileMtimeMs = updateLatestMtime(accumulator.latestFileMtimeMs, stat.mtimeMs);
    accumulator.fileCount += 1;
    if (stat.nlink > 1) {
      const inodeKey = `${stat.dev}:${stat.ino}`;
      if (countedInodes.has(inodeKey)) {
        return;
      }
      countedInodes.add(inodeKey);
    }
    accumulator.bytes += stat.size;
    return;
  }

  appendScanWarning(accumulator, warningForPath(filePath, 'non-regular filesystem entry skipped'));
}
