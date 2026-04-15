import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { ProcessListDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor } from '../../../utils/command.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
import { activeProcesses } from './active-processes.ts';
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

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
  return async () => {
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
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeSwiftPackageList = createSwiftPackageListExecutor(dependencies);
  const result = await executeSwiftPackageList(
    (params ?? {}) as SwiftPackageListParams,
    executionContext,
  );

  setStructuredOutput(ctx, result);

  executionContext.emitResult(result);
  ctx.emit(header('Swift Package Processes'));

  if (result.processes.length === 0) {
    ctx.emit(statusLine('info', 'No Swift Package processes currently running.'));
    return;
  }

  ctx.emit(
    section(
      `Running Processes (${result.processes.length}):`,
      result.processes.flatMap((processInfo) => [
        `🟢 ${processInfo.name}`,
        `   PID: ${processInfo.processId} | Uptime: ${processInfo.uptimeSeconds}s`,
        `   Package: ${processInfo.artifacts?.packagePath ?? 'unknown package'}`,
      ]),
      { blankLineAfterTitle: true },
    ),
  );
}

const swiftPackageListSchema = z.object({});

type SwiftPackageListParams = z.infer<typeof swiftPackageListSchema>;

export const schema = swiftPackageListSchema.shape;

export const handler = createTypedTool(
  swiftPackageListSchema,
  (params: SwiftPackageListParams) => swift_package_listLogic(params),
  getDefaultCommandExecutor,
);
