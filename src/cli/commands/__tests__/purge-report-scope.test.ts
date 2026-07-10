import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runPurgeCommand } from '../purge.ts';
import {
  getWorkspaceFilesystemLayout,
  setXcodeBuildMCPAppDirOverrideForTests,
} from '../../../utils/log-paths.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 5, 8, 12);
const currentWorkspaceKey = 'DemoApp-123456789abc';

let appDir: string;

function managedLogName(name: string): string {
  return `${name}_2026-05-02T12-00-00-000Z_pid123_abcdef12.log`;
}

function writeFileWithMtime(filePath: string, content: string, mtimeMs: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  const mtime = new Date(mtimeMs);
  utimesSync(filePath, mtime, mtime);
}

function captureOutput(): { chunks: string[]; write: (text: string) => void } {
  const chunks: string[] = [];
  return {
    chunks,
    write: (text) => {
      chunks.push(text);
    },
  };
}

describe('purge report scope', () => {
  beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), 'xcodebuildmcp-purge-report-scope-'));
    setXcodeBuildMCPAppDirOverrideForTests(appDir);
  });

  afterEach(() => {
    setXcodeBuildMCPAppDirOverrideForTests(null);
    rmSync(appDir, { recursive: true, force: true });
  });

  it('keeps default report enumeration aligned with the all recognized workspaces scope', async () => {
    const recognized = getWorkspaceFilesystemLayout(currentWorkspaceKey);
    const unrecognizedWorkspaceKey = '20260524T184215Z';
    const unrecognized = getWorkspaceFilesystemLayout(unrecognizedWorkspaceKey);
    writeFileWithMtime(
      path.join(recognized.logs, managedLogName('recognized')),
      'recognized',
      now - 10 * DAY_MS,
    );
    writeFileWithMtime(
      path.join(unrecognized.logs, managedLogName('unrecognized')),
      'unrecognized',
      now - 10 * DAY_MS,
    );
    const output = captureOutput();

    await runPurgeCommand(
      { report: true, json: true },
      { currentWorkspaceKey, isTTY: false, now, write: output.write },
    );

    const parsed = JSON.parse(output.chunks.join('')) as {
      selectedScope: { type: string };
      totals: { bytes: number };
      workspaces: Array<{ workspaceKey: string }>;
    };
    expect(parsed.selectedScope).toEqual({ type: 'all' });
    expect(parsed.workspaces.map((workspace) => workspace.workspaceKey)).toEqual([
      currentWorkspaceKey,
    ]);
    expect(parsed.totals.bytes).toBe(Buffer.byteLength('recognized'));
  });
});
