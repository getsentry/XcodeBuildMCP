import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { executorMock } = vi.hoisted(() => ({
  executorMock: vi.fn(),
}));

vi.mock('../command.ts', () => ({
  getDefaultCommandExecutor: () => executorMock,
}));

import { doesMakeLogFileExist, executeXcodemakeCommand } from '../xcodemake.ts';

describe('executeXcodemakeCommand', () => {
  beforeEach(() => {
    executorMock.mockReset();
  });

  it('runs xcodemake using child-process cwd without mutating process cwd', async () => {
    const projectDir = '/tmp/project';
    const originalCwd = process.cwd();
    executorMock.mockResolvedValue({ success: true, output: 'ok' });

    await executeXcodemakeCommand(
      projectDir,
      ['-scheme', 'App', '-project', '/tmp/project/App.xcodeproj'],
      'Build',
    );

    expect(executorMock).toHaveBeenCalledWith(
      ['xcodemake', '-scheme', 'App', '-project', 'App.xcodeproj'],
      'Build',
      false,
      { cwd: projectDir },
    );
    expect(process.cwd()).toBe(originalCwd);
  });

  it('does not mutate process cwd when command execution fails', async () => {
    const projectDir = '/tmp/project';
    const originalCwd = process.cwd();
    executorMock.mockRejectedValue(new Error('xcodemake failed'));

    await expect(executeXcodemakeCommand(projectDir, ['-scheme', 'App'], 'Build')).rejects.toThrow(
      'xcodemake failed',
    );

    expect(process.cwd()).toBe(originalCwd);
  });
});

describe('doesMakeLogFileExist', () => {
  it('checks for the sanitized xcodemake log name when arguments contain absolute paths', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'xcodebuildmcp-xcodemake-'));
    const commandArgs = [
      '-workspace',
      'SampleApp.xcworkspace',
      '-scheme',
      'SampleApp',
      '-derivedDataPath',
      '/Users/test/Library/Developer/XcodeBuildMCP/workspaces/SampleApp/DerivedData',
      'build',
    ];
    const logTag = ['xcodemake', ...commandArgs]
      .join('_')
      .replace(/[/:]+/g, '_')
      .replace(/[^\p{L}\p{N}._+=,@ -]+/gu, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const logSuffix = `-${createHash('md5').update(commandArgs.join('\0')).digest('hex')}.log`;
    const logFileName = `${logTag.slice(0, 150 - logSuffix.length).replace(/_+$/g, '')}${logSuffix}`;

    try {
      writeFileSync(join(projectDir, logFileName), '');

      expect(doesMakeLogFileExist(projectDir, ['xcodebuild', ...commandArgs])).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
