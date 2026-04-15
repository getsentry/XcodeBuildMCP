import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type {
  SessionDefaultsDomainResult,
  SessionDefaultsProfile,
} from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import {
  persistActiveSessionDefaultsProfile,
  persistSessionDefaultsPatch,
} from '../../../utils/config-store.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
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
import { toErrorMessage } from '../../../utils/errors.ts';

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

function createSessionDefaultsProfile(defaults: SessionDefaults): SessionDefaultsProfile {
  return {
    projectPath: defaults.projectPath ?? null,
    workspacePath: defaults.workspacePath ?? null,
    scheme: defaults.scheme ?? null,
    configuration: defaults.configuration ?? null,
    simulatorName: defaults.simulatorName ?? null,
    simulatorId: defaults.simulatorId ?? null,
    simulatorPlatform: defaults.simulatorPlatform ?? null,
    deviceId: defaults.deviceId ?? null,
    useLatestOS: defaults.useLatestOS ?? null,
    arch: defaults.arch ?? null,
    suppressWarnings: defaults.suppressWarnings ?? null,
    derivedDataPath: defaults.derivedDataPath ?? null,
    preferXcodebuild: defaults.preferXcodebuild ?? null,
    platform: defaults.platform ?? null,
    bundleId: defaults.bundleId ?? null,
    env: defaults.env ?? null,
  };
}

function createSessionDefaultsResult(error?: string): SessionDefaultsDomainResult {
  const profiles: SessionDefaultsDomainResult['profiles'] = {
    '(default)': createSessionDefaultsProfile(sessionStore.getAllForProfile(null)),
  };

  for (const profile of sessionStore.listProfiles()) {
    profiles[profile] = createSessionDefaultsProfile(sessionStore.getAllForProfile(profile));
  }

  return {
    kind: 'session-defaults',
    didError: typeof error === 'string',
    error: error ?? null,
    currentProfile: formatProfileLabel(sessionStore.getActiveProfile()),
    profiles,
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: SessionDefaultsDomainResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.session-defaults',
    schemaVersion: '1',
  };
}

export function createSessionSetDefaultsExecutor(
  context: SessionSetDefaultsContext,
): ToolExecutor<Params, SessionDefaultsDomainResult> {
  return async (params, ctx) => {
    try {
      let activeProfile = sessionStore.getActiveProfile();
      const { persist, profile: rawProfile, createIfNotExists = false, ...rawParams } = params;

      if (rawProfile !== undefined) {
        const profile = rawProfile.trim();
        if (profile.length === 0) {
          return createSessionDefaultsResult('Profile name cannot be empty.');
        }

        const profileExists = sessionStore.listProfiles().includes(profile);
        if (!profileExists && !createIfNotExists) {
          return createSessionDefaultsResult(
            `Profile "${profile}" does not exist. Pass createIfNotExists=true to create it.`,
          );
        }

        sessionStore.setActiveProfile(profile);
        activeProfile = profile;
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
      }

      const toClear = new Set<keyof SessionDefaults>();
      if (hasProjectPath) {
        toClear.add('workspacePath');
      }
      if (hasWorkspacePath) {
        toClear.add('projectPath');
      }

      const selectorProvided = hasSimulatorId || hasSimulatorName;
      const simulatorIdChanged = hasSimulatorId && nextParams.simulatorId !== current.simulatorId;
      const simulatorNameChanged =
        hasSimulatorName && nextParams.simulatorName !== current.simulatorName;

      if (hasSimulatorId && !hasSimulatorName) {
        toClear.add('simulatorName');
      } else if (hasSimulatorName && !hasSimulatorId) {
        toClear.add('simulatorId');
      }

      if (selectorProvided && (simulatorIdChanged || simulatorNameChanged)) {
        toClear.add('simulatorPlatform');
      }

      if (toClear.size > 0) {
        sessionStore.clear(Array.from(toClear));
      }

      if (Object.keys(nextParams).length > 0) {
        sessionStore.setDefaults(nextParams as Partial<SessionDefaults>);
      }

      if (persist) {
        if (Object.keys(nextParams).length > 0 || toClear.size > 0) {
          await persistSessionDefaultsPatch({
            patch: nextParams,
            deleteKeys: Array.from(toClear),
            profile: activeProfile,
          });
        }

        if (rawProfile !== undefined) {
          await persistActiveSessionDefaultsProfile(activeProfile);
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

      return createSessionDefaultsResult();
    } catch (error) {
      return createSessionDefaultsResult(toErrorMessage(error));
    }
  };
}

export async function sessionSetDefaultsLogic(
  params: Params,
  context: SessionSetDefaultsContext,
): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeSessionSetDefaults = createSessionSetDefaultsExecutor(context);
  const result = await executeSessionSetDefaults(params, executionContext);
  const {
    profile: rawProfile,
    persist: _persist,
    createIfNotExists: _createIfNotExists,
    ...rawParams
  } = params;

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (result.didError) {
    ctx.emit(header('Set Defaults'));
    ctx.emit(statusLine('error', result.error ?? 'Failed to update session defaults.'));
    return;
  }

  const updated = sessionStore.getAll();
  const activeProfile = sessionStore.getActiveProfile();

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

  if (rawProfile !== undefined) {
    ctx.emit(section('Notices', [`Activated profile "${rawProfile.trim()}".`]));
  }
}

export const schema = schemaObj.shape;

export const handler = createTypedToolWithContext(schemaObj, sessionSetDefaultsLogic, () => ({
  executor: getDefaultCommandExecutor(),
}));
