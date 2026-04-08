/**
 * Tool module importer.
 * Dynamically imports tool modules using named exports only.
 */

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolSchemaShape } from '../plugin-types.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';
import { getPackageRoot } from './load-manifest.ts';

export interface ImportedToolModule {
  schema: ToolSchemaShape;
  handler: (params: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<unknown>;
}

const moduleCache = new Map<string, ImportedToolModule>();

/**
 * Import a tool module by its manifest module path.
 *
 * Accepts named exports only: `export const schema = ...` and `export const handler = ...`
 *
 * @param moduleId - Extensionless module path (e.g., 'mcp/tools/simulator/build_sim')
 * @returns Imported tool module with schema and handler
 */
export async function importToolModule(moduleId: string): Promise<ImportedToolModule> {
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
    throw new Error(`Failed to import tool module '${moduleId}': ${err}`);
  }

  if (!mod.schema || typeof mod.handler !== 'function') {
    throw new Error(
      `Tool module '${moduleId}' does not export the required shape. ` +
        `Expected named exports: export const schema = ... and export const handler = ...`,
    );
  }

  const result: ImportedToolModule = {
    schema: mod.schema as ToolSchemaShape,
    handler: mod.handler as (
      params: Record<string, unknown>,
      ctx?: ToolHandlerContext,
    ) => Promise<unknown>,
  };

  moduleCache.set(moduleId, result);
  return result;
}

/**
 * Reset module cache (for tests).
 */
export function __resetToolModuleCacheForTests(): void {
  moduleCache.clear();
}
