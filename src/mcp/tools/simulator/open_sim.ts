import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { SimulatorActionResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

const openSimSchema = z.object({});

type OpenSimParams = z.infer<typeof openSimSchema>;
type OpenSimResult = SimulatorActionResultDomainResult;

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

function createOpenSimResult(params: {
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): OpenSimResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'open',
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createDiagnostics(params.diagnosticMessage) }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: OpenSimResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createOpenSimExecutor(
  executor: CommandExecutor,
): ToolExecutor<OpenSimParams, OpenSimResult> {
  return async (_params) => {
    try {
      const result = await executor(['open', '-a', 'Simulator'], 'Open Simulator', false);

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createOpenSimResult({
          didError: true,
          error: `Open simulator operation failed: ${diagnosticMessage}`,
          diagnosticMessage,
        });
      }

      return createOpenSimResult({ didError: false });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createOpenSimResult({
        didError: true,
        error: `Open simulator operation failed: ${diagnosticMessage}`,
        diagnosticMessage,
      });
    }
  };
}

export async function open_simLogic(
  _params: OpenSimParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', 'Starting open simulator request');

  const ctx = getHandlerContext();
  const executeOpenSim = createOpenSimExecutor(executor);
  const result = await executeOpenSim(_params, {
    liveProgressEnabled: false,
    emitProgress: () => {},
  });
  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error during open simulator operation: ${result.error ?? 'Unknown error'}`);
    return;
  }

  ctx.nextStepParams = {
    boot_sim: { simulatorId: 'UUID_FROM_LIST_SIMS' },
  };
}

export const schema = openSimSchema.shape;

export const handler = createTypedTool(openSimSchema, open_simLogic, getDefaultCommandExecutor);
