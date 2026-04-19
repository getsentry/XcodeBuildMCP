import * as z from 'zod';
import {
  persistActiveSessionDefaultsProfile,
  persistSessionDefaultsPatch,
} from '../../../utils/config-store.ts';
import { removeUndefined } from '../../../utils/remove-undefined.ts';
import { scheduleSimulatorDefaultsRefresh } from '../../../utils/simulator-defaults-refresh.ts';
import { sessionStore, type SessionDefaults } from '../../../utils/session-store.ts';
import {
  sessionDefaultsSchema,
  sessionDefaultKeys,
} from '../../../utils/session-defaults-schema.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';
import {
  formatProfileLabel,
  formatProfileAnnotation,
  buildFullDetailTree,
} from './session-format-helpers.ts';

const schemaObj = sessionDefaultsSchema.extend({
  profile: z
    .string()
    .min(1)
    .optional()
    .describe('Set defaults for this named profile and make it active for the current session.'),
  createIfNotExists: z
    .boolean()
    .optional()
    .default(false)
    .describe('Create the named profile if it does not exist. Defaults to false.'),
  persist: z
    .boolean()
    .optional()
    .describe('Persist provided defaults to .xcodebuildmcp/config.yaml'),
});

type Params = z.input<typeof schemaObj>;

type SessionSetDefaultsContext = {
  executor: CommandExecutor;
};

const PARAM_LABEL_MAP: Record<string, string> = {
  projectPath: 'Project Path',
  workspacePath: 'Workspace Path',
  scheme: 'Scheme',
  configuration: 'Configuration',
  simulatorName: 'Simulator Name',
  simulatorId: 'Simulator ID',
  simulatorPlatform: 'Simulator Platform',
  deviceId: 'Device ID',
  useLatestOS: 'Use Latest OS',
  arch: 'Architecture',
  suppressWarnings: 'Suppress Warnings',
  derivedDataPath: 'Derived Data Path',
  preferXcodebuild: 'Prefer xcodebuild',
  platform: 'Platform',
  bundleId: 'Bundle ID',
  env: 'Environment',
};

export async function sessionSetDefaultsLogic(
  params: Params,
  context: SessionSetDefaultsContext,
): Promise<void> {
  const ctx = getHandlerContext();
  const notices: string[] = [];
  let activeProfile = sessionStore.getActiveProfile();
  const { persist, profile: rawProfile, createIfNotExists = false, ...rawParams } = params;

  if (rawProfile !== undefined) {
    const profile = rawProfile.trim();
    if (profile.length === 0) {
      ctx.emit(header('Set Defaults'));
      ctx.emit(statusLine('error', 'Profile name cannot be empty.'));
      return;
    }

    const profileExists = sessionStore.listProfiles().includes(profile);
    if (!profileExists && !createIfNotExists) {
      ctx.emit(header('Set Defaults'));
      ctx.emit(
        statusLine(
          'error',
          `Profile "${profile}" does not exist. Pass createIfNotExists=true to create it.`,
        ),
      );
      return;
    }

    sessionStore.setActiveProfile(profile);
    activeProfile = profile;
    if (!profileExists) {
      notices.push(`Created and activated profile "${profile}".`);
    } else {
      notices.push(`Activated profile "${profile}".`);
    }
  }

  const current = sessionStore.getAll();
  const nextParams = removeUndefined(
    rawParams as Record<string, unknown>,
  ) as Partial<SessionDefaults>;

  const hasProjectPath = nextParams.projectPath !== undefined;
  const hasWorkspacePath = nextParams.workspacePath !== undefined;
  const hasSimulatorId = nextParams.simulatorId !== undefined;
  const hasSimulatorName = nextParams.simulatorName !== undefined;

  if (hasProjectPath && hasWorkspacePath) {
    delete nextParams.projectPath;
    notices.push(
      'Both projectPath and workspacePath were provided; keeping workspacePath and ignoring projectPath.',
    );
  }

  const toClear = new Set<keyof SessionDefaults>();
  if (hasProjectPath) {
    toClear.add('workspacePath');
    if (current.workspacePath !== undefined) {
      notices.push('Cleared workspacePath because projectPath was set.');
    }
  }
  if (hasWorkspacePath) {
    toClear.add('projectPath');
    if (current.projectPath !== undefined) {
      notices.push('Cleared projectPath because workspacePath was set.');
    }
  }

  const selectorProvided = hasSimulatorId || hasSimulatorName;
  const simulatorIdChanged = hasSimulatorId && nextParams.simulatorId !== current.simulatorId;
  const simulatorNameChanged =
    hasSimulatorName && nextParams.simulatorName !== current.simulatorName;

  if (hasSimulatorId && hasSimulatorName) {
    notices.push(
      'Both simulatorId and simulatorName were provided; simulatorId will be used by tools.',
    );
  } else if (hasSimulatorId && !hasSimulatorName) {
    toClear.add('simulatorName');
    if (current.simulatorName !== undefined) {
      notices.push(
        'Cleared simulatorName because simulatorId was set; background resolution will repopulate it.',
      );
    }
    if (simulatorIdChanged) {
      notices.push(
        `Set simulatorId to "${nextParams.simulatorId}". Simulator name and platform refresh scheduled in background.`,
      );
    }
  } else if (hasSimulatorName && !hasSimulatorId) {
    toClear.add('simulatorId');
    if (current.simulatorId !== undefined) {
      notices.push(
        'Cleared simulatorId because simulatorName was set; background resolution will repopulate it.',
      );
    }
    if (simulatorNameChanged) {
      notices.push(
        `Set simulatorName to "${nextParams.simulatorName}". Simulator ID and platform refresh scheduled in background.`,
      );
    }
  }

  if (selectorProvided) {
    const selectorChanged = simulatorIdChanged || simulatorNameChanged;
    if (selectorChanged) {
      toClear.add('simulatorPlatform');
      notices.push('Cleared simulatorPlatform because simulator selector changed.');
    }
  }

  if (toClear.size > 0) {
    sessionStore.clear(Array.from(toClear));
  }

  if (Object.keys(nextParams).length > 0) {
    sessionStore.setDefaults(nextParams as Partial<SessionDefaults>);
  }

  if (persist) {
    if (Object.keys(nextParams).length === 0 && toClear.size === 0) {
      notices.push('No defaults provided to persist.');
    } else {
      const { path } = await persistSessionDefaultsPatch({
        patch: nextParams,
        deleteKeys: Array.from(toClear),
        profile: activeProfile,
      });
      notices.push(`Persisted defaults to ${path}`);
    }

    if (rawProfile !== undefined) {
      const { path } = await persistActiveSessionDefaultsProfile(activeProfile);
      notices.push(`Persisted active profile selection to ${path}`);
    }
  }

  const revision = sessionStore.getRevision();
  if (selectorProvided) {
    const defaultsForRefresh = sessionStore.getAll();
    scheduleSimulatorDefaultsRefresh({
      executor: context.executor,
      expectedRevision: revision,
      reason: 'session-set-defaults',
      profile: activeProfile,
      persist: Boolean(persist),
      simulatorId: defaultsForRefresh.simulatorId,
      simulatorName: defaultsForRefresh.simulatorName,
      recomputePlatform: true,
    });
  }

  const updated = sessionStore.getAll();

  const headerParams: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(rawParams)) {
    if (value !== undefined) {
      const label = PARAM_LABEL_MAP[key] ?? key;
      headerParams.push({ label, value: String(value) });
    }
  }
  headerParams.push({ label: 'Profile', value: formatProfileLabel(activeProfile) });

  const profileAnnotation = formatProfileAnnotation(activeProfile);
  ctx.emit(header('Set Defaults', headerParams));
  ctx.emit(statusLine('success', `Session defaults updated ${profileAnnotation}`));
  ctx.emit(detailTree(buildFullDetailTree(updated)));

  if (notices.length > 0) {
    ctx.emit(section('Notices', notices));
  }
}

export const schema = schemaObj.shape;

export const handler = createTypedToolWithContext(schemaObj, sessionSetDefaultsLogic, () => ({
  executor: getDefaultCommandExecutor(),
}));
