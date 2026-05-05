import type { StructuredOutputEnvelope } from '../types/structured-output.ts';
import { normalizeSnapshotOutput } from './normalize.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeString(value: string, key?: string, path: string[] = []): string {
  const normalized = normalizeSnapshotOutput(value.replace(/\u00A0/g, ' '));
  let result = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;

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

  return result;
}

function normalizeNumber(path: string[], key: string | undefined, value: number): number {
  switch (key) {
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

function isBuildSettingsPathEntry(value: Record<string, unknown>, path: string[]): boolean {
  return path.includes('entries') && value.key === 'PATH' && typeof value.value === 'string';
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
    if (path.at(-1) === 'testCases') {
      return [...normalized].sort((a, b) => {
        const ka = `${(a as { suite?: string }).suite ?? ''}|${(a as { test?: string }).test ?? ''}`;
        const kb = `${(b as { suite?: string }).suite ?? ''}|${(b as { test?: string }).test ?? ''}`;
        return ka.localeCompare(kb);
      });
    }
    return normalized;
  }

  if (isRecord(value)) {
    const normalizedEntries = Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      isBuildSettingsPathEntry(value, path) && entryKey === 'value'
        ? '<PATH_ENTRIES>'
        : normalizeValue(entryValue, [...path, entryKey]),
    ]);

    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

export function normalizeStructuredEnvelope(
  envelope: StructuredOutputEnvelope<unknown>,
): StructuredOutputEnvelope<unknown> {
  return normalizeValue(envelope) as StructuredOutputEnvelope<unknown>;
}

function compactFrameObjects(json: string): string {
  return json.replace(
    /"frame": \{\n\s+"x": (\d+(?:\.\d+)?),\n\s+"y": (\d+(?:\.\d+)?),\n\s+"width": (\d+(?:\.\d+)?),\n\s+"height": (\d+(?:\.\d+)?)\n\s+\}/g,
    '"frame": { "x": $1, "y": $2, "width": $3, "height": $4 }',
  );
}

export function formatStructuredEnvelopeFixture(
  envelope: StructuredOutputEnvelope<unknown>,
): string {
  const json = JSON.stringify(normalizeStructuredEnvelope(envelope), null, 2);
  return `${compactFrameObjects(json)}\n`;
}
