import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { ProcessListDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor } from '../../../utils/command.ts';
import { DomainResultPipelineEventAdapter } from '../../../utils/domain-result-adapter.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
import { activeProcesses } from './active-processes.ts';

type ListProcessInfo = {
  executableName?: string;
  packagePath?: string;
  startedAt: Date;
};

export interface ProcessListDependencies {
  processMap?: Map<number, ListProcessInfo>;
  arrayFrom?: typeof Array.from;
  dateNow?: typeof Date.now;
}

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.process-list';

function setStructuredOutput(ctx: ToolHandlerContext, result: ProcessListDomainResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createSwiftPackageListExecutor(
  dependencies: ProcessListDependencies = {},
): ToolExecutor<SwiftPackageListParams, ProcessListDomainResult> {
  return async (_params, ctx) => {
    const processMap =
      dependencies.processMap ??
      new Map<number, ListProcessInfo>(
        Array.from(activeProcesses.entries()).map(([pid, info]) => [
          pid,
          {
            executableName: info.executableName,
            packagePath: info.packagePath,
            startedAt: info.startedAt,
          },
        ]),
      );
    const arrayFrom = dependencies.arrayFrom ?? Array.from;
    const dateNow = dependencies.dateNow ?? Date.now;

    const processes = arrayFrom(processMap.entries()).map(([processId, info]) => {
      const name = info.executableName ?? 'default';
      const uptimeSeconds = Math.max(1, Math.round((dateNow() - info.startedAt.getTime()) / 1000));

      return {
        name,
        processId,
        uptimeSeconds,
        ...(info.packagePath ? { artifacts: { packagePath: info.packagePath } } : {}),
        displayPackagePath: info.packagePath ?? 'unknown package',
      };
    });

    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: 'Swift Package Processes',
    });

    if (processes.length === 0) {
      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'No Swift Package processes currently running.',
      });
    } else {
      ctx.emitProgress({
        type: 'table',
        name: `Running Processes (${processes.length}):`,
        columns: ['name', 'processId', 'uptime', 'packagePath'],
        rows: processes.map((processInfo) => ({
          name: processInfo.name,
          processId: String(processInfo.processId),
          uptime: `${processInfo.uptimeSeconds}s`,
          packagePath: processInfo.displayPackagePath,
        })),
      });
    }

    return {
      kind: 'process-list',
      didError: false,
      error: null,
      summary: { runningProcessCount: processes.length },
      processes: processes.map(({ displayPackagePath: _displayPackagePath, ...processInfo }) => ({
        ...processInfo,
      })),
    };
  };
}

export async function swift_package_listLogic(
  params?: unknown,
  dependencies?: ProcessListDependencies,
): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress,
  });
  const executeSwiftPackageList = createSwiftPackageListExecutor(dependencies);
  const result = await executeSwiftPackageList(
    (params ?? {}) as SwiftPackageListParams,
    executionContext,
  );

  setStructuredOutput(ctx, result);

  const adapter = new DomainResultPipelineEventAdapter();
  for (const event of adapter.adaptProgressEvents(executionContext.getProgressEvents())) {
    ctx.emit(event);
  }
  for (const event of executionContext.emitResult(result)) {
    ctx.emit(event);
  }
}

const swiftPackageListSchema = z.object({});

type SwiftPackageListParams = z.infer<typeof swiftPackageListSchema>;

export const schema = swiftPackageListSchema.shape;

export const handler = createTypedTool(
  swiftPackageListSchema,
  (params: SwiftPackageListParams) => swift_package_listLogic(params),
  getDefaultCommandExecutor,
);
