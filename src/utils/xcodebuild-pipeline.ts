import type {
  XcodebuildOperation,
  XcodebuildStage,
  PipelineEvent,
} from '../types/pipeline-events.ts';
import { createXcodebuildEventParser } from './xcodebuild-event-parser.ts';
import { createXcodebuildRunState } from './xcodebuild-run-state.ts';
import type { XcodebuildRunState } from './xcodebuild-run-state.ts';
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
  emit?: (event: PipelineEvent) => void;
}

export interface PipelineResult {
  state: XcodebuildRunState;
  events: PipelineEvent[];
}

export interface PipelineFinalizeOptions {
  emitSummary?: boolean;
  tailEvents?: PipelineEvent[];
  includeBuildLogFileRef?: boolean;
  includeParserDebugFileRef?: boolean;
}

export interface XcodebuildPipeline {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  emitEvent(event: PipelineEvent): void;
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

function buildLogDetailTreeEvent(logPath: string): PipelineEvent {
  return {
    type: 'detail-tree',
    timestamp: new Date().toISOString(),
    items: [{ label: 'Build Logs', value: logPath }],
  };
}

function injectBuildLogIntoTailEvents(
  tailEvents: PipelineEvent[],
  logPath: string,
): PipelineEvent[] {
  const hasBuildLogTree = tailEvents.some(
    (event) =>
      event.type === 'detail-tree' && event.items.some((item) => item.label === 'Build Logs'),
  );
  if (hasBuildLogTree) {
    return tailEvents;
  }

  const existingDetailTree = tailEvents.find((event) => event.type === 'detail-tree');
  if (existingDetailTree) {
    return tailEvents.map((event) =>
      event === existingDetailTree
        ? {
            ...existingDetailTree,
            items: [...existingDetailTree.items, { label: 'Build Logs', value: logPath }],
          }
        : event,
    );
  }

  const nextStepsIndex = tailEvents.findIndex((event) => event.type === 'next-steps');
  if (nextStepsIndex === -1) {
    return [...tailEvents, buildLogDetailTreeEvent(logPath)];
  }

  return [
    ...tailEvents.slice(0, nextStepsIndex),
    buildLogDetailTreeEvent(logPath),
    ...tailEvents.slice(nextStepsIndex),
  ];
}

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

  pipeline.emitEvent({
    type: 'header',
    timestamp: new Date().toISOString(),
    operation: options.message
      .replace(/^[^\p{L}]+/u, '')
      .split('\n')[0]
      .trim(),
    params: buildHeaderParams(options.params),
  });

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
    onEvent: (event: PipelineEvent) => {
      runState.push(event);
    },
    onUnrecognizedLine: (line: string) => {
      debugCapture.addUnrecognizedLine(line);
    },
  });

  return {
    onStdout(chunk: string): void {
      logCapture.write(chunk);
      parser.onStdout(chunk);
    },

    onStderr(chunk: string): void {
      logCapture.write(chunk);
      parser.onStderr(chunk);
    },

    emitEvent(event: PipelineEvent): void {
      runState.push(event);
    },

    finalize(
      succeeded: boolean,
      durationMs?: number,
      finalizeOptions?: PipelineFinalizeOptions,
    ): PipelineResult {
      parser.flush();
      logCapture.close();

      const tailEvents =
        finalizeOptions?.includeBuildLogFileRef === false
          ? [...(finalizeOptions?.tailEvents ?? [])]
          : injectBuildLogIntoTailEvents(finalizeOptions?.tailEvents ?? [], logCapture.path);

      const debugPath = debugCapture.flush();
      if (debugPath) {
        appLog(
          'info',
          `[Pipeline] ${debugCapture.count} unrecognized parser lines written to ${debugPath}`,
        );
        if (finalizeOptions?.includeParserDebugFileRef !== false) {
          runState.push({
            type: 'status-line',
            timestamp: new Date().toISOString(),
            level: 'warning',
            message: 'Parsing issue detected - debug log:',
          });
          runState.push({
            type: 'file-ref',
            timestamp: new Date().toISOString(),
            label: 'Parser Debug Log',
            path: debugPath,
          });
        }
      }

      const finalState = runState.finalize(succeeded, durationMs, {
        emitSummary: finalizeOptions?.emitSummary,
        tailEvents,
      });

      return {
        state: finalState,
        events: finalState.events,
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
