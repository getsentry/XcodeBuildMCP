import * as z from 'zod';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { persistActiveSessionDefaultsProfile } from '../../../utils/config-store.ts';
import { sessionStore } from '../../../utils/session-store.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { formatProfileLabel, formatProfileAnnotation } from './session-format-helpers.ts';

const schemaObj = z.object({
  profile: z
    .string()
    .min(1)
    .optional()
    .describe('Activate a named session defaults profile (example: ios or watch).'),
  global: z.boolean().optional().describe('Activate the global unnamed defaults profile.'),
  persist: z
    .boolean()
    .optional()
    .describe('Persist activeSessionDefaultsProfile to .xcodebuildmcp/config.yaml.'),
});

type Params = z.input<typeof schemaObj>;

function resolveProfileToActivate(params: Params): string | null | undefined {
  if (params.global === true) return null;
  if (params.profile === undefined) return undefined;
  return params.profile.trim();
}

export async function sessionUseDefaultsProfileLogic(params: Params): Promise<void> {
  const ctx = getHandlerContext();
  const notices: string[] = [];
  const errorHeader = header('Use Defaults Profile');

  if (params.global === true && params.profile !== undefined) {
    ctx.emit(errorHeader);
    ctx.emit(statusLine('error', 'Provide either global=true or profile, not both.'));
    return;
  }

  const beforeProfile = sessionStore.getActiveProfile();
  const profileToActivate = resolveProfileToActivate(params);

  if (typeof profileToActivate === 'string') {
    if (profileToActivate.length === 0) {
      ctx.emit(errorHeader);
      ctx.emit(statusLine('error', 'Profile name cannot be empty.'));
      return;
    }
    if (!sessionStore.listProfiles().includes(profileToActivate)) {
      ctx.emit(errorHeader);
      ctx.emit(statusLine('error', `Profile "${profileToActivate}" does not exist.`));
      return;
    }
  }

  if (profileToActivate !== undefined) {
    sessionStore.setActiveProfile(profileToActivate);
  }

  const active = sessionStore.getActiveProfile();
  if (params.persist) {
    const { path } = await persistActiveSessionDefaultsProfile(active);
    notices.push(`Persisted active profile selection to ${path}`);
  }

  ctx.emit(
    header('Use Defaults Profile', [
      { label: 'Current profile', value: formatProfileLabel(beforeProfile) },
    ]),
  );

  if (notices.length > 0) {
    ctx.emit(section('Notices', notices));
  }

  const profileAnnotation = formatProfileAnnotation(active);
  ctx.emit(statusLine('success', `Activated profile ${profileAnnotation}`));
}

export const schema = schemaObj.shape;

export const handler = createTypedTool(
  schemaObj,
  sessionUseDefaultsProfileLogic,
  getDefaultCommandExecutor,
);
