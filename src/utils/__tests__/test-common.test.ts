import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTestProgressEnabled } from '../test-common.ts';

describe('resolveTestProgressEnabled', () => {
  const originalRuntime = process.env.XCODEBUILDMCP_RUNTIME;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalRuntime === undefined) {
      delete process.env.XCODEBUILDMCP_RUNTIME;
    } else {
      process.env.XCODEBUILDMCP_RUNTIME = originalRuntime;
    }
  });

  it('defaults to true in MCP runtime when progress is not provided', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'mcp';
    expect(resolveTestProgressEnabled(undefined)).toBe(true);
  });

  it('defaults to false in CLI runtime when progress is not provided', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    expect(resolveTestProgressEnabled(undefined)).toBe(false);
  });

  it('defaults to false when runtime is unknown', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'unknown';
    expect(resolveTestProgressEnabled(undefined)).toBe(false);
  });

  it('honors explicit true override regardless of runtime', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    expect(resolveTestProgressEnabled(true)).toBe(true);
  });

  it('honors explicit false override regardless of runtime', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'mcp';
    expect(resolveTestProgressEnabled(false)).toBe(false);
  });
});
