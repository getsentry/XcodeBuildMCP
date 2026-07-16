import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultTestProductsPath,
  findXctestrunPaths,
  getTestProductsCompletionMarkerPath,
  isXcodeBuildMCPManagedTestProductsName,
  markTestProductsPathCompleted,
} from '../test-products-path.ts';
import {
  getWorkspaceFilesystemLayout,
  setXcodeBuildMCPAppDirOverrideForTests,
} from '../log-paths.ts';
import { setRuntimeInstanceForTests } from '../runtime-instance.ts';

describe('test products paths', () => {
  let appDir: string;

  beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), 'xcodebuildmcp-test-products-path-'));
    setXcodeBuildMCPAppDirOverrideForTests(appDir);
    setRuntimeInstanceForTests({
      instanceId: 'test-products-path',
      pid: process.pid,
      workspaceKey: 'workspace-a',
    });
  });

  afterEach(async () => {
    setRuntimeInstanceForTests(null);
    setXcodeBuildMCPAppDirOverrideForTests(null);
    await rm(appDir, { recursive: true, force: true });
  });

  it('creates unique workspace-scoped managed paths', () => {
    const first = createDefaultTestProductsPath('build_sim');
    const second = createDefaultTestProductsPath('build_sim');

    expect(path.dirname(first)).toBe(getWorkspaceFilesystemLayout('workspace-a').testProducts);
    expect(first).not.toBe(second);
    expect(isXcodeBuildMCPManagedTestProductsName(path.basename(first))).toBe(true);
    expect(isXcodeBuildMCPManagedTestProductsName('caller-provided.xctestproducts')).toBe(false);
  });

  it('atomically marks a generated test products directory completed', () => {
    const testProductsPath = createDefaultTestProductsPath('test_sim');
    mkdirSync(testProductsPath);

    markTestProductsPathCompleted(testProductsPath);

    expect(existsSync(getTestProductsCompletionMarkerPath(testProductsPath))).toBe(true);
  });

  it('finds xctestrun files without traversing symbolic links', async () => {
    const testProductsPath = createDefaultTestProductsPath('test_sim');
    const nested = path.join(testProductsPath, 'nested');
    const outside = path.join(appDir, 'outside');
    mkdirSync(nested, { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(testProductsPath, 'B.xctestrun'), 'b');
    writeFileSync(path.join(nested, 'A.xctestrun'), 'a');
    writeFileSync(path.join(outside, 'Outside.xctestrun'), 'outside');
    symlinkSync(outside, path.join(testProductsPath, 'linked-outside'));

    expect(await findXctestrunPaths(testProductsPath)).toEqual([
      path.join(testProductsPath, 'B.xctestrun'),
      path.join(nested, 'A.xctestrun'),
    ]);
  });
});
