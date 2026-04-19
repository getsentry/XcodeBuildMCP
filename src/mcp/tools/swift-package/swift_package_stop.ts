import * as z from 'zod';
import { getProcess, terminateTrackedProcess, type ProcessInfo } from './active-processes.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';

const swiftPackageStopSchema = z.object({
  pid: z.number(),
});

type SwiftPackageStopParams = z.infer<typeof swiftPackageStopSchema>;

export interface ProcessManager {
  getProcess: (pid: number) => ProcessInfo | undefined;
  terminateTrackedProcess: (
    pid: number,
    timeoutMs: number,
  ) => Promise<{ status: 'not-found' | 'terminated'; startedAt?: Date; error?: string }>;
}

const defaultProcessManager: ProcessManager = {
  getProcess,
  terminateTrackedProcess,
};

export function getDefaultProcessManager(): ProcessManager {
  return defaultProcessManager;
}

export function createMockProcessManager(overrides?: Partial<ProcessManager>): ProcessManager {
  return {
    getProcess: () => undefined,
    terminateTrackedProcess: async () => ({ status: 'not-found' }),
    ...overrides,
  };
}

export async function swift_package_stopLogic(
  params: SwiftPackageStopParams,
  processManager: ProcessManager = getDefaultProcessManager(),
  timeout: number = 5000,
): Promise<void> {
  const ctx = getHandlerContext();
  const headerEvent = header('Swift Package Stop', [{ label: 'PID', value: String(params.pid) }]);

  const processInfo = processManager.getProcess(params.pid);
  if (!processInfo) {
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine(
        'error',
        `No running process found with PID ${params.pid}. Use swift_package_list to check active processes.`,
      ),
    );
    return;
  }

  await withErrorHandling(
    ctx,
    async () => {
      const result = await processManager.terminateTrackedProcess(params.pid, timeout);
      if (result.status === 'not-found') {
        ctx.emit(headerEvent);
        ctx.emit(
          statusLine(
            'error',
            `No running process found with PID ${params.pid}. Use swift_package_list to check active processes.`,
          ),
        );
        return;
      }

      if (result.error) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to stop process: ${result.error}`));
        return;
      }

      const startedAt = result.startedAt ?? processInfo.startedAt;

      ctx.emit(headerEvent);
      ctx.emit(
        statusLine('success', `Stopped executable (was running since ${startedAt.toISOString()})`),
      );
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to stop process: ${message}`,
    },
  );
}

export const schema = swiftPackageStopSchema.shape;

interface SwiftPackageStopContext {
  processManager: ProcessManager;
}

export const handler = createTypedToolWithContext(
  swiftPackageStopSchema,
  (params: SwiftPackageStopParams, ctx: SwiftPackageStopContext) =>
    swift_package_stopLogic(params, ctx.processManager),
  () => ({ processManager: getDefaultProcessManager() }),
);
