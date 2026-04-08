import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSnapshotOutput } from './normalize.ts';
import { loadManifest } from '../core/manifest/load-manifest.ts';
import { getEffectiveCliName } from '../core/manifest/schema.ts';
import { importToolModule } from '../core/manifest/import-tool-module.ts';
import type { ToolManifestEntry } from '../core/manifest/schema.ts';
import { postProcessSession } from '../runtime/tool-invoker.ts';
import { createToolCatalog } from '../runtime/tool-catalog.ts';
import type { ToolDefinition } from '../runtime/types.ts';
import type { ToolHandlerContext } from '../rendering/types.ts';
import { createRenderSession } from '../rendering/render.ts';

const CLI_PATH = path.resolve(process.cwd(), 'build/cli.js');

export interface SnapshotHarness {
  invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult>;
  cleanup(): void;
}

export interface SnapshotResult {
  text: string;
  rawText: string;
  isError: boolean;
}

function resolveToolManifest(
  workflowId: string,
  cliToolName: string,
): {
  toolModulePath: string;
  isMcpOnly: boolean;
  isStateful: boolean;
  manifestEntry: ToolManifestEntry;
} | null {
  const manifest = loadManifest();
  const workflow = manifest.workflows.get(workflowId);
  if (!workflow) return null;

  const isMcpOnly = !workflow.availability.cli;

  for (const toolId of workflow.tools) {
    const tool = manifest.tools.get(toolId);
    if (!tool) continue;
    if (getEffectiveCliName(tool) === cliToolName) {
      return {
        toolModulePath: tool.module,
        isMcpOnly,
        isStateful: tool.routing?.stateful === true,
        manifestEntry: tool,
      };
    }
  }

  return null;
}

function buildMinimalToolCatalog(
  manifestEntry: ToolManifestEntry,
  handler: ToolDefinition['handler'],
): { tool: ToolDefinition; catalog: ReturnType<typeof createToolCatalog> } {
  const manifest = loadManifest();
  const noopHandler: ToolDefinition['handler'] = async () => {};

  const allTools: ToolDefinition[] = Array.from(manifest.tools.values()).map((toolEntry) => ({
    id: toolEntry.id,
    cliName: getEffectiveCliName(toolEntry),
    mcpName: toolEntry.names.mcp,
    workflow: '',
    description: toolEntry.description,
    nextStepTemplates: toolEntry.nextSteps,
    mcpSchema: {} as ToolDefinition['mcpSchema'],
    cliSchema: {} as ToolDefinition['cliSchema'],
    stateful: toolEntry.routing?.stateful ?? false,
    handler: toolEntry.id === manifestEntry.id ? handler : noopHandler,
  }));

  const catalog = createToolCatalog(allTools);
  const tool = catalog.getByToolId(manifestEntry.id) ?? allTools[0]!;
  return { tool, catalog };
}

async function importSnapshotToolModule(toolModulePath: string) {
  const sourceModulePath = path.resolve(process.cwd(), 'src', `${toolModulePath}.ts`);
  const sourceModuleUrl = pathToFileURL(sourceModulePath).href;

  try {
    return (await import(sourceModuleUrl)) as {
      handler: (params: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void>;
    };
  } catch {
    return importToolModule(toolModulePath);
  }
}

export async function createSnapshotHarness(): Promise<SnapshotHarness> {
  async function invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const resolved = resolveToolManifest(workflow, cliToolName);

    if (resolved?.isMcpOnly || resolved?.isStateful) {
      return invokeDirect(resolved.toolModulePath, resolved.manifestEntry, args);
    }

    return invokeCli(workflow, cliToolName, args);
  }

  async function invokeCli(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const jsonArg = JSON.stringify(args);
    const { VITEST, NODE_ENV, ...cleanEnv } = process.env;
    const result = spawnSync('node', [CLI_PATH, workflow, cliToolName, '--json', jsonArg], {
      encoding: 'utf8',
      timeout: 120000,
      cwd: process.cwd(),
      env: cleanEnv,
    });

    const stdout = result.stdout ?? '';
    return {
      text: normalizeSnapshotOutput(stdout),
      rawText: stdout,
      isError: result.status !== 0,
    };
  }

  async function invokeDirect(
    toolModulePath: string,
    manifestEntry: ToolManifestEntry,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const toolModule = await importSnapshotToolModule(toolModulePath);
    const session = createRenderSession('text');
    const ctx: ToolHandlerContext = {
      emit: (event) => {
        session.emit(event);
      },
      attach: (image) => {
        session.attach(image);
      },
    };
    await toolModule.handler(args, ctx);

    const { tool, catalog } = buildMinimalToolCatalog(
      manifestEntry,
      toolModule.handler as ToolDefinition['handler'],
    );
    postProcessSession({
      tool,
      session,
      ctx,
      catalog,
      runtime: 'mcp',
      applyTemplateNextSteps: ctx.nextStepParams != null,
    });

    const rawText = session.finalize() + '\n';
    return {
      text: normalizeSnapshotOutput(rawText),
      rawText,
      isError: session.isError(),
    };
  }

  function cleanup(): void {}

  return { invoke, cleanup };
}

/**
 * Shut down all booted simulators except those in the keep list.
 * Use before list/resource tests to guarantee a deterministic simulator state.
 */
export function shutdownAllSimulatorsExcept(keepUdids: string[] = []): void {
  const listOutput = execSync('xcrun simctl list devices available --json', {
    encoding: 'utf8',
  });
  const data = JSON.parse(listOutput) as {
    devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
  };
  const keepSet = new Set(keepUdids);
  for (const runtime of Object.values(data.devices)) {
    for (const device of runtime) {
      if (device.state === 'Booted' && !keepSet.has(device.udid)) {
        try {
          execSync(`xcrun simctl shutdown ${device.udid}`, { encoding: 'utf8' });
        } catch {
          // Ignore shutdown failures (device may already be shutting down).
        }
      }
    }
  }
}

export async function ensureSimulatorBooted(simulatorName: string): Promise<string> {
  const listOutput = execSync('xcrun simctl list devices available --json', {
    encoding: 'utf8',
  });
  const data = JSON.parse(listOutput) as {
    devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
  };

  for (const runtime of Object.values(data.devices)) {
    for (const device of runtime) {
      if (device.name === simulatorName) {
        if (device.state !== 'Booted') {
          execSync(`xcrun simctl boot ${device.udid}`, { encoding: 'utf8' });
        }
        return device.udid;
      }
    }
  }

  throw new Error(`Simulator "${simulatorName}" not found`);
}
