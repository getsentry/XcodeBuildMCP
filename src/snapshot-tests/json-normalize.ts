import type { StructuredOutputEnvelope } from '../types/structured-output.ts';
import { normalizeSnapshotOutput } from './normalize.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeString(value: string, key?: string, path: string[] = []): string {
  const normalized = normalizeSnapshotOutput(value.replace(/\u00A0/g, ' '));
  let result = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;

  if ((key === 'message' || key === 'error') && result.startsWith('Error: CLIError(')) {
    result = result.slice('Error: '.length);
  }

  if ((key === 'message' || key === 'error') && result.startsWith('Error: Error Domain=')) {
    result = result.slice('Error: '.length);
  }

  if (result.includes('Error Domain=XCCovErrorDomain Code=0 "Failed to load result bundle"')) {
    if (key === 'message') {
      return 'Error Domain=XCCovErrorDomain Code=0 "Failed to load result bundle"';
    }

    if (key === 'error') {
      if (result.startsWith('Failed to get coverage report:')) {
        return 'Failed to get coverage report: Failed to load result bundle';
      }

      if (result.startsWith('Failed to get file coverage:')) {
        return 'Failed to get file coverage: Failed to load result bundle';
      }
    }
  }

  if (key === 'error' && result.includes('xcodebuild: error:')) {
    result = result.slice(result.indexOf('xcodebuild: error:'));
  }

  if (
    key === 'sourceFilePath' ||
    key === 'workspaceRoot' ||
    key === 'scanPath' ||
    key === 'executablePath' ||
    key === 'location'
  ) {
    result = result.replace(/^<ROOT>\//, '');
  }

  if (key === 'state' && path.includes('devices')) {
    if (result === 'Available') {
      return 'connected';
    }

    if (result === 'Paired (not connected)') {
      return 'disconnected';
    }
  }

  if (key === 'test' || path.includes('selected')) {
    result = result.replace(/\(\)$/, '');
  }

  if (key === 'suite' && result === '(Unknown Suite)') {
    result = 'Unknown Suite';
  }

  if (key === 'message' && result.startsWith('Expectation failed: Bool(false)')) {
    result = 'Expectation failed: Bool(false)';
  }

  if (
    key === 'message' &&
    (result.includes('snapshot_ui has not been called yet') ||
      result.includes(
        'Failed to parse executable: Attempting to read past the size of the binary data',
      ))
  ) {
    return '';
  }

  if (path.at(-2) === 'stderr' && /^Build of product '.+' complete!/.test(result)) {
    return '';
  }

  return result;
}

function normalizeNumber(path: string[], key: string | undefined, value: number): number {
  switch (key) {
    case 'durationMs':
      return path.at(-2) === 'summary' ? 1234 : value;
    case 'processId':
    case 'pid':
      return 99999;
    case 'uptimeSeconds':
      return 3600;
    case 'threadId':
      return 1;
    case 'x':
    case 'y':
    case 'width':
    case 'height':
      return Math.round(value * 10) / 10;
    default:
      return value;
  }
}

function normalizeValue(value: unknown, path: string[] = []): unknown {
  const key = path.at(-1);

  if (typeof value === 'string') {
    return normalizeString(value, key, path);
  }

  if (typeof value === 'number') {
    return normalizeNumber(path, key, value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item, index) => normalizeValue(item, [...path, String(index)]))
      .filter((item) => item !== '');
  }

  if (value && typeof value === 'object') {
    const normalizedEntries = Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      normalizeValue(entryValue, [...path, entryKey]),
    ]);

    if (
      normalizedEntries.length === 1 &&
      normalizedEntries[0]?.[0] === 'message' &&
      normalizedEntries[0][1] === ''
    ) {
      return '';
    }

    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

function postProcessNormalizedEnvelope(
  envelope: StructuredOutputEnvelope<unknown>,
): StructuredOutputEnvelope<unknown> {
  const normalizedEnvelope = envelope as StructuredOutputEnvelope<Record<string, unknown>>;
  const data = normalizedEnvelope.data;

  if (normalizedEnvelope.schema === 'xcodebuildmcp.output.debug-stack-result') {
    const rawThreads = Array.isArray(data?.threads) ? (data.threads as unknown[]) : [];
    const threads = rawThreads.map((thread) => {
      if (!isRecord(thread)) {
        return thread;
      }

      const rawFrames = Array.isArray(thread.frames) ? (thread.frames as unknown[]) : [];
      const frames = rawFrames
        .filter((frame): frame is Record<string, unknown> => {
          if (!isRecord(frame)) {
            return false;
          }

          return (
            String(frame.displayLocation ?? '').includes('CalculatorApp.debug.dylib') ||
            frame.symbol === 'main'
          );
        })
        .slice(0, 2)
        .map((frame, index) => ({ ...frame, index }));

      return {
        ...thread,
        threadId: 1,
        truncated: true,
        frames,
      };
    });

    return {
      ...normalizedEnvelope,
      data: {
        ...data,
        threads,
      },
    };
  }

  if (
    normalizedEnvelope.didError &&
    data &&
    typeof data === 'object' &&
    !('diagnostics' in data) &&
    typeof normalizedEnvelope.error === 'string'
  ) {
    if (
      normalizedEnvelope.schema === 'xcodebuildmcp.output.scheme-list' ||
      normalizedEnvelope.schema === 'xcodebuildmcp.output.build-settings'
    ) {
      const errorMessage = normalizedEnvelope.error.includes('xcodebuild: error:')
        ? normalizedEnvelope.error.slice(normalizedEnvelope.error.indexOf('xcodebuild: error:'))
        : normalizedEnvelope.error;

      return {
        ...normalizedEnvelope,
        data: {
          ...data,
          diagnostics: {
            warnings: [],
            errors: [{ message: errorMessage }],
          },
        },
      };
    }

    if (normalizedEnvelope.schema === 'xcodebuildmcp.output.project-list') {
      const errorMessage = normalizedEnvelope.error.includes('Error: ')
        ? normalizedEnvelope.error.slice(normalizedEnvelope.error.lastIndexOf('Error: ') + 7)
        : normalizedEnvelope.error;

      return {
        ...normalizedEnvelope,
        data: {
          ...data,
          diagnostics: {
            warnings: [],
            errors: [{ message: errorMessage }],
          },
        },
      };
    }
  }

  return normalizedEnvelope;
}

export function normalizeStructuredEnvelope(
  envelope: StructuredOutputEnvelope<unknown>,
): StructuredOutputEnvelope<unknown> {
  return postProcessNormalizedEnvelope(
    normalizeValue(envelope) as StructuredOutputEnvelope<unknown>,
  );
}

export function formatStructuredEnvelopeFixture(
  envelope: StructuredOutputEnvelope<unknown>,
): string {
  return `${JSON.stringify(normalizeStructuredEnvelope(envelope), null, 2)}\n`;
}
