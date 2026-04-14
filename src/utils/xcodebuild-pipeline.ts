import type {
  XcodebuildOperation,
  XcodebuildStage,
  HeaderProgressEvent,
  ProgressEvent,
} from '../types/progress-events.ts';
import { createXcodebuildEventParser } from './xcodebuild-event-parser.ts';
import { createXcodebuildRunState } from './xcodebuild-run-state.ts';
import type { XcodebuildRunState, XcodebuildRunStateHandle } from './xcodebuild-run-state.ts';
import { displayPath } from './build-preflight.ts';
import { resolveEffectiveDerivedDataPath } from './derived-data-path.ts';
import { formatDeviceId } from './device-name-resolver.ts';
import { createLogCapture, createParserDebugCapture } from './xcodebuild-log-capture.ts';
import { log as appLog } from './logging/index.ts';
import { getHandlerContext, handlerContextStorage } from './typed-tool-factory.ts';

export interface PipelineOptions {
  operation: XcodebuildOperation;
  toolName: string;
  params: Record<string, unknown>;
  minimumStage?: XcodebuildStage;
  emit?: (event: ProgressEvent) => void;
}

export interface PipelineResult {
  state: XcodebuildRunState;
}

export interface PipelineFinalizeOptions {
  includeParserDebugFileRef?: boolean;
}

export interface XcodebuildPipeline {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  emitEvent(event: ProgressEvent): void;
  finalize(
    succeeded: boolean,
    durationMs?: number,
    options?: PipelineFinalizeOptions,
  ): PipelineResult;
  highestStageRank(): number;
  xcresultPath: string | null;
  logPath: string;
}

export interface StartedPipeline {
  pipeline: XcodebuildPipeline;
  startedAt: number;
}

type RunStateEvent = Parameters<XcodebuildRunStateHandle['push']>[0];

function buildHeaderParams(
  params: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  const keyLabelMap: Record<string, string> = {
    scheme: 'Scheme',
    workspacePath: 'Workspace',
    projectPath: 'Project',
    configuration: 'Configuration',
    platform: 'Platform',
    simulatorName: 'Simulator',
    simulatorId: 'Simulator',
    deviceId: 'Device',
    arch: 'Architecture',
    derivedDataPath: 'Derived Data',
    xcresultPath: 'xcresult',
    file: 'File',
    targetFilter: 'Target Filter',
  };
  const arrayLabelMap: Record<string, string> = {
    onlyTesting: '-only-testing',
    skipTesting: '-skip-testing',
  };

  const pathKeys = new Set(['workspacePath', 'projectPath', 'derivedDataPath', 'xcresultPath']);

  for (const [key, label] of Object.entries(keyLabelMap)) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) {
      if (key === 'projectPath' && typeof params.workspacePath === 'string') {
        continue;
      }
      if (key === 'simulatorId' && typeof params.simulatorName === 'string') {
        continue;
      }
      let displayValue: string;
      if (pathKeys.has(key)) {
        displayValue = displayPath(value);
      } else if (key === 'deviceId') {
        displayValue = formatDeviceId(value);
      } else {
        displayValue = value;
      }
      result.push({ label, value: displayValue });
    }
  }

  for (const [key, label] of Object.entries(arrayLabelMap)) {
    const value = params[key];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const entry of value) {
      if (typeof entry === 'string' && entry.length > 0) {
        result.push({ label, value: entry });
      }
    }
  }

  // Always show Derived Data even if not explicitly provided
  if (!result.some((r) => r.label === 'Derived Data')) {
    result.push({ label: 'Derived Data', value: displayPath(resolveEffectiveDerivedDataPath()) });
  }

  return result;
}

export function createBuildHeaderEvent(
  params: Record<string, unknown>,
  message: string,
): HeaderProgressEvent {
  return {
    type: 'header',
    operation: message
      .replace(/^[^\p{L}]+/u, '')
      .split('\n')[0]
      .trim(),
    params: buildHeaderParams(params),
  };
}

/**
 * Creates a pipeline, emits the initial header event, and captures the start
 * timestamp. This consolidates the repeated create-then-emit-start pattern used
 * across all build and test tool implementations.
 */
export function startBuildPipeline(
  options: PipelineOptions & { message: string },
): StartedPipeline {
  const emit =
    options.emit ??
    (() => {
      try {
        return getHandlerContext().emit;
      } catch {
        return handlerContextStorage.getStore()?.emit;
      }
    })();
  const pipeline = createXcodebuildPipeline({ ...options, emit });
  pipeline.emitEvent(createBuildHeaderEvent(options.params, options.message));

  return { pipeline, startedAt: Date.now() };
}

export function createXcodebuildPipeline(options: PipelineOptions): XcodebuildPipeline {
  if (!options.emit) {
    throw new Error(
      'Pipeline requires an emit callback. Use startBuildPipeline() or pass emit explicitly.',
    );
  }
  const logCapture = createLogCapture(options.toolName);
  const debugCapture = createParserDebugCapture(options.toolName);
  const emit = options.emit;

  const runState = createXcodebuildRunState({
    operation: options.operation,
    minimumStage: options.minimumStage,
    onEvent: emit,
  });

  const parser = createXcodebuildEventParser({
    operation: options.operation,
    onEvent: (event) => {
      runState.push(event as RunStateEvent);
    },
    onUnrecognizedLine: (line: string) => {
      debugCapture.addUnrecognizedLine(line);
    },
  });

  function isRunStateEvent(event: ProgressEvent): event is RunStateEvent {
    switch (event.type) {
      case 'build-stage':
      case 'compiler-warning':
      case 'compiler-error':
      case 'test-discovery':
      case 'test-progress':
      case 'test-failure':
        return true;
      default:
        return false;
    }
  }

  return {
    onStdout(chunk: string): void {
      logCapture.write(chunk);
      parser.onStdout(chunk);
    },

    onStderr(chunk: string): void {
      logCapture.write(chunk);
      parser.onStderr(chunk);
    },

    emitEvent(event: ProgressEvent): void {
      if (isRunStateEvent(event)) {
        runState.push(event);
        return;
      }

      emit(event);
    },

    finalize(
      succeeded: boolean,
      durationMs?: number,
      finalizeOptions?: PipelineFinalizeOptions,
    ): PipelineResult {
      parser.flush();
      logCapture.close();

      const debugPath = debugCapture.flush();
      if (debugPath) {
        appLog(
          'info',
          `[Pipeline] ${debugCapture.count} unrecognized parser lines written to ${debugPath}`,
        );
        if (finalizeOptions?.includeParserDebugFileRef !== false) {
          emit({
            type: 'status',
            level: 'warning',
            message: 'Parsing issue detected - debug log:',
          });
          emit({
            type: 'file-ref',
            label: 'Parser Debug Log',
            path: debugPath,
          });
        }
      }

      const finalState = runState.finalize(succeeded, durationMs);

      return {
        state: finalState,
      };
    },

    highestStageRank(): number {
      return runState.highestStageRank();
    },

    get xcresultPath(): string | null {
      return parser.xcresultPath;
    },

    get logPath(): string {
      return logCapture.path;
    },
  };
}
