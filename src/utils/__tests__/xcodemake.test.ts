import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const { executorMock } = vi.hoisted(() => ({
  executorMock: vi.fn(),
}));

vi.mock('../command.ts', () => ({
  getDefaultCommandExecutor: () => executorMock,
}));

import {
  XCODEMAKE_COMMIT,
  XCODEMAKE_DOWNLOAD_URL,
  XCODEMAKE_SHA256,
  doesMakeLogFileExist,
  executeXcodemakeCommand,
  installXcodemake,
  verifyXcodemakeScript,
} from '../xcodemake.ts';

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
  it('finds the hashed log for normalized absolute build paths without mutating cwd', () => {
    const originalCwd = process.cwd();
    const readDirectory = vi.fn(() => [
      'xcodemake_-workspace_App.xcworkspace_-scheme_App_-derivedDataPath_DerivedData_App_build-50984a29036188e0dab05cf48b9b6573.log',
    ]);

    const exists = doesMakeLogFileExist(
      '/tmp/project',
      [
        'xcodebuild',
        '-workspace',
        '/tmp/project/App.xcworkspace',
        '-scheme',
        'App',
        '-derivedDataPath',
        '/tmp/project/DerivedData/App',
        'build',
      ],
      readDirectory,
    );

    expect(exists).toBe(true);
    expect(readDirectory).toHaveBeenCalledWith('/tmp/project');
    expect(process.cwd()).toBe(originalCwd);
  });

  it('does not reuse a hashed log from different build arguments', () => {
    const readDirectory = vi.fn(() => [
      'xcodemake_-scheme_Other-68f67685244564619c1ad4d3c9ef3bad.log',
    ]);

    expect(
      doesMakeLogFileExist('/tmp/project', ['xcodebuild', '-scheme', 'App'], readDirectory),
    ).toBe(false);
  });
});

describe('xcodemake installer integrity', () => {
  it('pins the download URL to an exact commit and checksum', () => {
    expect(XCODEMAKE_COMMIT).toMatch(/^[a-f0-9]{40}$/);
    expect(XCODEMAKE_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(XCODEMAKE_DOWNLOAD_URL).toBe(
      `https://raw.githubusercontent.com/cameroncooke/xcodemake/${XCODEMAKE_COMMIT}/xcodemake`,
    );
  });

  it('accepts matching content and rejects mismatched content', () => {
    const content = '#!/bin/sh\necho trusted\n';
    const checksum = createHash('sha256').update(content).digest('hex');

    expect(() => verifyXcodemakeScript(content, checksum)).not.toThrow();
    expect(() => verifyXcodemakeScript(`${content}echo tampered\n`, checksum)).toThrow(
      'xcodemake checksum mismatch',
    );
  });

  it('does not write or chmod a script that fails integrity verification', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const chmod = vi.fn().mockResolvedValue(undefined);
    const rename = vi.fn().mockResolvedValue(undefined);
    const unlink = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response('tampered'));

    await expect(
      installXcodemake({
        fetch: fetchMock as typeof fetch,
        mkdir,
        writeFile,
        chmod,
        rename,
        unlink,
      }),
    ).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledWith(XCODEMAKE_DOWNLOAD_URL);
    expect(writeFile).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('atomically replaces the installed script after verification', async () => {
    const content = '#!/bin/sh\necho trusted\n';
    const checksum = createHash('sha256').update(content).digest('hex');
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const chmod = vi.fn().mockResolvedValue(undefined);
    const rename = vi.fn().mockResolvedValue(undefined);
    const unlink = vi.fn().mockRejectedValue(new Error('already renamed'));

    await expect(
      installXcodemake(
        {
          fetch: vi.fn().mockResolvedValue(new Response(content)) as typeof fetch,
          mkdir,
          writeFile,
          chmod,
          rename,
          unlink,
        },
        checksum,
      ),
    ).resolves.toBe(true);

    const stagingPath = expect.stringMatching(/\/xcodemake\.\d+\.[a-f0-9-]+\.tmp$/);
    expect(writeFile).toHaveBeenCalledWith(stagingPath, content, 'utf8');
    expect(chmod).toHaveBeenCalledWith(stagingPath, 0o755);
    expect(rename).toHaveBeenCalledWith(stagingPath, expect.stringMatching(/\/xcodemake$/));
  });
});
