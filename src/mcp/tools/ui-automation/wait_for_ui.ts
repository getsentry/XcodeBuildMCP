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
import type { CaptureResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type {
  RuntimeElementRoleV1,
  RuntimeElementV1,
  RuntimeSnapshotRecord,
  UiWaitMatch,
} from '../../../types/ui-snapshot.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import {
  recordRuntimeSnapshot,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import {
  parseRuntimeSnapshotResponse,
  RuntimeSnapshotParseError,
} from './shared/runtime-snapshot.ts';
import {
  createCaptureFailureResult,
  createCaptureSuccessResult,
  mapAxeCommandError,
  setCaptureStructuredOutput,
} from './shared/domain-result.ts';
import {
  createWaitTimeoutError,
  evaluateElementPredicate,
  evaluateSettledPredicate,
  evaluateTextContainsPredicate,
  hasSelectorFields,
  resolveElementSelector,
  selectorFromParams,
  waitPredicates,
} from './shared/wait-predicate.ts';
import type { ResolvedWaitSelector, SettledTracker } from './shared/wait-predicate.ts';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_SETTLED_DURATION_MS = 500;
const LOG_PREFIX = '[AXe]';

const waitForUiSchemaShape = {
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  predicate: z.enum(waitPredicates),
  elementRef: z.string().min(1, { message: 'elementRef must be non-empty' }).optional(),
  identifier: z.string().min(1, { message: 'identifier must be non-empty' }).optional(),
  label: z.string().min(1, { message: 'label must be non-empty' }).optional(),
  role: z
    .enum([
      'application',
      'button',
      'cell',
      'image',
      'keyboard-key',
      'list',
      'menu',
      'other',
      'scroll-view',
      'slider',
      'switch',
      'tab',
      'text',
      'text-field',
      'window',
    ] satisfies RuntimeElementRoleV1[])
    .optional(),
  value: z.string().min(1, { message: 'value must be non-empty' }).optional(),
  text: z
    .string()
    .min(1, { message: 'text must be non-empty' })
    .refine((value) => value.replace(/\s+/g, ' ').trim().length > 0, {
      message: 'text must contain non-whitespace characters',
    })
    .optional(),
  timeoutMs: z
    .number()
    .int({ message: 'timeoutMs must be an integer number of milliseconds' })
    .min(0, { message: 'timeoutMs must be non-negative' })
    .optional()
    .describe('milliseconds'),
  pollIntervalMs: z
    .number()
    .int({ message: 'pollIntervalMs must be an integer number of milliseconds' })
    .min(1, { message: 'pollIntervalMs must be at least 1 millisecond' })
    .optional()
    .describe('milliseconds'),
  settledDurationMs: z
    .number()
    .int({ message: 'settledDurationMs must be an integer number of milliseconds' })
    .min(0, { message: 'settledDurationMs must be non-negative' })
    .optional()
    .describe('milliseconds'),
};

const waitForUiSchema = z.strictObject(waitForUiSchemaShape).superRefine((value, ctx) => {
  if (
    value.predicate !== 'settled' &&
    value.predicate !== 'textContains' &&
    !(value.predicate === 'gone' && value.text !== undefined) &&
    !hasSelectorFields(value)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['elementRef'],
      message: `${value.predicate} waits require at least one selector field`,
    });
  }

  if (value.predicate === 'textContains' && value.text === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['text'],
      message: 'textContains waits require text',
    });
  }

  if (
    value.predicate !== 'textContains' &&
    value.predicate !== 'gone' &&
    value.text !== undefined
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['text'],
      message: 'text is only supported for textContains and gone waits',
    });
  }
});

type WaitForUiParams = z.infer<typeof waitForUiSchema>;
type WaitForUiResult = CaptureResultDomainResult;

interface WaitTiming {
  now: () => number;
  sleep: (durationMs: number) => Promise<void>;
}

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

type WaitPredicateEvaluation =
  | ReturnType<typeof evaluateSettledPredicate>
  | ReturnType<typeof evaluateTextContainsPredicate>
  | ReturnType<typeof evaluateElementPredicate>;

function createWaitMatch(
  predicate: WaitForUiParams['predicate'],
  matches: RuntimeElementV1[] | undefined,
): UiWaitMatch | undefined {
  if (predicate === 'settled' || matches === undefined) {
    return undefined;
  }
  return { predicate, matches };
}

function evaluateWaitPredicate(args: {
  predicate: WaitForUiParams['predicate'];
  selector: ResolvedWaitSelector | null;
  snapshot: RuntimeSnapshotRecord;
  text?: string;
  nowMs: number;
  settledDurationMs: number;
  settledTracker: SettledTracker;
}): WaitPredicateEvaluation {
  const { predicate, selector, snapshot, text, nowMs, settledDurationMs, settledTracker } = args;

  if (predicate === 'settled') {
    return evaluateSettledPredicate({
      snapshot,
      nowMs,
      settledDurationMs,
      tracker: settledTracker,
    });
  }

  if (predicate === 'textContains' && !selector) {
    return evaluateTextContainsPredicate({ snapshot, text: text! });
  }

  if (predicate === 'gone' && !selector && text) {
    const textMatch = evaluateTextContainsPredicate({ snapshot, text });
    return {
      matched: (textMatch.candidates ?? []).length === 0,
      candidates: textMatch.candidates ?? [],
      uiError: textMatch.uiError,
    };
  }

  return evaluateElementPredicate({ predicate, selector: selector!, snapshot, text });
}

export function createWaitForUiExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
  timing: WaitTiming = { now: Date.now, sleep: defaultSleep },
): NonStreamingExecutor<WaitForUiParams, WaitForUiResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'wait_for_ui';
      const { simulatorId, predicate, elementRef, text } = params;
      const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const settledDurationMs = params.settledDurationMs ?? DEFAULT_SETTLED_DURATION_MS;
      const startedAtMs = timing.now();
      const deadlineMs = startedAtMs + timeoutMs;
      let selector: ResolvedWaitSelector | null = null;
      if (predicate !== 'settled') {
        if (elementRef) {
          const selectorResolution = resolveElementSelector(simulatorId, elementRef, startedAtMs);
          if (!selectorResolution.ok) {
            return createCaptureFailureResult(simulatorId, selectorResolution.error.message, {
              uiError: selectorResolution.error,
            });
          }
          selector = selectorResolution.selector;
        } else {
          selector = selectorFromParams(params);
        }
      }

      if (predicate === 'textContains' && text === undefined) {
        const message = 'textContains waits require text.';
        return createCaptureFailureResult(simulatorId, message, {
          uiError: {
            code: 'TARGET_NOT_FOUND',
            message,
            recoveryHint: 'Provide text for textContains waits.',
          },
        });
      }

      if (predicate !== 'settled' && predicate !== 'textContains' && !selector && !text) {
        const message = `${predicate} waits require at least one selector field.`;
        return createCaptureFailureResult(simulatorId, message, {
          uiError: {
            code: 'TARGET_NOT_FOUND',
            message,
            recoveryHint:
              'Provide elementRef, identifier, label, role, or value, or use settled for selector-free waits.',
          },
        });
      }

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

      let latestSnapshot: RuntimeSnapshotRecord | null = null;
      let latestCandidates: RuntimeElementV1[] = [];
      let lastParseError: RuntimeSnapshotParseError | null = null;
      let lastPollError: string | null = null;
      const settledTracker: SettledTracker = { signature: null, stableSinceMs: null };

      log('info', `${LOG_PREFIX}/${toolName}: Waiting for ${predicate} on ${simulatorId}`);

      while (true) {
        try {
          const responseText = await executeAxeCommand(
            ['describe-ui'],
            simulatorId,
            'describe-ui',
            executor,
            axeHelpers,
          );
          const nowMs = timing.now();
          const snapshot = parseRuntimeSnapshotResponse({
            simulatorId,
            responseText,
            nowMs,
            allowEmpty: true,
          });
          latestSnapshot = snapshot;
          lastParseError = null;
          lastPollError = null;
          recordRuntimeSnapshot(snapshot);

          const matched = evaluateWaitPredicate({
            predicate,
            selector,
            snapshot,
            text,
            nowMs,
            settledDurationMs,
            settledTracker,
          });

          if (typeof matched === 'boolean') {
            if (matched) {
              return createCaptureSuccessResult(simulatorId, {
                capture: snapshot.payload,
                warnings: [guard.warningText],
              });
            }
          } else {
            latestCandidates = matched.candidates ?? [];
            if (matched.uiError) {
              return createCaptureFailureResult(simulatorId, matched.uiError.message, {
                warnings: [guard.warningText],
                uiError: matched.uiError,
                capture: snapshot.payload,
              });
            }
            if (matched.matched) {
              return createCaptureSuccessResult(simulatorId, {
                capture: snapshot.payload,
                warnings: [guard.warningText],
                waitMatch: createWaitMatch(predicate, matched.candidates),
              });
            }
          }
        } catch (error) {
          if (error instanceof RuntimeSnapshotParseError) {
            lastParseError = error;
            lastPollError = null;
          } else {
            const failure = mapAxeCommandError(error, {
              axeFailureMessage: () => 'Failed to poll runtime UI snapshot.',
            });
            lastPollError = failure.message;
            lastParseError = null;
          }
        }

        const nowMs = timing.now();
        if (nowMs >= deadlineMs) {
          break;
        }

        await timing.sleep(Math.min(pollIntervalMs, deadlineMs - nowMs));
      }

      if (latestSnapshot) {
        const uiError = createWaitTimeoutError({
          predicate,
          timeoutMs,
          selector: selector ?? undefined,
          candidates: latestCandidates,
        });
        return createCaptureFailureResult(simulatorId, uiError.message, {
          warnings: [guard.warningText],
          uiError,
          capture: latestSnapshot.payload,
        });
      }

      if (lastParseError) {
        const message = 'Failed to parse runtime UI snapshot while waiting for UI.';
        return createCaptureFailureResult(simulatorId, message, {
          details: [lastParseError.message],
          uiError: {
            code: 'SNAPSHOT_PARSE_FAILED',
            message,
            recoveryHint: 'Retry after the app is fully launched and responsive.',
          },
        });
      }

      const message =
        lastPollError ?? `Timed out after ${timeoutMs}ms waiting for UI predicate '${predicate}'.`;
      return createCaptureFailureResult(simulatorId, message, {
        uiError: {
          code: lastPollError ? 'ACTION_FAILED' : 'WAIT_TIMEOUT',
          message,
          recoveryHint: 'Retry after the app is fully launched and responsive.',
          ...(lastPollError ? {} : { timeoutMs }),
        },
      });
    });
}

export async function wait_for_uiLogic(
  params: WaitForUiParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
  timing?: WaitTiming,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeWaitForUi = createWaitForUiExecutor(executor, axeHelpers, debuggerManager, timing);
  const result = await executeWaitForUi(params);

  setCaptureStructuredOutput(ctx, result, { headerTitle: 'Wait for UI' });

  if (!result.didError) {
    ctx.nextStepParams = {
      snapshot_ui: { simulatorId: params.simulatorId },
      wait_for_ui: { simulatorId: params.simulatorId, predicate: 'settled' },
    };
  }
}

const publicSchemaObject = z.strictObject(
  z.object(waitForUiSchemaShape).omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: waitForUiSchema,
});

export const handler = createSessionAwareTool<WaitForUiParams>({
  internalSchema: toInternalSchema<WaitForUiParams>(waitForUiSchema),
  logicFunction: (params: WaitForUiParams, executor: CommandExecutor) =>
    wait_for_uiLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
