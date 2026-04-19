/**
 * Resource module importer.
 * Dynamically imports resource modules using named exports only.
 */

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPackageRoot } from './load-manifest.ts';

export interface ImportedResourceModule {
  handler: (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
}

const moduleCache = new Map<string, ImportedResourceModule>();

/**
 * Import a resource module by its manifest module path.
 *
 * Accepts named export only: `export const handler = ...`
 *
 * @param moduleId - Extensionless module path (e.g., 'mcp/resources/simulators')
 * @returns Imported resource module with handler
 */
export async function importResourceModule(moduleId: string): Promise<ImportedResourceModule> {
  const cached = moduleCache.get(moduleId);
  if (cached) {
    return cached;
  }

  const packageRoot = getPackageRoot();
  const modulePath = path.join(packageRoot, 'build', `${moduleId}.js`);
  const moduleUrl = pathToFileURL(modulePath).href;

  let mod: Record<string, unknown>;
  try {
    mod = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to import resource module '${moduleId}': ${err}`);
  }

  if (typeof mod.handler !== 'function') {
    throw new Error(
      `Resource module '${moduleId}' does not export the required shape. ` +
        `Expected a named export: export const handler = ...`,
    );
  }

  const result: ImportedResourceModule = {
    handler: mod.handler as ImportedResourceModule['handler'],
  };

  moduleCache.set(moduleId, result);
  return result;
}

/**
 * Reset module cache (for tests).
 */
export function __resetResourceModuleCacheForTests(): void {
  moduleCache.clear();
}
