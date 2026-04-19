import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { determineSimulatorUuid } from '../../../utils/simulator-utils.ts';
import {
  createSessionAwareToolWithContext,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  resolveSimulatorAppPid,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const baseSchemaObject = z.object({
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator to use (obtained from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  bundleId: z.string().optional(),
  pid: z.number().int().positive().optional(),
  waitFor: z.boolean().optional().describe('Wait for the process to appear when attaching'),
  continueOnAttach: z.boolean().optional().default(true).describe('default: true'),
  makeCurrent: z
    .boolean()
    .optional()
    .default(true)
    .describe('Set debug session as current (default: true)'),
});

const debugAttachSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.simulatorId !== undefined || val.simulatorName !== undefined, {
      message: 'Either simulatorId or simulatorName is required.',
    })
    .refine((val) => !(val.simulatorId && val.simulatorName), {
      message: 'simulatorId and simulatorName are mutually exclusive. Provide only one.',
    })
    .refine((val) => val.bundleId !== undefined || val.pid !== undefined, {
      message: 'Provide either bundleId or pid to attach.',
    })
    .refine((val) => !(val.bundleId && val.pid), {
      message: 'bundleId and pid are mutually exclusive. Provide only one.',
    }),
);

export type DebugAttachSimParams = z.infer<typeof debugAttachSchema>;

export async function debug_attach_simLogic(
  params: DebugAttachSimParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const { executor, debugger: debuggerManager } = ctx;
  const headerEvent = header('Attach Debugger');
  const handlerCtx = getHandlerContext();

  const simResult = await determineSimulatorUuid(
    { simulatorId: params.simulatorId, simulatorName: params.simulatorName },
    executor,
  );

  if (simResult.error) {
    handlerCtx.emit(headerEvent);
    handlerCtx.emit(statusLine('error', simResult.error));
    return;
  }

  const simulatorId = simResult.uuid;
  if (!simulatorId) {
    handlerCtx.emit(headerEvent);
    handlerCtx.emit(
      statusLine('error', 'Simulator resolution failed: Unable to determine simulator UUID'),
    );
    return;
  }

  let pid = params.pid;
  if (!pid && params.bundleId) {
    try {
      pid = await resolveSimulatorAppPid({
        executor,
        simulatorId,
        bundleId: params.bundleId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handlerCtx.emit(headerEvent);
      handlerCtx.emit(statusLine('error', `Failed to resolve simulator PID: ${message}`));
      return;
    }
  }

  if (!pid) {
    handlerCtx.emit(headerEvent);
    handlerCtx.emit(statusLine('error', 'Missing PID: Unable to resolve process ID to attach'));
    return;
  }

  return withErrorHandling(
    handlerCtx,
    async () => {
      const session = await debuggerManager.createSession({
        simulatorId,
        pid,
        waitFor: params.waitFor,
      });

      const isCurrent = params.makeCurrent ?? true;
      if (isCurrent) {
        debuggerManager.setCurrentSession(session.id);
      }

      const shouldContinue = params.continueOnAttach ?? true;
      if (shouldContinue) {
        try {
          await debuggerManager.resumeSession(session.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/not\s*stopped/i.test(message)) {
            log('debug', 'Process already running after attach, no resume needed');
          } else {
            try {
              await debuggerManager.detachSession(session.id);
            } catch (detachError) {
              const detachMessage =
                detachError instanceof Error ? detachError.message : String(detachError);
              log(
                'warn',
                `Failed to detach debugger session after resume failure: ${detachMessage}`,
              );
            }
            handlerCtx.emit(headerEvent);
            handlerCtx.emit(
              statusLine('error', `Failed to resume debugger after attach: ${message}`),
            );
            return;
          }
        }
      } else {
        try {
          await debuggerManager.runCommand(session.id, 'process interrupt');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/already stopped|not running/i.test(message)) {
            try {
              await debuggerManager.detachSession(session.id);
            } catch (detachError) {
              const detachMessage =
                detachError instanceof Error ? detachError.message : String(detachError);
              log(
                'warn',
                `Failed to detach debugger session after pause failure: ${detachMessage}`,
              );
            }
            handlerCtx.emit(headerEvent);
            handlerCtx.emit(
              statusLine('error', `Failed to pause debugger after attach: ${message}`),
            );
            return;
          }
        }
      }

      const backendLabel = session.backend === 'dap' ? 'DAP debugger' : 'LLDB';
      const currentText = isCurrent
        ? 'This session is now the current debug session.'
        : 'This session is not set as the current session.';

      const execState = await debuggerManager.getExecutionState(session.id);
      const isRunning = execState.status === 'running' || execState.status === 'unknown';
      const resumeText = isRunning
        ? 'Execution is running. App is responsive to UI interaction.'
        : 'Execution is paused. Use debug_continue to resume before UI automation.';

      handlerCtx.emit(headerEvent);
      if (simResult.warning) {
        handlerCtx.emit(section('Warning', [simResult.warning]));
      }
      handlerCtx.emit(
        statusLine(
          'success',
          `Attached ${backendLabel} to simulator process ${pid} (${simulatorId})`,
        ),
      );
      handlerCtx.emit(
        detailTree([
          { label: 'Debug session ID', value: session.id },
          { label: 'Status', value: currentText },
          { label: 'Execution', value: resumeText },
        ]),
      );
      handlerCtx.nextStepParams = {
        debug_breakpoint_add: { debugSessionId: session.id, file: '...', line: 123 },
        debug_continue: { debugSessionId: session.id },
        debug_stack: { debugSessionId: session.id },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to attach debugger: ${message}`,
      logMessage: ({ message }) => `Failed to attach LLDB: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
  }).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareToolWithContext<DebugAttachSimParams, DebuggerToolContext>(
  {
    internalSchema: debugAttachSchema as unknown as z.ZodType<DebugAttachSimParams, unknown>,
    logicFunction: debug_attach_simLogic,
    getContext: getDefaultDebuggerToolContext,
    requirements: [
      { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    ],
    exclusivePairs: [['simulatorId', 'simulatorName']],
  },
);
