import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { createErrorResponse } from '../../../utils/responses/index.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { determineSimulatorUuid } from '../../../utils/simulator-utils.ts';
import {
  createSessionAwareToolWithContext,
  getSessionAwareToolSchemaShape,
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
): Promise<ToolResponse> {
  const { executor, debugger: debuggerManager } = ctx;

  const simResult = await determineSimulatorUuid(
    { simulatorId: params.simulatorId, simulatorName: params.simulatorName },
    executor,
  );

  if (simResult.error) {
    return simResult.error;
  }

  const simulatorId = simResult.uuid;
  if (!simulatorId) {
    return createErrorResponse('Simulator resolution failed', 'Unable to determine simulator UUID');
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
      return createErrorResponse('Failed to resolve simulator PID', message);
    }
  }

  if (!pid) {
    return createErrorResponse('Missing PID', 'Unable to resolve process ID to attach');
  }

  try {
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
        try {
          await debuggerManager.detachSession(session.id);
        } catch (detachError) {
          const detachMessage =
            detachError instanceof Error ? detachError.message : String(detachError);
          log('warn', `Failed to detach debugger session after resume failure: ${detachMessage}`);
        }
        return createErrorResponse('Failed to resume debugger after attach', message);
      }
    }

    const warningText = simResult.warning ? `⚠️ ${simResult.warning}\n\n` : '';
    const currentText = isCurrent
      ? 'This session is now the current debug session.'
      : 'This session is not set as the current session.';
    const resumeText = shouldContinue
      ? 'Execution resumed after attach.'
      : 'Execution is paused. Use debug_continue to resume before UI automation.';

    const backendLabel = session.backend === 'dap' ? 'DAP debugger' : 'LLDB';

    return {
      content: [
        {
          type: 'text',
          text:
            `${warningText}✅ Attached ${backendLabel} to simulator process ${pid} (${simulatorId}).\n\n` +
            `Debug session ID: ${session.id}\n` +
            `${currentText}\n` +
            `${resumeText}`,
        },
      ],
      nextStepParams: {
        debug_breakpoint_add: { debugSessionId: session.id, file: '...', line: 123 },
        debug_continue: { debugSessionId: session.id },
        debug_stack: { debugSessionId: session.id },
      },
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to attach LLDB: ${message}`);
    return createErrorResponse('Failed to attach debugger', message);
  }
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
