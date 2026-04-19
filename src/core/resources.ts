/**
 * Resource Management - MCP Resource handlers and URI management
 *
 * This module manages MCP resources using manifest-driven discovery and
 * predicate-aware registration through the Model Context Protocol resource system.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../utils/logging/index.ts';
import { loadManifest } from './manifest/load-manifest.ts';
import { importResourceModule } from './manifest/import-resource-module.ts';
import type { ResourceManifestEntry } from './manifest/schema.ts';
import type { PredicateContext } from '../visibility/predicate-types.ts';
import { isResourceExposedForRuntime } from '../visibility/exposure.ts';

/**
 * Resource metadata interface (runtime-assembled from manifest + imported module).
 */
export interface ResourceMeta {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
}

/**
 * Load resources from manifests, filtered by predicate context.
 * @param ctx Predicate context for visibility filtering
 * @returns Map of resource URI to resource metadata
 */
export async function loadResources(ctx: PredicateContext): Promise<Map<string, ResourceMeta>> {
  const manifest = loadManifest();
  const resources = new Map<string, ResourceMeta>();

  for (const resource of manifest.resources.values()) {
    if (!isResourceExposedForRuntime(resource, ctx)) {
      log('info', `Skipped resource '${resource.name}' (hidden by predicates)`);
      continue;
    }

    let resourceModule;
    try {
      resourceModule = await importResourceModule(resource.module);
    } catch (err) {
      log(
        'error',
        `[infra/resources] failed to import resource module '${resource.module}': ${err}`,
        {
          sentry: true,
        },
      );
      continue;
    }

    resources.set(resource.uri, {
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
      handler: resourceModule.handler,
    });

    log('info', `Loaded resource: ${resource.name} (${resource.uri})`);
  }

  return resources;
}

/**
 * Register resources with the MCP server using manifest-driven discovery.
 * @param server The MCP server instance
 * @param ctx Predicate context for visibility filtering
 * @returns true if resources were registered
 */
export async function registerResources(
  server: McpServer,
  ctx: PredicateContext,
): Promise<boolean> {
  const resources = await loadResources(ctx);

  for (const [uri, resource] of resources) {
    const readCallback = async (resourceUri: URL): Promise<ReadResourceResult> => {
      const result = await resource.handler(resourceUri);
      return {
        contents: result.contents.map((content) => ({
          uri: resourceUri.toString(),
          text: content.text,
          mimeType: resource.mimeType,
        })),
      };
    };

    server.resource(
      resource.name,
      uri,
      {
        mimeType: resource.mimeType,
        title: resource.description,
      },
      readCallback,
    );

    log('info', `Registered resource: ${resource.name} at ${uri}`);
  }

  log('info', `Registered ${resources.size} resources`);
  return true;
}

/**
 * Get all available resource URIs for the given context.
 * @param ctx Predicate context for visibility filtering
 * @returns Array of resource URI strings
 */
export async function getAvailableResources(ctx: PredicateContext): Promise<string[]> {
  const resources = await loadResources(ctx);
  return Array.from(resources.keys());
}
