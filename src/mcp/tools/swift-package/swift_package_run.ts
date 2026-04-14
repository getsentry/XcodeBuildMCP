import * as z from 'zod';
import path from 'node:path';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { LaunchResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor, CommandResponse } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import { addProcess } from './active-processes.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { acquireDaemonActivity } from '../../../daemon/activity-registry.ts';
import { DomainResultPipelineEventAdapter } from '../../../utils/domain-result-adapter.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

const baseSchemaObject = z.object({
  packagePath: z.string(),
  executableName: z.string().optional(),
  arguments: z.array(z.string()).optional(),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  timeout: z.number().optional(),
  background: z.boolean().optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

type SwiftPackageRunParams = z.infer<typeof baseSchemaObject>;
type SwiftPackageRunResult = LaunchResultDomainResult;

type SwiftPackageRunTimeoutResult = {
  success: boolean;
  output: string;
  error: string;
  timedOut: true;
};

function isTimedOutResult(
  result: CommandResponse | SwiftPackageRunTimeoutResult,
): result is SwiftPackageRunTimeoutResult {
  return 'timedOut' in result && result.timedOut;
}

async function resolveExecutablePath(
  executor: CommandExecutor,
  packagePath: string,
  executableName: string,
  configuration?: SwiftPackageRunParams['configuration'],
): Promise<string | null> {
  const command = ['swift', 'build', '--package-path', packagePath, '--show-bin-path'];
  if (configuration?.toLowerCase() === 'release') {
    command.push('-c', 'release');
  }

  const result = await executor(command, 'Swift Package Run (Resolve Executable Path)', false);
  if (!result.success) {
    return null;
  }

  const binPath = result.output.trim();
  if (!binPath) {
    return null;
  }

  return path.join(binPath, executableName);
}

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.launch-result';

export async function swift_package_runLogic(
  params: SwiftPackageRunParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext();
  const executeSwiftPackageRun = createSwiftPackageRunExecutor(executor);
  const result = await executeSwiftPackageRun(params, executionContext);

  setStructuredOutput(ctx, result);

  const adapter = new DomainResultPipelineEventAdapter({ xcodebuildOperation: 'BUILD' });
  for (const event of adapter.adaptProgressEvents(executionContext.getProgressEvents())) {
    ctx.emit(event);
  }
  for (const event of adapter.adaptResult(result)) {
    ctx.emit(event);
  }

  if (result.didError) {
    log('error', `Swift run failed: ${result.error ?? 'Unknown error'}`);
    return;
  }

  if (params.background) {
    const processId = getProcessId(result);
    if (processId !== undefined) {
      ctx.nextStepParams = { swift_package_stop: { pid: processId } };
    }
  }
}

function createSwiftPackageRunArtifacts(
  resolvedPath: string,
  executablePath?: string | null,
  processId?: number,
) {
  if (processId !== undefined && executablePath) {
    return { appPath: executablePath, processId };
  }
  if (processId !== undefined) {
    return { processId };
  }
  if (executablePath) {
    return { appPath: executablePath };
  }
  return { appPath: resolvedPath };
}

function createSwiftPackageRunResult(
  resolvedPath: string,
  executablePath?: string | null,
  processId?: number,
): SwiftPackageRunResult {
  return {
    kind: 'launch-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: createSwiftPackageRunArtifacts(resolvedPath, executablePath, processId),
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createSwiftPackageRunErrorResult(
  resolvedPath: string,
  message: string,
  executablePath?: string | null,
): SwiftPackageRunResult {
  return {
    kind: 'launch-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: createSwiftPackageRunArtifacts(resolvedPath, executablePath),
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function emitSwiftPackageRunProgress(
  ctx: Parameters<ToolExecutor<SwiftPackageRunParams, SwiftPackageRunResult>>[1],
  params: SwiftPackageRunParams,
  resolvedPath: string,
): void {
  ctx.emitProgress({
    type: 'status',
    level: 'info',
    message: 'Swift Package Run',
  });

  const rows = [{ label: 'Package', value: resolvedPath }];
  if (params.executableName) {
    rows.push({ label: 'Executable', value: params.executableName });
  }
  if (params.background) {
    rows.push({ label: 'Mode', value: 'background' });
  }
  if (params.configuration) {
    rows.push({ label: 'Configuration', value: params.configuration });
  }
  if (params.parseAsLibrary) {
    rows.push({ label: 'Parse As Library', value: 'true' });
  }

  ctx.emitProgress({
    type: 'table',
    name: 'Parameters',
    columns: ['label', 'value'],
    rows,
  });
}

function emitChunkLines(
  ctx: Parameters<ToolExecutor<SwiftPackageRunParams, SwiftPackageRunResult>>[1],
  stream: 'stdout' | 'stderr',
  state: { remainder: string },
  chunk: string,
): void {
  const combined = `${state.remainder}${chunk}`;
  const normalized = combined.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  state.remainder = parts.pop() ?? '';

  for (const line of parts) {
    if (line.length === 0) {
      continue;
    }
    ctx.emitProgress({
      type: 'xcodebuild-line',
      stream,
      line,
    });
  }
}

function flushChunkLines(
  ctx: Parameters<ToolExecutor<SwiftPackageRunParams, SwiftPackageRunResult>>[1],
  stream: 'stdout' | 'stderr',
  state: { remainder: string },
): void {
  if (state.remainder.length === 0) {
    return;
  }

  ctx.emitProgress({
    type: 'xcodebuild-line',
    stream,
    line: state.remainder,
  });
  state.remainder = '';
}

function getProcessId(result: SwiftPackageRunResult): number | undefined {
  return 'processId' in result.artifacts ? result.artifacts.processId : undefined;
}

function setStructuredOutput(ctx: ToolHandlerContext, result: SwiftPackageRunResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createSwiftPackageRunExecutor(
  executor: CommandExecutor,
): ToolExecutor<SwiftPackageRunParams, SwiftPackageRunResult> {
  return async (params, ctx) => {
    const resolvedPath = path.resolve(params.packagePath);
    const timeout = Math.min(params.timeout ?? 30, 300) * 1000;
    const swiftArgs = ['run', '--package-path', resolvedPath];

    emitSwiftPackageRunProgress(ctx, params, resolvedPath);

    if (params.configuration?.toLowerCase() === 'release') {
      swiftArgs.push('-c', 'release');
    } else if (params.configuration && params.configuration.toLowerCase() !== 'debug') {
      const message = "Invalid configuration. Use 'debug' or 'release'.";
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
      return createSwiftPackageRunErrorResult(resolvedPath, message);
    }

    if (params.parseAsLibrary) {
      swiftArgs.push('-Xswiftc', '-parse-as-library');
    }

    if (params.executableName) {
      swiftArgs.push(params.executableName);
    }

    if (params.arguments && params.arguments.length > 0) {
      swiftArgs.push('--');
      swiftArgs.push(...params.arguments);
    }

    log('info', `Running swift ${swiftArgs.join(' ')}`);

    try {
      if (params.background) {
        const command = ['swift', ...swiftArgs];
        const cleanEnv = Object.fromEntries(
          Object.entries(process.env).filter(([, value]) => value !== undefined),
        ) as Record<string, string>;
        const result = await executor(
          command,
          'Swift Package Run (Background)',
          false,
          { env: cleanEnv },
          true,
        );
        const executablePath = await resolveExecutablePath(
          executor,
          resolvedPath,
          params.executableName ?? path.basename(resolvedPath),
          params.configuration,
        );

        if (!result.success) {
          const message = `Failed to execute swift run: ${result.error ?? 'Unknown error'}`;
          ctx.emitProgress({
            type: 'status',
            level: 'error',
            message,
          });
          return createSwiftPackageRunErrorResult(resolvedPath, message, executablePath);
        }

        if (result.process?.pid) {
          addProcess(result.process.pid, {
            process: {
              kill: (signal?: string) => {
                if (result.process) {
                  result.process.kill(signal as NodeJS.Signals);
                }
              },
              on: (event: string, callback: () => void) => {
                if (result.process) {
                  result.process.on(event, callback);
                }
              },
              pid: result.process.pid,
            },
            startedAt: new Date(),
            executableName: params.executableName,
            packagePath: resolvedPath,
            releaseActivity: acquireDaemonActivity('swift-package.background-process'),
          });

          ctx.emitProgress({
            type: 'status',
            level: 'info',
            message: `Started executable in background (PID: ${result.process.pid})`,
          });
          ctx.emitProgress({
            type: 'status',
            level: 'info',
            message: `Use swift_package_stop with PID ${result.process.pid} to terminate when needed.`,
          });
          if (executablePath) {
            ctx.emitProgress({
              type: 'artifact',
              name: 'Executable Path',
              path: executablePath,
            });
          }
          return createSwiftPackageRunResult(resolvedPath, executablePath, result.process.pid);
        }

        ctx.emitProgress({
          type: 'status',
          level: 'info',
          message: 'Started executable in background',
        });
        ctx.emitProgress({
          type: 'status',
          level: 'info',
          message: 'PID not available for this execution.',
        });
        if (executablePath) {
          ctx.emitProgress({
            type: 'artifact',
            name: 'Executable Path',
            path: executablePath,
          });
        }
        return createSwiftPackageRunResult(resolvedPath, executablePath);
      }

      const command = ['swift', ...swiftArgs];
      const stdoutChunks: string[] = [];
      const stdoutState = { remainder: '' };
      const stderrState = { remainder: '' };

      let timeoutHandle: NodeJS.Timeout | undefined;
      const commandPromise = executor(command, 'Swift Package Run', false, {
        onStdout: (chunk: string) => {
          stdoutChunks.push(chunk);
          emitChunkLines(ctx, 'stdout', stdoutState, chunk);
        },
        onStderr: (chunk: string) => emitChunkLines(ctx, 'stderr', stderrState, chunk),
      });

      const timeoutPromise = new Promise<SwiftPackageRunTimeoutResult>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve({
            success: false,
            output: '',
            error: `Process timed out after ${timeout / 1000} seconds`,
            timedOut: true,
          });
        }, timeout);
      });

      const result = await Promise.race([commandPromise, timeoutPromise]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (isTimedOutResult(result)) {
        const message = result.error;
        ctx.emitProgress({
          type: 'status',
          level: 'warning',
          message: `Process timed out after ${timeout / 1000} seconds.`,
        });
        ctx.emitProgress({
          type: 'status',
          level: 'info',
          message:
            'Process execution exceeded the timeout limit. Consider using background mode for long-running executables.',
        });
        return createSwiftPackageRunErrorResult(resolvedPath, message);
      }

      flushChunkLines(ctx, 'stdout', stdoutState);
      flushChunkLines(ctx, 'stderr', stderrState);

      const executablePath = await resolveExecutablePath(
        executor,
        resolvedPath,
        params.executableName ?? path.basename(resolvedPath),
        params.configuration,
      );

      if (!result.success) {
        const message = `Failed to execute swift run: ${result.error ?? 'Unknown error'}`;
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message,
        });
        return createSwiftPackageRunErrorResult(resolvedPath, message, executablePath);
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Executable launched successfully',
      });

      if (executablePath) {
        ctx.emitProgress({
          type: 'artifact',
          name: 'Executable Path',
          path: executablePath,
        });
      }

      return createSwiftPackageRunResult(resolvedPath, executablePath, result.process?.pid);
    } catch (error) {
      const message = `Failed to execute swift run: ${toErrorMessage(error)}`;
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
      return createSwiftPackageRunErrorResult(resolvedPath, message);
    }
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageRunParams>({
  internalSchema: baseSchemaObject,
  logicFunction: swift_package_runLogic,
  getExecutor: getDefaultCommandExecutor,
});
