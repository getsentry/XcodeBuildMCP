import type { ToolHandlerContext } from '../../../../rendering/types.ts';
import type {
  BasicDiagnostics,
  CapturePayload,
  CaptureResultDomainResult,
  UiAction,
  UiActionResultDomainResult,
} from '../../../../types/domain-results.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { createBasicDiagnostics } from '../../../../utils/diagnostics.ts';
import { AxeError, DependencyError, SystemError } from '../../../../utils/errors.ts';

const UI_ACTION_SCHEMA = 'xcodebuildmcp.output.ui-action-result';
const CAPTURE_SCHEMA = 'xcodebuildmcp.output.capture-result';

function createDiagnostics(
  warnings: readonly string[] = [],
  errors: readonly string[] = [],
): BasicDiagnostics | undefined {
  if (warnings.length === 0 && errors.length === 0) {
    return undefined;
  }

  return createBasicDiagnostics({ warnings, errors });
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function createUiActionSuccessResult(
  action: UiAction,
  simulatorId: string,
  warnings: Array<string | null | undefined> = [],
): UiActionResultDomainResult {
  return {
    kind: 'ui-action-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    action,
    artifacts: { simulatorId },
    diagnostics: createDiagnostics(compact(warnings), []),
  };
}

export function createUiActionFailureResult(
  action: UiAction,
  simulatorId: string,
  message: string,
  options: {
    warnings?: Array<string | null | undefined>;
    details?: Array<string | null | undefined>;
  } = {},
): UiActionResultDomainResult {
  return {
    kind: 'ui-action-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    action,
    artifacts: { simulatorId },
    diagnostics: createDiagnostics(compact(options.warnings ?? []), compact(options.details ?? [])),
  };
}

export function createCaptureSuccessResult(
  simulatorId: string,
  options: {
    screenshotPath?: string;
    capture?: CapturePayload;
    warnings?: Array<string | null | undefined>;
  } = {},
): CaptureResultDomainResult {
  return {
    kind: 'capture-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: {
      simulatorId,
      ...(options.screenshotPath ? { screenshotPath: options.screenshotPath } : {}),
    },
    ...(options.capture ? { capture: options.capture } : {}),
    diagnostics: createDiagnostics(compact(options.warnings ?? []), []),
  };
}

export function createCaptureFailureResult(
  simulatorId: string,
  message: string,
  options: {
    screenshotPath?: string;
    warnings?: Array<string | null | undefined>;
    details?: Array<string | null | undefined>;
  } = {},
): CaptureResultDomainResult {
  return {
    kind: 'capture-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: {
      simulatorId,
      ...(options.screenshotPath ? { screenshotPath: options.screenshotPath } : {}),
    },
    diagnostics: createDiagnostics(compact(options.warnings ?? []), compact(options.details ?? [])),
  };
}

interface AxeErrorMessages {
  dependencyFailureMessage?: string;
  axeFailureMessage: (error: AxeError) => string;
  systemFailureMessage?: (error: SystemError) => string;
  unexpectedFailureMessage?: (message: string) => string;
}

export function mapAxeCommandError(
  error: unknown,
  messages: AxeErrorMessages,
): {
  message: string;
  diagnostics?: BasicDiagnostics;
} {
  if (error instanceof DependencyError) {
    return { message: messages.dependencyFailureMessage ?? AXE_NOT_AVAILABLE_MESSAGE };
  }

  if (error instanceof AxeError) {
    return {
      message: messages.axeFailureMessage(error),
      diagnostics: createDiagnostics([], compact([error.axeOutput || error.message])),
    };
  }

  if (error instanceof SystemError) {
    return {
      message: messages.systemFailureMessage?.(error) ?? 'System error executing axe command.',
      diagnostics: createDiagnostics([], compact([error.message])),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    message: messages.unexpectedFailureMessage?.(message) ?? 'Unexpected UI automation failure.',
    diagnostics: createDiagnostics([], compact([message])),
  };
}

export function setUiActionStructuredOutput(
  ctx: ToolHandlerContext,
  result: UiActionResultDomainResult,
): void {
  ctx.structuredOutput = {
    result,
    schema: UI_ACTION_SCHEMA,
    schemaVersion: '1',
  };
}

export function setCaptureStructuredOutput(
  ctx: ToolHandlerContext,
  result: CaptureResultDomainResult,
): void {
  ctx.structuredOutput = {
    result,
    schema: CAPTURE_SCHEMA,
    schemaVersion: '1',
  };
}
