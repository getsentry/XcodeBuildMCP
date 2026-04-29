import { persistSessionDefaultsPatch } from './config-store.ts';
import { getDefaultCommandExecutor, type CommandExecutor } from './execution/index.ts';
import { inferPlatform } from './infer-platform.ts';
import { log } from './logger.ts';
import { resolveSimulatorIdToName, resolveSimulatorNameToId } from './simulator-resolver.ts';
import { sessionStore, type SessionDefaults } from './session-store.ts';

type RefreshReason = 'startup-hydration' | 'session-set-defaults';

export interface ScheduleSimulatorDefaultsRefreshOptions {
  executor?: CommandExecutor;
  expectedRevision: number;
  reason: RefreshReason;
  profile: string | null;
  persist?: boolean;
  simulatorId?: string;
  simulatorName?: string;
  recomputePlatform?: boolean;
}

function shouldSkipBackgroundRefresh(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

export function scheduleSimulatorDefaultsRefresh(
  options: ScheduleSimulatorDefaultsRefreshOptions,
): boolean {
  const hasSelector = options.simulatorId != null || options.simulatorName != null;
  if (!hasSelector) {
    return false;
  }

  if (shouldSkipBackgroundRefresh()) {
    return false;
  }

  setTimeout(() => {
    void refreshSimulatorDefaults(options);
  }, 0);

  return true;
}

async function refreshSimulatorDefaults(
  options: ScheduleSimulatorDefaultsRefreshOptions,
): Promise<void> {
  let simulatorId = options.simulatorId;
  let simulatorName = options.simulatorName;
  const patch: Partial<SessionDefaults> = {};
  const executor = options.executor ?? getDefaultCommandExecutor();

  try {
    if (simulatorName) {
      const resolution = await resolveSimulatorNameToId(executor, simulatorName);
      if (resolution.success && resolution.simulatorId !== simulatorId) {
        simulatorId = resolution.simulatorId;
        patch.simulatorId = resolution.simulatorId;
      }
    } else if (simulatorId) {
      const resolution = await resolveSimulatorIdToName(executor, simulatorId);
      if (resolution.success) {
        simulatorName = resolution.simulatorName;
        patch.simulatorName = resolution.simulatorName;
      }
    }

    const shouldRecomputePlatform = options.recomputePlatform ?? true;
    if (shouldRecomputePlatform && (simulatorId || simulatorName)) {
      const inferred = await inferPlatform(
        {
          simulatorId,
          simulatorName,
          sessionDefaults: {
            ...sessionStore.getAllForProfile(options.profile),
            ...patch,
            simulatorId,
            simulatorName,
            simulatorPlatform: undefined,
          },
        },
        executor,
      );

      if (inferred.source !== 'default') {
        patch.simulatorPlatform = inferred.platform;
      }
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    const applied = sessionStore.setDefaultsIfRevisionForProfile(
      options.profile,
      patch,
      options.expectedRevision,
    );
    if (!applied) {
      log(
        'info',
        `[Session] Skipped background simulator defaults refresh (${options.reason}) because defaults changed during refresh.`,
      );
      return;
    }

    if (options.persist) {
      await persistSessionDefaultsPatch({ patch, profile: options.profile });
    }
  } catch (error) {
    log(
      'warn',
      `[Session] Background simulator defaults refresh failed (${options.reason}): ${String(error)}`,
    );
  }
}
