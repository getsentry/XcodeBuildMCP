import * as z from 'zod';
import { sessionStore } from '../../../utils/session-store.ts';
import { header, section } from '../../../utils/tool-event-builders.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  formatProfileLabel,
  buildFullDetailTree,
  formatDetailLines,
} from './session-format-helpers.ts';

const schemaObject = z.object({});

export async function sessionShowDefaultsLogic(): Promise<void> {
  const ctx = getHandlerContext();
  const namedProfiles = sessionStore.listProfiles();
  const profileKeys: Array<string | null> = [null, ...namedProfiles];

  ctx.emit(header('Show Defaults'));

  for (const profileKey of profileKeys) {
    const defaults = sessionStore.getAllForProfile(profileKey);
    const label = `\u{1F4C1} ${formatProfileLabel(profileKey)}`;
    const items = buildFullDetailTree(defaults);
    ctx.emit(section(label, formatDetailLines(items)));
  }
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  () => sessionShowDefaultsLogic(),
  () => undefined,
);
