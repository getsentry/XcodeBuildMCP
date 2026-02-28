/**
 * Project Discovery Plugin: Discover Projects
 *
 * Scans a directory (defaults to workspace root) to find Xcode project (.xcodeproj)
 * and workspace (.xcworkspace) files.
 */

import * as z from 'zod';
import * as path from 'node:path';
import { log } from '../../../utils/logging/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { createTextContent } from '../../../types/common.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';

// Constants
const DEFAULT_MAX_DEPTH = 5;
const SKIPPED_DIRS = new Set(['build', 'DerivedData', 'Pods', '.git', 'node_modules']);

// Type definition for Dirent-like objects returned by readdir with withFileTypes: true
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
    const errorWithCode = error as Error & { code?: unknown };
    return {
      code: typeof errorWithCode.code === 'string' ? errorWithCode.code : undefined,
      message: error.message,
    };
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
  // Explicit depth check (now simplified as maxDepth is always non-negative)
  if (currentDepth >= maxDepth) {
    log('debug', `Max depth ${maxDepth} reached at ${currentDirAbs}, stopping recursion.`);
    return;
  }

  log('debug', `Scanning directory: ${currentDirAbs} at depth ${currentDepth}`);
  const normalizedWorkspaceRoot = path.normalize(workspaceRootAbs);

  try {
    // Use the injected fileSystemExecutor
    const entries = await fileSystemExecutor.readdir(currentDirAbs, { withFileTypes: true });
    for (const rawEntry of entries) {
      // Cast the unknown entry to DirentLike interface for type safety
      const entry = rawEntry as DirentLike;
      const absoluteEntryPath = path.join(currentDirAbs, entry.name);
      const relativePath = path.relative(workspaceRootAbs, absoluteEntryPath);

      // --- Skip conditions ---
      if (entry.isSymbolicLink()) {
        log('debug', `Skipping symbolic link: ${relativePath}`);
        continue;
      }

      // Skip common build/dependency directories by name
      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) {
        log('debug', `Skipping standard directory: ${relativePath}`);
        continue;
      }

      // Ensure entry is within the workspace root (security/sanity check)
      if (!path.normalize(absoluteEntryPath).startsWith(normalizedWorkspaceRoot)) {
        log(
          'warn',
          `Skipping entry outside workspace root: ${absoluteEntryPath} (Workspace: ${workspaceRootAbs})`,
        );
        continue;
      }

      // --- Process entries ---
      if (entry.isDirectory()) {
        let isXcodeBundle = false;

        if (entry.name.endsWith('.xcodeproj')) {
          results.projects.push(absoluteEntryPath); // Use absolute path
          log('debug', `Found project: ${absoluteEntryPath}`);
          isXcodeBundle = true;
        } else if (entry.name.endsWith('.xcworkspace')) {
          results.workspaces.push(absoluteEntryPath); // Use absolute path
          log('debug', `Found workspace: ${absoluteEntryPath}`);
          isXcodeBundle = true;
        }

        // Recurse into regular directories, but not into found project/workspace bundles
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

// Define schema as ZodObject
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

// Use z.infer for type safety
type DiscoverProjsParams = z.infer<typeof discoverProjsSchema>;

async function discoverProjectsOrError(
  params: DiscoverProjectsParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<DiscoverProjectsResult | { error: string }> {
  const scanPath = params.scanPath ?? '.';
  const maxDepth = params.maxDepth ?? DEFAULT_MAX_DEPTH;
  const workspaceRoot = params.workspaceRoot;

  const requestedScanPath = path.resolve(workspaceRoot, scanPath);
  let absoluteScanPath = requestedScanPath;
  const normalizedWorkspaceRoot = path.normalize(workspaceRoot);
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
): Promise<ToolResponse> {
  const results = await discoverProjectsOrError(params, fileSystemExecutor);
  if ('error' in results) {
    return {
      content: [createTextContent(results.error)],
      isError: true,
    };
  }

  log(
    'info',
    `Discovery finished. Found ${results.projects.length} projects and ${results.workspaces.length} workspaces.`,
  );

  const responseContent = [
    createTextContent(
      `Discovery finished. Found ${results.projects.length} projects and ${results.workspaces.length} workspaces.`,
    ),
  ];

  if (results.projects.length > 0) {
    responseContent.push(
      createTextContent(`Projects found:\n - ${results.projects.join('\n - ')}`),
    );
  }

  if (results.workspaces.length > 0) {
    responseContent.push(
      createTextContent(`Workspaces found:\n - ${results.workspaces.join('\n - ')}`),
    );
  }

  if (results.projects.length > 0 || results.workspaces.length > 0) {
    responseContent.push(
      createTextContent(
        "Hint: Save a default with session-set-defaults { projectPath: '...' } or { workspacePath: '...' }.",
      ),
    );
  }

  return {
    content: responseContent,
    isError: false,
  };
}

export const schema = discoverProjsSchema.shape;

export const handler = createTypedTool(
  discoverProjsSchema,
  (params: DiscoverProjsParams) => {
    return discover_projsLogic(params, getDefaultFileSystemExecutor());
  },
  getDefaultCommandExecutor,
);
