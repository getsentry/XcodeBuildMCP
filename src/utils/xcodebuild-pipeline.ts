import type { XcodebuildOperation, XcodebuildStage } from '../types/domain-fragments.ts';
import type {
  BuildLikeKind,
  BuildInvocationFragment,
  BuildInvocationRequest,
  DomainFragment,
  AnyFragment,
} from '../types/domain-fragments.ts';
import { createXcodebuildEventParser } from './xcodebuild-event-parser.ts';
import { createXcodebuildRunState } from './xcodebuild-run-state.ts';
import type { XcodebuildRunState, XcodebuildRunStateHandle } from './xcodebuild-run-state.ts';
import { displayPath } from './build-preflight.ts';
import { resolveEffectiveDerivedDataPath } from './derived-data-path.ts';
import { formatDeviceId } from './device-name-resolver.ts';
import { createLogCapture, createParserDebugCapture } from './xcodebuild-log-capture.ts';
import { log as appLog } from './logging/index.ts';

export interface PipelineOptions {
  operation: XcodebuildOperation;
  kind?: BuildLikeKind;
  toolName: string;
  params: Record<string, unknown>;
  minimumStage?: XcodebuildStage;
  emit?: (fragment: AnyFragment) => void;
}

export interface PipelineResult {
  state: XcodebuildRunState;
}

export interface PipelineFinalizeOptions {}

export interface XcodebuildPipeline {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  emitFragment(fragment: AnyFragment): void;
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

function isRunStateFragment(fragment: DomainFragment): fragment is RunStateEvent {
  switch (fragment.fragment) {
    case 'build-stage':
    case 'compiler-diagnostic':
    case 'test-discovery':
    case 'test-progress':
    case 'test-failure':
      return true;
    default:
      return false;
  }
}

function buildHeaderParams(
  params: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  const keyLabelMap: Record<string, string> = {
    scheme: 'Scheme',
    workspacePath: 'Workspace',
    projectPath: 'Project',
    packagePath: 'Package',
    targetName: 'Target',
    executableName: 'Executable',
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

  const hasXcodebuildContext = result.some(
    (r) => r.label === 'Scheme' || r.label === 'Workspace' || r.label === 'Project',
  );
  if (hasXcodebuildContext && !result.some((r) => r.label === 'Derived Data')) {
    result.push({ label: 'Derived Data', value: displayPath(resolveEffectiveDerivedDataPath()) });
  }

  return result;
}

/**
 * Derive a display title for a build-like invocation from kind and request data.
 */
export function deriveBuildLikeTitle(
  kind: BuildLikeKind,
  request?: BuildInvocationRequest,
): string {
  const isSwiftPackage = request?.target === 'swift-package';
  switch (kind) {
    case 'build-result':
      return isSwiftPackage ? 'Swift Package Build' : 'Build';
    case 'build-run-result':
      return isSwiftPackage ? 'Swift Package Run' : 'Build & Run';
    case 'test-result':
      return isSwiftPackage ? 'Swift Package Test' : 'Test';
  }
}

/**
 * Convert a BuildInvocationRequest to display-ready header params.
 */
export function invocationRequestToHeaderParams(
  request: BuildInvocationRequest,
): Array<{ label: string; value: string }> {
  return buildHeaderParams(request as Record<string, unknown>);
}

/**
 * Create a BuildInvocationRequest from raw tool params.
 */
export function createBuildInvocationRequest(
  params: Record<string, unknown>,
): BuildInvocationRequest {
  const request: BuildInvocationRequest = {};
  const stringKeys: Array<keyof BuildInvocationRequest> = [
    'scheme',
    'workspacePath',
    'projectPath',
    'packagePath',
    'targetName',
    'executableName',
    'configuration',
    'platform',
    'simulatorName',
    'simulatorId',
    'deviceId',
    'arch',
    'derivedDataPath',
  ];
  for (const key of stringKeys) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) {
      (request as Record<string, unknown>)[key] = value;
    }
  }
  const arrayKeys: Array<keyof BuildInvocationRequest> = ['onlyTesting', 'skipTesting'];
  for (const key of arrayKeys) {
    const value = params[key];
    if (Array.isArray(value) && value.length > 0) {
      (request as Record<string, unknown>)[key] = value;
    }
  }
  if (typeof params.target === 'string') {
    request.target = params.target as BuildInvocationRequest['target'];
  }
  return request;
}

/**
 * Create a BuildInvocationFragment for streaming.
 */
export function createBuildInvocationFragment(
  kind: BuildLikeKind,
  operation: 'BUILD' | 'TEST',
  request: BuildInvocationRequest,
): BuildInvocationFragment {
  return {
    kind,
    fragment: 'invocation',
    operation,
    request,
  };
}

export function createXcodebuildPipeline(options: PipelineOptions): XcodebuildPipeline {
  if (!options.emit) {
    throw new Error('Pipeline requires an emit callback. Pass emit explicitly.');
  }
  const kind: BuildLikeKind =
    options.kind ?? (options.operation === 'TEST' ? 'test-result' : 'build-result');
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
    kind,
    onEvent: (fragment) => {
      if (isRunStateFragment(fragment)) {
        runState.push(fragment);
      } else {
        emit(fragment);
      }
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

    emitFragment(fragment: DomainFragment): void {
      if (isRunStateFragment(fragment)) {
        runState.push(fragment);
        return;
      }

      emit(fragment);
    },

    finalize(
      succeeded: boolean,
      durationMs?: number,
      _finalizeOptions?: PipelineFinalizeOptions,
    ): PipelineResult {
      parser.flush();
      logCapture.close();

      const debugPath = debugCapture.flush();
      if (debugPath) {
        appLog(
          'info',
          `[Pipeline] ${debugCapture.count} unrecognized parser lines written to ${debugPath}`,
        );
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
