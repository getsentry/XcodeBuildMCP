import type { StructuredOutputEnvelope } from '../types/structured-output.ts';
import { normalizeSnapshotOutput } from './normalize.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeBaseString(value: string): string {
  const normalized = normalizeSnapshotOutput(value.replace(/\u00A0/g, ' '));
  return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
}

function normalizeString(value: string, key?: string, path: string[] = []): string {
  const parentKey = path.at(-2);
  let result = normalizeBaseString(value);

  if (parentKey === 'stderr') {
    result = result.replace(/^\[\d+\/\d+\] /, '[<STEP>] ');
  }

  if (key === 'rawResponseJsonPath') {
    return '<RAW_RESPONSE_JSON_PATH>';
  }

  if (key === 'AXFrame') {
    // Round embedded floats to 1 decimal place for rounding-stable comparison with
    // the sibling `frame` object. e.g. 82.666664123535156 -> 82.7, 250.5 stays 250.5.
    result = result.replace(/(\d+)\.(\d{2,})/g, (_full, intPart: string, fracPart: string) => {
      const value = parseFloat(`${intPart}.${fracPart}`);
      return (Math.round(value * 10) / 10).toString();
    });
  }

  // Simulator state (e.g. 'Booted' | 'Shutdown') is inherently volatile across
  // test runs — any previous test may have booted or shut down a simulator.
  // Replace with a stable placeholder.
  if (key === 'state' && path.includes('simulators')) {
    return '<SIM_STATE>';
  }

  if (key === 'osVersion' && path.includes('devices')) {
    return '<OS_VERSION>';
  }

  return result;
}

function normalizeNumber(path: string[], key: string | undefined, value: number): number {
  switch (key) {
    case 'toolCount':
      if (path.includes('data')) return 99999;
      return value;
    case 'durationMs':
      if (path.at(-2) === 'summary') return 1234;
      if (path.includes('testCases')) return 0;
      return value;
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

function isBuildSettingsEntry(value: Record<string, unknown>, path: string[]): boolean {
  return (
    path.includes('entries') && typeof value.key === 'string' && typeof value.value === 'string'
  );
}

function normalizeBuildSettingsEntryKey(key: string): string {
  if (key.startsWith('SDK_DIR_')) {
    return 'SDK_DIR_<SDK_NAME>';
  }

  return key;
}

function normalizeBuildSettingsEntryValue(key: string, value: string): string {
  if (key === 'SDKROOT' || key === 'SDK_DIR' || key.startsWith('SDK_DIR_')) {
    return '<SDK_PATH>';
  }

  switch (key) {
    case 'PATH':
      return '<PATH_ENTRIES>';
    case 'ALTERNATE_OWNER':
    case 'INSTALL_OWNER':
    case 'USER':
    case 'VERSION_INFO_BUILDER':
      return '<USER>';
    case 'UID':
      return '<UID>';
    case 'GID':
      return '<GID>';
    case 'ALTERNATE_GROUP':
    case 'GROUP':
    case 'INSTALL_GROUP':
      return '<GROUP>';
    case 'CACHE_ROOT':
    case 'CCHROOT':
      return '<XCODE_CACHE_ROOT>';
    case 'CORRESPONDING_SIMULATOR_SDK_DIR':
      return '<SDK_PATH>';
    case 'CORRESPONDING_SIMULATOR_SDK_NAME':
    case 'SDK_NAME':
    case 'SDK_NAMES':
      return '<SDK_NAME>';
    case 'PLATFORM_PRODUCT_BUILD_VERSION':
    case 'SDK_PRODUCT_BUILD_VERSION':
    case 'MAC_OS_X_PRODUCT_BUILD_VERSION':
      return '<SDK_BUILD_VERSION>';
    case 'SDK_STAT_CACHE_PATH':
      return '<SDK_STAT_CACHE_PATH>';
    case 'SDK_VERSION':
    case 'SDK_VERSION_ACTUAL':
    case 'SDK_VERSION_MAJOR':
    case 'SDK_VERSION_MINOR':
    case 'MAC_OS_X_VERSION_ACTUAL':
    case 'MAC_OS_X_VERSION_MAJOR':
    case 'MAC_OS_X_VERSION_MINOR':
      return '<SDK_VERSION>';
    case 'TARGET_DEVICE_MODEL':
    case 'ASSETCATALOG_FILTER_FOR_DEVICE_MODEL':
      return '<DEVICE_MODEL>';
    case 'TARGET_DEVICE_OS_VERSION':
    case 'ASSETCATALOG_FILTER_FOR_DEVICE_OS_VERSION':
      return '<OS_VERSION>';
    default:
      return normalizeBaseString(value);
  }
}

function isNormalizedTestCase(
  value: unknown,
): value is { status?: unknown; suite?: string; test?: string } {
  return isRecord(value) && typeof value.status === 'string';
}

function testCaseSortKey(item: unknown): string {
  const record = item as { suite?: string; test?: string };
  return `${record.suite ?? ''}|${record.test ?? ''}`;
}

function normalizeTestCases(items: unknown[]): unknown[] {
  const sorted = [...items].sort((a, b) => testCaseSortKey(a).localeCompare(testCaseSortKey(b)));
  const failed = sorted.filter((item) => isNormalizedTestCase(item) && item.status === 'failed');

  return failed.length > 0 ? failed : sorted;
}

function normalizeStderrLines(items: unknown[]): unknown[] {
  const normalized: unknown[] = [];
  let stepRun: string[] = [];

  const flushStepRun = (): void => {
    if (stepRun.length === 0) return;
    normalized.push(...stepRun.sort((left, right) => left.localeCompare(right)));
    stepRun = [];
  };

  for (const item of items) {
    if (typeof item === 'string' && item.startsWith('[<STEP>] ')) {
      stepRun.push(item);
      continue;
    }

    flushStepRun();
    normalized.push(item);
  }

  flushStepRun();
  return normalized;
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
    const normalized = value.map((item, index) => normalizeValue(item, [...path, String(index)]));
    if (key === 'testCases') {
      return normalizeTestCases(normalized);
    }
    if (key === 'stderr') {
      return normalizeStderrLines(normalized);
    }
    return normalized;
  }

  if (isRecord(value)) {
    const isBuildSetting = isBuildSettingsEntry(value, path);
    const normalizedEntries = Object.entries(value).map(([entryKey, entryValue]) => {
      if (isBuildSetting && entryKey === 'key') {
        return [entryKey, normalizeBuildSettingsEntryKey(String(entryValue))];
      }

      if (isBuildSetting && entryKey === 'value') {
        return [entryKey, normalizeBuildSettingsEntryValue(String(value.key), String(value.value))];
      }

      return [entryKey, normalizeValue(entryValue, [...path, entryKey])];
    });

    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

function normalizeXcodeBridgeCallEnvelope(
  envelope: StructuredOutputEnvelope<unknown>,
): StructuredOutputEnvelope<unknown> {
  if (envelope.schema !== 'xcodebuildmcp.output.xcode-bridge-call-result') {
    return envelope;
  }

  const data = (envelope as { data?: unknown }).data;
  if (!isRecord(data)) {
    return envelope;
  }

  return {
    ...envelope,
    data: {
      ...data,
      content: [],
      ...(Object.hasOwn(data, 'structuredContent') ? { structuredContent: {} } : {}),
    },
  } as StructuredOutputEnvelope<unknown>;
}

export function normalizeStructuredEnvelope(
  envelope: StructuredOutputEnvelope<unknown>,
): StructuredOutputEnvelope<unknown> {
  return normalizeValue(
    normalizeXcodeBridgeCallEnvelope(envelope),
  ) as StructuredOutputEnvelope<unknown>;
}

const FRAME_OBJECT_REGEX =
  /"frame": \{\n\s+"y": (?<y>\d+(?:\.\d+)?),\n\s+"x": (?<x>\d+(?:\.\d+)?),\n\s+"width": (?<width>\d+(?:\.\d+)?),\n\s+"height": (?<height>\d+(?:\.\d+)?)\n\s+\}/g;

function compactFrameObjects(json: string): string {
  return json.replace(
    FRAME_OBJECT_REGEX,
    '"frame": { "x": $<x>, "y": $<y>, "width": $<width>, "height": $<height> }',
  );
}

export function formatStructuredEnvelopeFixture(
  envelope: StructuredOutputEnvelope<unknown>,
): string {
  const json = JSON.stringify(normalizeStructuredEnvelope(envelope), null, 2);
  return `${compactFrameObjects(json)}\n`;
}
