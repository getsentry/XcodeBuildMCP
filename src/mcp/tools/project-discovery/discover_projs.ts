/**
 * Project Discovery Plugin: Discover Projects
 *
 * Scans a directory (defaults to workspace root) to find Xcode project (.xcodeproj)
 * and workspace (.xcworkspace) files.
 */

import * as z from 'zod';
import * as path from 'node:path';
import { log } from '../../../utils/logging/index.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const DEFAULT_MAX_DEPTH = 3;
const SKIPPED_DIRS = new Set(['build', 'DerivedData', 'Pods', '.git', 'node_modules']);

interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

function getErrorDetails(
  error: unknown,
  fallbackMessage: string,
): { code?: string; message: string } {
  if (error instanceof Error) {
    const nodeError = error as NodeJS.ErrnoException;
    return { code: nodeError.code, message: error.message };
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : fallbackMessage,
    };
  }

  return { message: String(error) };
}

/**
 * Recursively scans directories to find Xcode projects and workspaces.
 */
async function _findProjectsRecursive(
  currentDirAbs: string,
  workspaceRootAbs: string,
  currentDepth: number,
  maxDepth: number,
  results: { projects: string[]; workspaces: string[] },
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  if (currentDepth >= maxDepth) {
    log('debug', `Max depth ${maxDepth} reached at ${currentDirAbs}, stopping recursion.`);
    return;
  }

  log('debug', `Scanning directory: ${currentDirAbs} at depth ${currentDepth}`);
  const normalizedWorkspaceRoot = path.normalize(workspaceRootAbs);

  try {
    const entries = await fileSystemExecutor.readdir(currentDirAbs, { withFileTypes: true });
    for (const rawEntry of entries) {
      const entry = rawEntry as DirentLike;
      const absoluteEntryPath = path.join(currentDirAbs, entry.name);
      const relativePath = path.relative(workspaceRootAbs, absoluteEntryPath);

      if (entry.isSymbolicLink()) {
        log('debug', `Skipping symbolic link: ${relativePath}`);
        continue;
      }

      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) {
        log('debug', `Skipping standard directory: ${relativePath}`);
        continue;
      }

      if (!path.normalize(absoluteEntryPath).startsWith(normalizedWorkspaceRoot)) {
        log(
          'warn',
          `Skipping entry outside workspace root: ${absoluteEntryPath} (Workspace: ${workspaceRootAbs})`,
        );
        continue;
      }

      if (entry.isDirectory()) {
        let isXcodeBundle = false;

        if (entry.name.endsWith('.xcodeproj')) {
          results.projects.push(absoluteEntryPath);
          log('debug', `Found project: ${absoluteEntryPath}`);
          isXcodeBundle = true;
        } else if (entry.name.endsWith('.xcworkspace')) {
          results.workspaces.push(absoluteEntryPath);
          log('debug', `Found workspace: ${absoluteEntryPath}`);
          isXcodeBundle = true;
        }

        if (!isXcodeBundle) {
          await _findProjectsRecursive(
            absoluteEntryPath,
            workspaceRootAbs,
            currentDepth + 1,
            maxDepth,
            results,
            fileSystemExecutor,
          );
        }
      }
    }
  } catch (error) {
    const { code, message } = getErrorDetails(error, 'Unknown error');

    if (code === 'EPERM' || code === 'EACCES') {
      log('debug', `Permission denied scanning directory: ${currentDirAbs}`);
    } else {
      log('warn', `Error scanning directory ${currentDirAbs}: ${message} (Code: ${code ?? 'N/A'})`);
    }
  }
}

const discoverProjsSchema = z.object({
  workspaceRoot: z.string(),
  scanPath: z.string().optional(),
  maxDepth: z.number().int().nonnegative().optional(),
});

export interface DiscoverProjectsParams {
  workspaceRoot: string;
  scanPath?: string;
  maxDepth?: number;
}

export interface DiscoverProjectsResult {
  projects: string[];
  workspaces: string[];
}

type DiscoverProjsParams = z.infer<typeof discoverProjsSchema>;

function isBundleLikePath(workspaceRoot: string): boolean {
  return (
    workspaceRoot.endsWith('.app') ||
    workspaceRoot.endsWith('.xcworkspace') ||
    workspaceRoot.endsWith('.xcodeproj')
  );
}

function resolveScanBase(workspaceRoot: string, scanPath?: string): string {
  if (scanPath) {
    return scanPath;
  }

  if (isBundleLikePath(workspaceRoot)) {
    return path.dirname(workspaceRoot);
  }

  return '.';
}

async function discoverProjectsOrError(
  params: DiscoverProjectsParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<DiscoverProjectsResult | { error: string }> {
  const scanPath = resolveScanBase(params.workspaceRoot, params.scanPath);
  const maxDepth = params.maxDepth ?? DEFAULT_MAX_DEPTH;
  const workspaceRoot = params.workspaceRoot;

  const requestedScanPath = path.resolve(workspaceRoot, scanPath);
  let absoluteScanPath = requestedScanPath;
  const workspaceBoundary = isBundleLikePath(workspaceRoot)
    ? path.dirname(workspaceRoot)
    : workspaceRoot;
  const normalizedWorkspaceRoot = path.normalize(workspaceBoundary);
  if (!path.normalize(absoluteScanPath).startsWith(normalizedWorkspaceRoot)) {
    log(
      'warn',
      `Requested scan path '${scanPath}' resolved outside workspace root '${workspaceRoot}'. Defaulting scan to workspace root.`,
    );
    absoluteScanPath = normalizedWorkspaceRoot;
  }

  log(
    'info',
    `Starting project discovery request: path=${absoluteScanPath}, maxDepth=${maxDepth}, workspace=${workspaceRoot}`,
  );

  try {
    const stats = await fileSystemExecutor.stat(absoluteScanPath);
    if (!stats.isDirectory()) {
      const errorMsg = `Scan path is not a directory: ${absoluteScanPath}`;
      log('error', errorMsg);
      return { error: errorMsg };
    }
  } catch (error) {
    const { code, message } = getErrorDetails(error, 'Unknown error accessing scan path');
    const errorMsg = `Failed to access scan path: ${absoluteScanPath}. Error: ${message}`;
    log('error', `${errorMsg} - Code: ${code ?? 'N/A'}`);
    return { error: errorMsg };
  }

  const results: DiscoverProjectsResult = { projects: [], workspaces: [] };
  await _findProjectsRecursive(
    absoluteScanPath,
    workspaceRoot,
    0,
    maxDepth,
    results,
    fileSystemExecutor,
  );

  results.projects.sort();
  results.workspaces.sort();
  return results;
}

export async function discoverProjects(
  params: DiscoverProjectsParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<DiscoverProjectsResult> {
  const result = await discoverProjectsOrError(params, fileSystemExecutor);
  if ('error' in result) {
    throw new Error(result.error);
  }
  return result;
}

/**
 * Business logic for discovering projects.
 * Exported for testing purposes.
 */
export async function discover_projsLogic(
  params: DiscoverProjsParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const scanPath = resolveScanBase(params.workspaceRoot, params.scanPath);
  const maxDepth = params.maxDepth ?? DEFAULT_MAX_DEPTH;
  const resolvedWorkspaceRoot = path.resolve(params.workspaceRoot);
  const resolvedScanPath = path.resolve(params.workspaceRoot, scanPath);

  const headerEvent = header('Discover Projects', [
    { label: 'Workspace root', value: resolvedWorkspaceRoot },
    { label: 'Scan path', value: resolvedScanPath },
    { label: 'Max depth', value: String(maxDepth) },
  ]);
  const results = await discoverProjectsOrError(params, fileSystemExecutor);
  if ('error' in results) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', results.error));
    return;
  }

  log(
    'info',
    `Discovery finished. Found ${results.projects.length} projects and ${results.workspaces.length} workspaces.`,
  );

  const projectWord = results.projects.length === 1 ? 'project' : 'projects';
  const workspaceWord = results.workspaces.length === 1 ? 'workspace' : 'workspaces';

  ctx.emit(headerEvent);
  ctx.emit(
    statusLine(
      'success',
      `Found ${results.projects.length} ${projectWord} and ${results.workspaces.length} ${workspaceWord}`,
    ),
  );

  const cwd = process.cwd();
  function toRelative(p: string): string {
    return path.relative(cwd, p) || p;
  }

  if (results.projects.length > 0) {
    ctx.emit(section('Projects:', results.projects.map(toRelative)));
  }

  if (results.workspaces.length > 0) {
    ctx.emit(section('Workspaces:', results.workspaces.map(toRelative)));
  }
}

export const schema = discoverProjsSchema.shape;

export const handler = createTypedTool(
  discoverProjsSchema,
  (params: DiscoverProjsParams) => discover_projsLogic(params, getDefaultFileSystemExecutor()),
  getDefaultCommandExecutor,
);
