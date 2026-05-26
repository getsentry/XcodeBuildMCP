import { describe, expect, it } from 'vitest';
import {
  extractAppPathFromSnapshotOutput,
  extractProcessIdFromSnapshotOutput,
} from '../output-parsers.ts';

describe('snapshot output parsers', () => {
  it.each([
    ['double-quoted', '--app-path "/tmp/My App.app"', '/tmp/My App.app'],
    ['single-quoted', "--app-path '/tmp/My App.app'", '/tmp/My App.app'],
    ['unquoted', '--app-path /tmp/App.app', '/tmp/App.app'],
  ])('extracts %s CLI app path next-step args', (_label, output, expected) => {
    expect(extractAppPathFromSnapshotOutput(output)).toBe(expected);
  });

  it.each([
    ['double-quoted', '--process-id "12345"'],
    ['single-quoted', "--process-id '12345'"],
    ['unquoted', '--process-id 12345'],
  ])('extracts %s CLI process-id next-step args', (_label, output) => {
    expect(extractProcessIdFromSnapshotOutput(output)).toBe(12345);
  });
});
