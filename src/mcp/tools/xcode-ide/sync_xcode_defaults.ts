import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { sessionStore } from '../../../utils/session-store.ts';
import { readXcodeIdeState } from '../../../utils/xcode-state-reader.ts';
import { lookupBundleId } from '../../../utils/xcode-state-watcher.ts';
import * as z from 'zod';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';
import { formatProfileAnnotation } from '../session-management/session-format-helpers.ts';

const schemaObj = z.object({});

type Params = z.infer<typeof schemaObj>;

interface SyncXcodeDefaultsContext {
  executor: CommandExecutor;
  cwd: string;
  projectPath?: string;
  workspacePath?: string;
}

export async function syncXcodeDefaultsLogic(
  _params: Params,
  ctx: SyncXcodeDefaultsContext,
): Promise<void> {
  const handlerContext = getHandlerContext();
  const headerEvent = header('Sync Xcode Defaults');

  const xcodeState = await readXcodeIdeState({
    executor: ctx.executor,
    cwd: ctx.cwd,
    projectPath: ctx.projectPath,
    workspacePath: ctx.workspacePath,
  });

  if (xcodeState.error) {
    handlerContext.emit(headerEvent);
    handlerContext.emit(statusLine('error', `Failed to read Xcode IDE state: ${xcodeState.error}`));
    return;
  }

  const synced: Record<string, string> = {};

  if (xcodeState.scheme) {
    synced.scheme = xcodeState.scheme;
  }

  if (xcodeState.simulatorId) {
    synced.simulatorId = xcodeState.simulatorId;
  }

  if (xcodeState.simulatorName) {
    synced.simulatorName = xcodeState.simulatorName;
  }

  if (xcodeState.scheme) {
    const bundleId = await lookupBundleId(
      ctx.executor,
      xcodeState.scheme,
      ctx.projectPath,
      ctx.workspacePath,
    );
    if (bundleId) {
      synced.bundleId = bundleId;
    }
  }

  if (Object.keys(synced).length === 0) {
    handlerContext.emit(headerEvent);
    handlerContext.emit(
      statusLine('info', 'No scheme or simulator selection detected in Xcode IDE state.'),
    );
    return;
  }

  sessionStore.setDefaults(synced);

  const activeProfile = sessionStore.getActiveProfile();
  const profileAnnotation = formatProfileAnnotation(activeProfile);
  const items = Object.entries(synced).map(([k, v]) => ({ label: k, value: v }));

  handlerContext.emit(headerEvent);
  handlerContext.emit(
    statusLine('success', `Synced session defaults from Xcode IDE ${profileAnnotation}`),
  );
  handlerContext.emit(detailTree(items));
}

export const schema = schemaObj.shape;

export const handler = createTypedToolWithContext(schemaObj, syncXcodeDefaultsLogic, () => {
  const { projectPath, workspacePath } = sessionStore.getAll();
  return {
    executor: getDefaultCommandExecutor(),
    cwd: process.cwd(),
    projectPath,
    workspacePath,
  };
});
