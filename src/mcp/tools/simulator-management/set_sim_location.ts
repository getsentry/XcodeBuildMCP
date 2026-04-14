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

const setSimulatorLocationSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
  latitude: z.number(),
  longitude: z.number(),
});

type SetSimulatorLocationParams = z.infer<typeof setSimulatorLocationSchema>;
type SetSimulatorLocationResult = SimulatorActionResultDomainResult;

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

function createSetSimulatorLocationResult(params: {
  simulatorId: string;
  latitude: number;
  longitude: number;
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): SetSimulatorLocationResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'set-location',
      coordinates: {
        latitude: params.latitude,
        longitude: params.longitude,
      },
    },
    artifacts: {
      simulatorId: params.simulatorId,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createDiagnostics(params.diagnosticMessage) }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: SetSimulatorLocationResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createSetSimulatorLocationExecutor(
  executor: CommandExecutor,
): ToolExecutor<SetSimulatorLocationParams, SetSimulatorLocationResult> {
  return async (params, ctx) => {
    const coords = `${params.latitude},${params.longitude}`;

    if (params.latitude < -90 || params.latitude > 90) {
      return createSetSimulatorLocationResult({
        simulatorId: params.simulatorId,
        latitude: params.latitude,
        longitude: params.longitude,
        didError: true,
        error: 'Latitude must be between -90 and 90 degrees',
        diagnosticMessage: 'Latitude must be between -90 and 90 degrees',
      });
    }

    if (params.longitude < -180 || params.longitude > 180) {
      return createSetSimulatorLocationResult({
        simulatorId: params.simulatorId,
        latitude: params.latitude,
        longitude: params.longitude,
        didError: true,
        error: 'Longitude must be between -180 and 180 degrees',
        diagnosticMessage: 'Longitude must be between -180 and 180 degrees',
      });
    }

    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Setting simulator ${params.simulatorId} location to ${coords}`,
    });

    try {
      const result = await executor(
        ['xcrun', 'simctl', 'location', params.simulatorId, 'set', coords],
        'Set Simulator Location',
        false,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createSetSimulatorLocationResult({
          simulatorId: params.simulatorId,
          latitude: params.latitude,
          longitude: params.longitude,
          didError: true,
          error: `Failed to set simulator location: ${diagnosticMessage}`,
          diagnosticMessage,
        });
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Location set successfully',
      });
      return createSetSimulatorLocationResult({
        simulatorId: params.simulatorId,
        latitude: params.latitude,
        longitude: params.longitude,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createSetSimulatorLocationResult({
        simulatorId: params.simulatorId,
        latitude: params.latitude,
        longitude: params.longitude,
        didError: true,
        error: `Failed to set simulator location: ${diagnosticMessage}`,
        diagnosticMessage,
      });
    }
  };
}

export async function set_sim_locationLogic(
  params: SetSimulatorLocationParams,
  executor: CommandExecutor,
): Promise<void> {
  const coords = `${params.latitude},${params.longitude}`;
  const headerEvent = header('Set Location', [
    { label: 'Simulator', value: params.simulatorId },
    { label: 'Coordinates', value: coords },
  ]);

  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeSetSimulatorLocation = createSetSimulatorLocationExecutor(executor);

  ctx.emit(headerEvent);

  const result = await executeSetSimulatorLocation(params, executionContext);
  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (result.didError) {
    if (result.error?.startsWith('Failed to set simulator location:')) {
      log(
        'error',
        `Error during set simulator location for simulator ${params.simulatorId}: ${result.error}`,
      );
    }
    ctx.emit(statusLine('error', result.error ?? 'Failed to set simulator location'));
    return;
  }

  log('info', `Set simulator ${params.simulatorId} location to ${coords}`);
  ctx.emit(statusLine('success', 'Location set successfully'));
}

const publicSchemaObject = z.strictObject(
  setSimulatorLocationSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: setSimulatorLocationSchema,
});

export const handler = createSessionAwareTool<SetSimulatorLocationParams>({
  internalSchema: setSimulatorLocationSchema as unknown as z.ZodType<
    SetSimulatorLocationParams,
    unknown
  >,
  logicFunction: set_sim_locationLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
