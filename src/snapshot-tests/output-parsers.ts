import { expandHomePrefix } from '../utils/path.ts';

export interface SnapshotSimulatorEntry {
  name: string;
  udid: string;
  state: 'Booted' | 'Shutdown';
}

export function expandSnapshotPath(pathValue: string): string {
  return expandHomePrefix(pathValue);
}

export function extractAppPathFromSnapshotOutput(output: string): string {
  const detailMatch = output.match(/App Path:\s+(.+\.app)$/m);
  if (detailMatch?.[1]) {
    return expandSnapshotPath(detailMatch[1].trim());
  }

  const mcpArgMatch = output.match(/appPath:\s*"([^"]+\.app)"/);
  if (mcpArgMatch?.[1]) {
    return expandSnapshotPath(mcpArgMatch[1]);
  }

  const cliArgMatch = output.match(/--app-path\s+"([^"]+\.app)"/);
  if (cliArgMatch?.[1]) {
    return expandSnapshotPath(cliArgMatch[1]);
  }

  throw new Error('Could not extract app path from snapshot output.');
}

export function extractProcessIdFromSnapshotOutput(output: string): number {
  const detailMatch = output.match(/Process ID:\s+(\d+)/);
  if (detailMatch?.[1]) {
    return Number(detailMatch[1]);
  }

  const mcpArgMatch = output.match(/processId:\s*(\d+)/);
  if (mcpArgMatch?.[1]) {
    return Number(mcpArgMatch[1]);
  }

  const cliArgMatch = output.match(/--process-id\s+"(\d+)"/);
  if (cliArgMatch?.[1]) {
    return Number(cliArgMatch[1]);
  }

  throw new Error('Could not extract process ID from snapshot output.');
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
