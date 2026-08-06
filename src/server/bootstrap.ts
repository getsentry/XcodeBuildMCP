import type { McpServer } from '@modelcontextprotocol/server';
import { loadResources, registerLoadedResources, type ResourceMeta } from '../core/resources.ts';
import type { FileSystemExecutor } from '../utils/FileSystemExecutor.ts';
import { log, normalizeLogLevel, setLogLevel } from '../utils/logger.ts';
import type { RuntimeConfigOverrides } from '../utils/config-store.ts';
import {
  applyToolPlanToServer,
  getRegisteredWorkflows,
  getToolRegistrationPlan,
  registerWorkflowsFromManifest,
  type McpToolRegistrationPlan,
} from '../utils/tool-registry.ts';
import { bootstrapRuntime } from '../runtime/bootstrap-runtime.ts';
import { getXcodeToolsBridgeManager } from '../integrations/xcode-tools-bridge/index.ts';
import { detectXcodeRuntime } from '../utils/xcode-process.ts';
import { readXcodeIdeState } from '../utils/xcode-state-reader.ts';
import { sessionStore } from '../utils/session-store.ts';
import { startXcodeStateWatcher, lookupBundleId } from '../utils/xcode-state-watcher.ts';
import { getDefaultCommandExecutor } from '../utils/command.ts';
import type { PredicateContext } from '../visibility/predicate-types.ts';
import { createStartupProfiler, getStartupProfileNowMs } from './startup-profiler.ts';
import { runWorkspaceFilesystemLifecycleSweep } from '../utils/workspace-filesystem-lifecycle.ts';

export interface BootstrapOptions {
  enabledWorkflows?: string[];
  configOverrides?: RuntimeConfigOverrides;
  fileSystemExecutor?: FileSystemExecutor;
  cwd?: string;
}

/**
 * Everything a fresh server instance needs, resolved once per process.
 *
 * SDK v2 builds a new server per serving context, so the expensive discovery
 * work (manifest load, tool module imports, resource module imports, Xcode
 * runtime detection) is done once and replayed cheaply onto each instance.
 */
export interface ServerRegistrations {
  /**
   * Reads the tool registration plan that is current *now*.
   *
   * Deliberately a resolver rather than a captured value: `manage_workflows`
   * rewrites the process-level plan at runtime, and a serving context created
   * afterwards must serve the new selection. Capturing the plan at startup
   * would make every later context replay the boot-time workflows and silently
   * undo the client's selection.
   */
  resolveToolPlan: () => McpToolRegistrationPlan | null;
  resources: Map<string, ResourceMeta>;
  xcodeIdeEnabled: boolean;
}

export interface BootstrapResult {
  registrations: ServerRegistrations;
  runDeferredInitialization: (options?: { isShutdownRequested?: () => boolean }) => Promise<void>;
}

function runStartupFilesystemLifecycleSweep(workspaceKey: string): Promise<void> {
  return runWorkspaceFilesystemLifecycleSweep({
    workspaceKey,
    trigger: 'startup',
  })
    .then((lifecycle) => {
      if (lifecycle.stopped > 0 || lifecycle.deleted > 0 || lifecycle.errors.length > 0) {
        log(
          lifecycle.errors.length > 0 ? 'warn' : 'info',
          `[startup] Filesystem lifecycle: ${JSON.stringify(lifecycle)}`,
        );
      }
    })
    .catch((error) => {
      log(
        'warn',
        `[startup] Filesystem lifecycle failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

export interface ApplyServerRegistrationsOptions {
  /**
   * Whether this serving context owns the process-level Xcode tools bridge
   * binding.
   *
   * The bridge is a process singleton that registers its proxied tools onto one
   * server instance. A connection-scoped context (stdio) owns that binding for
   * the life of the connection. Per-request contexts (HTTP) must not take it:
   * rebinding on every request would move the proxied tools off the live
   * connection and leave the bridge pointing at an instance that is closed as
   * soon as the response is written.
   *
   * @default true
   */
  bindXcodeToolsBridge?: boolean;
}

/**
 * Applies process-level registrations onto a freshly built server instance.
 *
 * Called once per serving context. Everything here is cheap: the manifest, tool
 * modules and resource modules were already resolved by `bootstrapServerRuntime`.
 */
export function applyServerRegistrations(
  server: McpServer,
  registrations: ServerRegistrations,
  options: ApplyServerRegistrationsOptions = {},
): void {
  // Legacy-era clients set verbosity with logging/setLevel. Modern-era clients
  // send io.modelcontextprotocol/logLevel in each request _meta instead, which
  // the request-lifecycle observer applies.
  server.server.setRequestHandler('logging/setLevel', async (request) => {
    const { level } = request.params;
    const normalized = normalizeLogLevel(level);
    if (normalized) {
      setLogLevel(normalized);
    }
    log('info', `Client requested log level: ${level}`);
    return {};
  });

  const toolPlan = registrations.resolveToolPlan();
  if (toolPlan) {
    applyToolPlanToServer(server, toolPlan);
  }

  registerLoadedResources(server, registrations.resources);

  if (registrations.xcodeIdeEnabled && options.bindXcodeToolsBridge !== false) {
    const xcodeToolsBridge = getXcodeToolsBridgeManager(server);
    xcodeToolsBridge?.bindServer(server);
    xcodeToolsBridge?.setWorkflowEnabled(true);
  }
}

/**
 * Resolves the process-level runtime state and registration plan.
 *
 * Does not build or touch a server instance: serving entries construct fresh
 * instances and replay `result.registrations` onto each of them.
 */
export async function bootstrapServerRuntime(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const profiler = createStartupProfiler('bootstrap');

  const hasLegacyEnabledWorkflows = Object.prototype.hasOwnProperty.call(
    options,
    'enabledWorkflows',
  );
  let overrides: RuntimeConfigOverrides | undefined;
  if (options.configOverrides !== undefined) {
    overrides = { ...options.configOverrides };
  }
  if (hasLegacyEnabledWorkflows) {
    overrides ??= {};
    overrides.enabledWorkflows = options.enabledWorkflows ?? [];
  }

  let stageStartMs = getStartupProfileNowMs();
  const result = await bootstrapRuntime({
    runtime: 'mcp',
    cwd: options.cwd,
    fs: options.fileSystemExecutor,
    configOverrides: overrides,
  });
  profiler.mark('bootstrapRuntime', stageStartMs);

  if (result.configFound) {
    for (const notice of result.notices) {
      log('info', `[ProjectConfig] ${notice}`);
    }
  }

  const enabledWorkflows = result.runtime.config.enabledWorkflows;
  const { workspaceRoot, workspaceKey } = result;

  log('info', `🚀 Initializing server...`);

  const executor = getDefaultCommandExecutor();
  stageStartMs = getStartupProfileNowMs();
  const xcodeDetection = await detectXcodeRuntime(executor);
  profiler.mark('detectXcodeRuntime', stageStartMs);

  const ctx: PredicateContext = {
    runtime: 'mcp',
    config: result.runtime.config,
    runningUnderXcode: xcodeDetection.runningUnderXcode,
  };

  stageStartMs = getStartupProfileNowMs();
  await registerWorkflowsFromManifest(enabledWorkflows, ctx);
  profiler.mark('registerWorkflowsFromManifest', stageStartMs);

  const resolvedWorkflows = getRegisteredWorkflows();
  const xcodeIdeEnabled = resolvedWorkflows.includes('xcode-ide');

  stageStartMs = getStartupProfileNowMs();
  const resources = await loadResources(ctx);
  profiler.mark('loadResources', stageStartMs);

  return {
    registrations: {
      resolveToolPlan: getToolRegistrationPlan,
      resources,
      xcodeIdeEnabled,
    },
    runDeferredInitialization: async (options = {}): Promise<void> => {
      const deferredProfiler = createStartupProfiler('bootstrap-deferred');
      const isShutdownRequested = options.isShutdownRequested;

      void runStartupFilesystemLifecycleSweep(workspaceKey);

      if (!xcodeDetection.runningUnderXcode) {
        return;
      }

      log('info', `[xcode] Running under Xcode agent environment`);

      const { projectPath, workspacePath } = sessionStore.getAll();

      if (isShutdownRequested?.()) {
        return;
      }

      let deferredStageStartMs = getStartupProfileNowMs();
      const xcodeState = await readXcodeIdeState({
        executor,
        cwd: result.runtime.cwd,
        searchRoot: workspaceRoot,
        projectPath,
        workspacePath,
      });
      deferredProfiler.mark('readXcodeIdeState', deferredStageStartMs);

      if (isShutdownRequested?.()) {
        return;
      }

      if (xcodeState.error) {
        log('debug', `[xcode] Could not read Xcode IDE state: ${xcodeState.error}`);
      } else {
        const syncedDefaults: Record<string, string> = {};
        if (xcodeState.scheme) {
          syncedDefaults.scheme = xcodeState.scheme;
        }
        if (xcodeState.simulatorId) {
          syncedDefaults.simulatorId = xcodeState.simulatorId;
        }
        if (xcodeState.simulatorName) {
          syncedDefaults.simulatorName = xcodeState.simulatorName;
        }

        if (Object.keys(syncedDefaults).length > 0) {
          const currentDefaults = sessionStore.getAll();
          const selectorChanged =
            (syncedDefaults.simulatorId != null &&
              syncedDefaults.simulatorId !== currentDefaults.simulatorId) ||
            (syncedDefaults.simulatorName != null &&
              syncedDefaults.simulatorName !== currentDefaults.simulatorName);
          if (selectorChanged) {
            // The cached platform belongs to the previous simulator selection.
            sessionStore.clear(['simulatorPlatform']);
          }
          sessionStore.setDefaults(syncedDefaults);
          log(
            'info',
            `[xcode] Synced session defaults from Xcode: ${JSON.stringify(syncedDefaults)}`,
          );
        }

        if (xcodeState.scheme) {
          lookupBundleId(executor, xcodeState.scheme, projectPath, workspacePath)
            .then((bundleId) => {
              if (bundleId) {
                sessionStore.setDefaults({ bundleId });
                log('info', `[xcode] Bundle ID resolved: "${bundleId}"`);
              }
            })
            .catch((e) => {
              log('debug', `[xcode] Failed to lookup bundle ID: ${e}`);
            });
        }
      }

      if (!result.runtime.config.disableXcodeAutoSync) {
        if (isShutdownRequested?.()) {
          return;
        }
        deferredStageStartMs = getStartupProfileNowMs();
        const watcherStarted = await startXcodeStateWatcher({
          executor,
          cwd: result.runtime.cwd,
          searchRoot: workspaceRoot,
          projectPath,
          workspacePath,
        });
        deferredProfiler.mark('startXcodeStateWatcher', deferredStageStartMs);
        if (watcherStarted) {
          log('info', `[xcode] Started file watcher for automatic sync`);
        }
      } else {
        log('info', `[xcode] Automatic Xcode sync disabled via config`);
      }
    },
  };
}

/**
 * Bootstraps the process runtime and immediately applies the registrations to
 * the given server instance.
 *
 * Kept for in-process serving contexts (tests, harnesses) that own a single
 * long-lived instance. The stdio entry uses `bootstrapServerRuntime` plus
 * `applyServerRegistrations` so each connection gets a fresh instance.
 */
export async function bootstrapServer(
  server: McpServer,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const result = await bootstrapServerRuntime(options);
  applyServerRegistrations(server, result.registrations);
  return result;
}
