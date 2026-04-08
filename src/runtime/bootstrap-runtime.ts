import process from 'node:process';
import {
  initConfigStore,
  getConfig,
  type RuntimeConfigOverrides,
  type ResolvedRuntimeConfig,
} from '../utils/config-store.ts';
import { sessionStore, type SessionDefaults } from '../utils/session-store.ts';
import { getDefaultFileSystemExecutor } from '../utils/command.ts';
import { log } from '../utils/logger.ts';
import type { FileSystemExecutor } from '../utils/FileSystemExecutor.ts';
import { scheduleSimulatorDefaultsRefresh } from '../utils/simulator-defaults-refresh.ts';

export type RuntimeKind = 'cli' | 'daemon' | 'mcp';

export interface BootstrapRuntimeOptions {
  runtime: RuntimeKind;
  cwd?: string;
  fs?: FileSystemExecutor;
  configOverrides?: RuntimeConfigOverrides;
}

export interface BootstrappedRuntime {
  runtime: RuntimeKind;
  cwd: string;
  config: ResolvedRuntimeConfig;
}

export interface BootstrapRuntimeResult {
  runtime: BootstrappedRuntime;
  configFound: boolean;
  configPath?: string;
  notices: string[];
}

interface MCPSessionHydrationResult {
  hydrated: boolean;
  refreshScheduled: boolean;
}

/**
 * Hydrates MCP session defaults and reports whether a background simulator refresh was scheduled.
 */
function hydrateSessionDefaultsForMcp(
  defaults: Partial<SessionDefaults> | undefined,
  profiles: Record<string, Partial<SessionDefaults>> | undefined,
  activeProfile: string | undefined,
): MCPSessionHydrationResult {
  const hydratedDefaults = { ...(defaults ?? {}) };
  const hydratedProfiles = profiles ?? {};
  const hasHydratedDefaults = Object.keys(hydratedDefaults).length > 0;
  const hydratedProfileEntries = Object.entries(hydratedProfiles);
  if (!hasHydratedDefaults && hydratedProfileEntries.length === 0) {
    return { hydrated: false, refreshScheduled: false };
  }

  if (hasHydratedDefaults) {
    sessionStore.setDefaultsForProfile(null, hydratedDefaults);
  }
  for (const [profileName, profileDefaults] of hydratedProfileEntries) {
    const trimmedName = profileName.trim();
    if (!trimmedName) continue;
    sessionStore.setDefaultsForProfile(trimmedName, profileDefaults);
  }
  const normalizedActiveProfile = activeProfile?.trim();
  if (normalizedActiveProfile) {
    sessionStore.setActiveProfile(normalizedActiveProfile);
  }

  const activeDefaults = sessionStore.getAll();
  const revision = sessionStore.getRevision();
  const refreshScheduled = scheduleSimulatorDefaultsRefresh({
    expectedRevision: revision,
    reason: 'startup-hydration',
    profile: sessionStore.getActiveProfile(),
    persist: false,
    simulatorId: activeDefaults.simulatorId,
    simulatorName: activeDefaults.simulatorName,
    recomputePlatform: true,
  });

  return { hydrated: true, refreshScheduled };
}

function logHydrationResult(hydration: MCPSessionHydrationResult): void {
  if (!hydration.hydrated) {
    return;
  }

  const refreshStatus = hydration.refreshScheduled ? 'scheduled' : 'not scheduled';
  log(
    'info',
    `[Session] Hydrated MCP session defaults; simulator metadata refresh ${refreshStatus}.`,
  );
}

export async function bootstrapRuntime(
  opts: BootstrapRuntimeOptions,
): Promise<BootstrapRuntimeResult> {
  process.env.XCODEBUILDMCP_RUNTIME = opts.runtime;
  const cwd = opts.cwd ?? process.cwd();
  const fs = opts.fs ?? getDefaultFileSystemExecutor();

  const configResult = await initConfigStore({
    cwd,
    fs,
    overrides: opts.configOverrides,
  });

  if (configResult.found) {
    log('info', `Loaded project config from ${configResult.path} (cwd: ${cwd})`);
  } else {
    log('info', `No project config found (cwd: ${cwd}).`);
  }

  const config = getConfig();

  if (opts.runtime === 'mcp') {
    const hydration = hydrateSessionDefaultsForMcp(
      config.sessionDefaults,
      config.sessionDefaultsProfiles,
      config.activeSessionDefaultsProfile,
    );
    logHydrationResult(hydration);
  }

  return {
    runtime: {
      runtime: opts.runtime,
      cwd,
      config,
    },
    configFound: configResult.found,
    configPath: configResult.path,
    notices: configResult.notices,
  };
}
