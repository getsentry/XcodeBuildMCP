import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { SimulatorActionResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const setSimAppearanceSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
  mode: z.enum(['dark', 'light']).describe('dark|light'),
});

type SetSimAppearanceParams = z.infer<typeof setSimAppearanceSchema>;
type SetSimAppearanceResult = SimulatorActionResultDomainResult;

function createDiagnostics(message: string) {
  return {
    warnings: [],
    errors: message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((entry) => ({ message: entry })),
  };
}

function createSetSimAppearanceResult(params: {
  simulatorId: string;
  mode: SetSimAppearanceParams['mode'];
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): SetSimAppearanceResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'set-appearance',
      appearance: params.mode,
    },
    artifacts: {
      simulatorId: params.simulatorId,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createDiagnostics(params.diagnosticMessage) }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: SetSimAppearanceResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createSetSimAppearanceExecutor(
  executor: CommandExecutor,
): ToolExecutor<SetSimAppearanceParams, SetSimAppearanceResult> {
  return async (params, ctx) => {
    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Setting simulator ${params.simulatorId} appearance to ${params.mode}`,
    });

    try {
      const result = await executor(
        ['xcrun', 'simctl', 'ui', params.simulatorId, 'appearance', params.mode],
        'Set Simulator Appearance',
        false,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createSetSimAppearanceResult({
          simulatorId: params.simulatorId,
          mode: params.mode,
          didError: true,
          error: `Failed to set simulator appearance: ${diagnosticMessage}`,
          diagnosticMessage,
        });
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: `Appearance successfully set to ${params.mode} mode`,
      });
      return createSetSimAppearanceResult({
        simulatorId: params.simulatorId,
        mode: params.mode,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createSetSimAppearanceResult({
        simulatorId: params.simulatorId,
        mode: params.mode,
        didError: true,
        error: `Failed to set simulator appearance: ${diagnosticMessage}`,
        diagnosticMessage,
      });
    }
  };
}

export async function set_sim_appearanceLogic(
  params: SetSimAppearanceParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Setting simulator ${params.simulatorId} appearance to ${params.mode} mode`);

  const headerEvent = header('Set Appearance', [
    { label: 'Simulator', value: params.simulatorId },
    { label: 'Mode', value: params.mode },
  ]);

  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext();
  const executeSetSimAppearance = createSetSimAppearanceExecutor(executor);

  ctx.emit(headerEvent);

  const result = await executeSetSimAppearance(params, executionContext);
  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (result.didError) {
    log(
      'error',
      `Error during set simulator appearance for simulator ${params.simulatorId}: ${result.error ?? 'Unknown error'}`,
    );
    ctx.emit(statusLine('error', result.error ?? 'Failed to set simulator appearance'));
    return;
  }

  log('info', `Set simulator ${params.simulatorId} appearance to ${params.mode} mode`);
  ctx.emit(statusLine('success', `Appearance successfully set to ${params.mode} mode`));
}

const publicSchemaObject = z.strictObject(
  setSimAppearanceSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: setSimAppearanceSchema,
});

export const handler = createSessionAwareTool<SetSimAppearanceParams>({
  internalSchema: setSimAppearanceSchema as unknown as z.ZodType<SetSimAppearanceParams, unknown>,
  logicFunction: set_sim_appearanceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
