import type { SnapshotResult } from './contracts.ts';
import { expandHomePrefix } from '../utils/path.ts';

export interface SnapshotSimulatorEntry {
  name: string;
  udid: string;
  state: 'Booted' | 'Shutdown';
}

export function expandSnapshotPath(pathValue: string): string {
  return expandHomePrefix(pathValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStructuredArtifact(result: SnapshotResult, key: string): unknown {
  const data = result.structuredEnvelope?.data;
  if (!isRecord(data) || !isRecord(data.artifacts)) {
    return undefined;
  }
  return data.artifacts[key];
}

function firstMatchGroup(output: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    const group = match?.slice(1).find(Boolean);
    if (group) return group;
  }
  return undefined;
}

export function extractAppPathFromSnapshotOutput(output: string): string {
  const appPath = firstMatchGroup(output, [
    /App Path:\s+(.+\.app)$/m,
    /appPath:\s*"([^"]+\.app)"/,
    /--app-path\s+(?:"([^"]+\.app)"|'([^']+\.app)'|(\S+\.app))/,
  ]);
  if (appPath) {
    return expandSnapshotPath(appPath.trim());
  }

  throw new Error('Could not extract app path from snapshot output.');
}

export function extractAppPathFromSnapshotResult(result: SnapshotResult): string {
  const appPath = getStructuredArtifact(result, 'appPath');
  if (typeof appPath === 'string') {
    return expandSnapshotPath(appPath);
  }

  return extractAppPathFromSnapshotOutput(result.rawText);
}

export function extractProcessIdFromSnapshotOutput(output: string): number {
  const processId = firstMatchGroup(output, [
    /Process ID:\s+(\d+)/,
    /processId:\s*(\d+)/,
    /--process-id\s+(?:"(\d+)"|'(\d+)'|(\d+))/,
  ]);
  if (processId) {
    return Number(processId);
  }

  throw new Error('Could not extract process ID from snapshot output.');
}

export function extractProcessIdFromSnapshotResult(result: SnapshotResult): number {
  const processId = getStructuredArtifact(result, 'processId');
  if (typeof processId === 'number') {
    return processId;
  }
  if (typeof processId === 'string') {
    const parsedProcessId = Number(processId);
    if (Number.isFinite(parsedProcessId)) {
      return parsedProcessId;
    }
  }

  return extractProcessIdFromSnapshotOutput(result.rawText);
}

export function parseSimulatorListOutput(output: string): SnapshotSimulatorEntry[] {
  const simulators: SnapshotSimulatorEntry[] = [];
  const lines = output.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const simulatorLine = lines[index]?.match(
      /^\s*📱\s+\[[✓✗]\]\s+(.+)\s+\((Booted|Shutdown)\)\s*$/u,
    );
    if (!simulatorLine) {
      continue;
    }

    const udidLine = lines[index + 1]?.match(/^\s*UDID:\s+([0-9A-Fa-f-]+)\s*$/);
    if (!udidLine?.[1]) {
      continue;
    }

    simulators.push({
      name: simulatorLine[1],
      state: simulatorLine[2] as SnapshotSimulatorEntry['state'],
      udid: udidLine[1],
    });
    index += 1;
  }

  return simulators;
}
