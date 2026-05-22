import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import type { DebuggerManager } from '../../../utils/debugger/debugger-manager.ts';
import { guardUiAutomationAgainstStoppedDebugger } from '../../../utils/debugger/ui-automation-guard.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import {
  getRuntimeSnapshot,
  recordRuntimeSnapshot,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { CaptureResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type { RuntimeSnapshotV1 } from '../../../types/ui-snapshot.ts';
import { createRuntimeSnapshotNextSteps } from './shared/runtime-next-steps.ts';
import {
  createCaptureFailureResult,
  createCaptureSuccessResult,
  mapAxeCommandError,
  setCaptureStructuredOutput,
} from './shared/domain-result.ts';
import {
  parseRuntimeSnapshotResponse,
  RuntimeSnapshotParseError,
} from './shared/runtime-snapshot.ts';

const snapshotUiSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  sinceScreenHash: z
    .string()
    .min(1, 'sinceScreenHash must not be empty')
    .optional()
    .describe('Return an unchanged response when the current screen hash matches this value'),
});

type SnapshotUiParams = z.infer<typeof snapshotUiSchema>;
type SnapshotUiResult = CaptureResultDomainResult;

const LOG_PREFIX = '[AXe]';

export function createSnapshotUiExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<SnapshotUiParams, SnapshotUiResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'snapshot_ui';
      const { simulatorId } = params;
      const commandArgs = ['describe-ui'];

      const guard = await guardUiAutomationAgainstStoppedDebugger({
        debugger: debuggerManager,
        simulatorId,
        toolName,
      });
      if (guard.blockedMessage) {
        return createCaptureFailureResult(simulatorId, guard.blockedMessage, {
          uiError: {
            code: 'ACTION_FAILED',
            message: guard.blockedMessage,
            recoveryHint:
              'Resume execution with debug_continue, remove breakpoints, or detach with debug_detach before retrying UI automation.',
          },
        });
      }

      log('info', `${LOG_PREFIX}/${toolName}: Starting for ${simulatorId}`);

      try {
        const responseText = await executeAxeCommand(
          commandArgs,
          simulatorId,
          'describe-ui',
          executor,
          axeHelpers,
        );

        const snapshot = parseRuntimeSnapshotResponse({
          simulatorId,
          responseText,
          allowEmpty: true,
        });
        recordRuntimeSnapshot(snapshot);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

        if (params.sinceScreenHash === snapshot.screenHash) {
          return createCaptureSuccessResult(simulatorId, {
            capture: {
              type: 'runtime-snapshot-unchanged',
              protocol: 'rs/1',
              simulatorId,
              screenHash: snapshot.screenHash,
              seq: snapshot.seq,
            },
            warnings: [guard.warningText],
          });
        }

        return createCaptureSuccessResult(simulatorId, {
          capture: snapshot.payload,
          warnings: [guard.warningText],
        });
      } catch (error) {
        if (error instanceof RuntimeSnapshotParseError) {
          const message = 'Failed to parse runtime UI snapshot.';
          log('error', `${LOG_PREFIX}/${toolName}: Failed - ${message}`);
          return createCaptureFailureResult(simulatorId, message, {
            details: [error.message],
            uiError: {
              code: 'SNAPSHOT_PARSE_FAILED',
              message,
              recoveryHint: 'Run snapshot_ui again after the app is fully launched and responsive.',
            },
          });
        }

        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => 'Failed to get accessibility hierarchy.',
        });
        log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
        return createCaptureFailureResult(simulatorId, failure.message, {
          details: failure.diagnostics?.errors.map((entry) => entry.message),
        });
      }
    });
}

export async function snapshot_uiLogic(
  params: SnapshotUiParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeSnapshotUi = createSnapshotUiExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeSnapshotUi(params);

  setCaptureStructuredOutput(ctx, result);

  if (!result.didError && result.capture && 'type' in result.capture) {
    let runtimeSnapshot: RuntimeSnapshotV1 | undefined;
    if (result.capture.type === 'runtime-snapshot') {
      runtimeSnapshot = result.capture;
    } else if (result.capture.type === 'runtime-snapshot-unchanged') {
      const currentRuntimeSnapshot = getRuntimeSnapshot(params.simulatorId);
      if (
        currentRuntimeSnapshot?.payload.seq === result.capture.seq &&
        currentRuntimeSnapshot.screenHash === result.capture.screenHash
      ) {
        runtimeSnapshot = currentRuntimeSnapshot.payload;
      }
    }

    if (runtimeSnapshot) {
      ctx.nextSteps = createRuntimeSnapshotNextSteps({
        simulatorId: params.simulatorId,
        runtimeSnapshot,
        includeRefreshAndWait: true,
      });
    }
  }
}

const publicSchemaObject = z.strictObject(
  snapshotUiSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: snapshotUiSchema,
});

export const handler = createSessionAwareTool<SnapshotUiParams>({
  internalSchema: toInternalSchema<SnapshotUiParams>(snapshotUiSchema),
  logicFunction: (params: SnapshotUiParams, executor: CommandExecutor) =>
    snapshot_uiLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
