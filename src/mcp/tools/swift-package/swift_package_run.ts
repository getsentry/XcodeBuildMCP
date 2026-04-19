import * as z from 'zod';
import path from 'node:path';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor, CommandResponse } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { addProcess } from './active-processes.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { acquireDaemonActivity } from '../../../daemon/activity-registry.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section, detailTree } from '../../../utils/tool-event-builders.ts';
import { createXcodebuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import type { StartedPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import {
  createBuildRunResultEvents,
  finalizeInlineXcodebuild,
} from '../../../utils/xcodebuild-output.ts';
import { displayPath } from '../../../utils/build-preflight.ts';

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

export async function swift_package_runLogic(
  params: SwiftPackageRunParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const resolvedPath = path.resolve(params.packagePath);
  const timeout = Math.min(params.timeout ?? 30, 300) * 1000; // Convert to ms, max 5 minutes

  const swiftArgs = ['run', '--package-path', resolvedPath];

  const headerEvent = header('Swift Package Run', [
    { label: 'Package', value: resolvedPath },
    ...(params.executableName ? [{ label: 'Executable', value: params.executableName }] : []),
    ...(params.background ? [{ label: 'Mode', value: 'background' }] : []),
  ]);

  if (params.configuration?.toLowerCase() === 'release') {
    swiftArgs.push('-c', 'release');
  } else if (params.configuration && params.configuration.toLowerCase() !== 'debug') {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', "Invalid configuration. Use 'debug' or 'release'."));
    return;
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

  return withErrorHandling(
    ctx,
    async () => {
      if (params.background) {
        const command = ['swift', ...swiftArgs];
        const cleanEnv = Object.fromEntries(
          Object.entries(process.env).filter(([, value]) => value !== undefined),
        ) as Record<string, string>;
        const result = await executor(
          command,
          'Swift Package Run (Background)',
          false,
          cleanEnv,
          true,
        );

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

          ctx.emit(headerEvent);
          ctx.emit(
            statusLine('success', `Started executable in background (PID: ${result.process.pid})`),
          );
          ctx.emit(
            section('Next Steps', [
              `Use swift_package_stop with PID ${result.process.pid} to terminate when needed.`,
            ]),
          );
          return;
        }

        ctx.emit(headerEvent);
        ctx.emit(statusLine('success', 'Started executable in background'));
        ctx.emit(section('Next Steps', ['PID not available for this execution.']));
        return;
      }

      const command = ['swift', ...swiftArgs];

      const pipeline = createXcodebuildPipeline({
        operation: 'BUILD',
        toolName: 'build_run_spm',
        params: {},
        emit: ctx.emit,
      });

      pipeline.emitEvent(headerEvent);
      const started: StartedPipeline = { pipeline, startedAt: Date.now() };

      const stdoutChunks: string[] = [];

      const commandPromise = executor(command, 'Swift Package Run', false, {
        onStdout: (chunk: string) => {
          stdoutChunks.push(chunk);
          pipeline.onStdout(chunk);
        },
        onStderr: (chunk: string) => pipeline.onStderr(chunk),
      });

      const timeoutPromise = new Promise<SwiftPackageRunTimeoutResult>((resolve) => {
        setTimeout(() => {
          resolve({
            success: false,
            output: '',
            error: `Process timed out after ${timeout / 1000} seconds`,
            timedOut: true,
          });
        }, timeout);
      });

      const result = await Promise.race([commandPromise, timeoutPromise]);

      if (isTimedOutResult(result)) {
        const timeoutSeconds = timeout / 1000;
        ctx.emit(headerEvent);
        ctx.emit(statusLine('warning', `Process timed out after ${timeoutSeconds} seconds.`));
        ctx.emit(
          section('Details', [
            'Process execution exceeded the timeout limit. Consider using background mode for long-running executables.',
            result.output || '(no output so far)',
          ]),
        );
        return;
      }

      const capturedOutput = stdoutChunks.join('').trim();
      const resolvedExecutableName = params.executableName ?? path.basename(resolvedPath);
      const executablePath = await resolveExecutablePath(
        executor,
        resolvedPath,
        resolvedExecutableName,
        params.configuration,
      );
      const processId = result.process?.pid;
      const buildRunEvents =
        result.success && executablePath
          ? createBuildRunResultEvents({
              scheme: resolvedExecutableName,
              platform: 'Swift Package',
              target: resolvedExecutableName,
              appPath: executablePath,
              processId,
              buildLogPath: pipeline.logPath,
              launchState: 'requested',
            })
          : [];
      const tailEvents = [
        ...buildRunEvents,
        ...(result.success && !executablePath
          ? [detailTree([{ label: 'Build Logs', value: displayPath(pipeline.logPath) }])]
          : []),
        ...(capturedOutput ? [section('Output', [capturedOutput])] : []),
      ];

      finalizeInlineXcodebuild({
        started,
        emit: ctx.emit,
        succeeded: result.success,
        durationMs: Date.now() - started.startedAt,
        tailEvents,
        emitSummary: true,
        errorFallbackPolicy: 'if-no-structured-diagnostics',
        includeBuildLogFileRef: false,
      });
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to execute swift run: ${message}`,
      logMessage: ({ message }) => `Swift run failed: ${message}`,
    },
  );
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
