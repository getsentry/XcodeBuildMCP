import { randomUUID } from 'node:crypto';

export function formatLogTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function shortRandomSuffix(): string {
  return randomUUID().slice(0, 8);
}
