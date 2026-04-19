import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { DependencyError, AxeError, SystemError } from '../../../utils/errors.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import type { DebuggerManager } from '../../../utils/debugger/debugger-manager.ts';
import { guardUiAutomationAgainstStoppedDebugger } from '../../../utils/debugger/ui-automation-guard.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../utils/axe-helpers.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { recordSnapshotUiCall } from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const snapshotUiSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
});

type SnapshotUiParams = z.infer<typeof snapshotUiSchema>;

const LOG_PREFIX = '[AXe]';

export async function snapshot_uiLogic(
  params: SnapshotUiParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const toolName = 'snapshot_ui';
  const { simulatorId } = params;
  const commandArgs = ['describe-ui'];

  const headerEvent = header('Snapshot UI', [{ label: 'Simulator', value: simulatorId }]);

  const ctx = getHandlerContext();

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', guard.blockedMessage));
    return;
  }

  log('info', `${LOG_PREFIX}/${toolName}: Starting for ${simulatorId}`);

  return withErrorHandling(
    ctx,
    async () => {
      const responseText = await executeAxeCommand(
        commandArgs,
        simulatorId,
        'describe-ui',
        executor,
        axeHelpers,
      );

      recordSnapshotUiCall(simulatorId);

      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Accessibility hierarchy retrieved successfully.'));
      ctx.emit(section('Accessibility Hierarchy', ['```json', responseText, '```']));
      ctx.emit(
        section('Tips', [
          '- Use frame coordinates for tap/swipe (center: x+width/2, y+height/2)',
          '- If a debugger is attached, ensure the app is running (not stopped on breakpoints)',
          '- Screenshots are for visual verification only',
        ]),
      );
      if (guard.warningText) {
        ctx.emit(statusLine('warning', guard.warningText));
      }
      ctx.nextStepParams = {
        snapshot_ui: { simulatorId },
        tap: { simulatorId, x: 0, y: 0 },
        screenshot: { simulatorId },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `An unexpected error occurred: ${message}`,
      logMessage: ({ error }) => `${LOG_PREFIX}/${toolName}: Failed - ${error}`,
      mapError: ({ error, headerEvent: hdr, emit }) => {
        if (error instanceof DependencyError) {
          emit?.(hdr);
          emit?.(statusLine('error', AXE_NOT_AVAILABLE_MESSAGE));
          return;
        } else if (error instanceof AxeError) {
          emit?.(hdr);
          emit?.(statusLine('error', `Failed to get accessibility hierarchy: ${error.message}`));
          if (error.axeOutput) emit?.(section('Details', [error.axeOutput]));
          return;
        } else if (error instanceof SystemError) {
          emit?.(hdr);
          emit?.(statusLine('error', `System error executing axe: ${error.message}`));
          if (error.originalError?.stack)
            emit?.(section('Stack Trace', [error.originalError.stack]));
          return;
        }
        return undefined;
      },
    },
  );
}

const publicSchemaObject = z.strictObject(
  snapshotUiSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: snapshotUiSchema,
});

export const handler = createSessionAwareTool<SnapshotUiParams>({
  internalSchema: snapshotUiSchema as unknown as z.ZodType<SnapshotUiParams, unknown>,
  logicFunction: (params: SnapshotUiParams, executor: CommandExecutor) =>
    snapshot_uiLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
