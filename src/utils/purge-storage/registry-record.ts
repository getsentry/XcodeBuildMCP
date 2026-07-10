import * as fs from 'node:fs/promises';
import { errorMessage, isEnoent } from './scan.ts';
import type { RegistryRecord } from './types.ts';

export type RegistryReadResult =
  | { status: 'record'; record: RegistryRecord }
  | { status: 'absent' }
  | { status: 'unreadable'; reason: string };

export async function readRegistryRecord(filePath: string): Promise<RegistryReadResult> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      return { status: 'absent' };
    }
    return { status: 'unreadable', reason: errorMessage(error) };
  }

  const record = parseRegistryRecord(content);
  if (!record) {
    return { status: 'unreadable', reason: 'malformed registry record' };
  }
  return { status: 'record', record };
}

export function parseRegistryRecord(content: string): RegistryRecord | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as { owner?: { pid?: unknown }; helperPid?: unknown };
    if (
      typeof record.owner?.pid !== 'number' ||
      !Number.isInteger(record.owner.pid) ||
      record.owner.pid <= 0 ||
      typeof record.helperPid !== 'number' ||
      !Number.isInteger(record.helperPid) ||
      record.helperPid <= 0
    ) {
      return null;
    }
    return { ownerPid: record.owner.pid, helperPid: record.helperPid };
  } catch {
    return null;
  }
}
