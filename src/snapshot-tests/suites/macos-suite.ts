import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { CleanupStack } from '../preflight/cleanup.ts';
import { buildApp, builtAppPath } from '../preflight/xcodebuild.ts';
import {
  compilerErrorExtraArgs,
  createHarnessForRuntime,
  createWorkflowResultFixtureMatcher,
} from './helpers.ts';

const PROJECT = 'example_projects/macOS/MCPTest.xcodeproj';
const SCHEME = 'MCPTest';

function ignoreMissingProcess(processId: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  try {
    process.kill(processId, signal);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      throw error;
    }
  }
}

function deferProcessCleanup(cleanup: CleanupStack, processId: number): void {
  cleanup.defer(`stop macOS process ${processId}`, () => ignoreMissingProcess(processId));
}

function processIdsForExecutable(executablePath: string): number[] {
  const processList = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  const processIds: number[] = [];

  for (const line of processList.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (match === null) {
      continue;
    }

    const command = match[2];
    if (command === executablePath || command.startsWith(`${executablePath} `)) {
      processIds.push(Number(match[1]));
    }
  }

  return processIds;
}

function deferAppPathCleanup(cleanup: CleanupStack, appPath: string): void {
  const executablePath = path.join(appPath, 'Contents', 'MacOS', SCHEME);
  const preexistingProcessIds = new Set(processIdsForExecutable(executablePath));

  cleanup.defer(`stop processes launched from ${executablePath}`, async () => {
    const deadline = Date.now() + 2000;
    let foundOwnedProcess = false;

    do {
      const ownedProcessIds = processIdsForExecutable(executablePath).filter(
        (processId) => !preexistingProcessIds.has(processId),
      );
      foundOwnedProcess ||= ownedProcessIds.length > 0;

      for (const processId of ownedProcessIds) {
        ignoreMissingProcess(processId);
      }

      if (foundOwnedProcess && ownedProcessIds.length === 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);

    for (const processId of processIdsForExecutable(executablePath)) {
      if (!preexistingProcessIds.has(processId)) {
        ignoreMissingProcess(processId, 'SIGKILL');
      }
    }
  });
}

async function launchOwnedMacApp(appPath: string, cleanup: CleanupStack): Promise<number> {
  const executablePath = path.join(appPath, 'Contents', 'MacOS', SCHEME);
  const child = spawn(executablePath, [], { stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  if (child.pid === undefined) {
    throw new Error(`Preflight launch did not return a process ID for ${executablePath}`);
  }
  deferProcessCleanup(cleanup, child.pid);
  return child.pid;
}

function createBundleIdApp(root: string): string {
  const appPath = path.join(root, 'BundleTest.app');
  const contentsDir = path.join(appPath, 'Contents');
  fs.mkdirSync(contentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentsDir, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.test.snapshot-macos</string>
</dict>
</plist>`,
  );
  return appPath;
}

export function registerMacosSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowResultFixtureMatcher(runtime, 'macos');

  describe(`${runtime} macos workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let cleanup: CleanupStack;
    let tmpDir: string;
    let derivedDataPath: string;
    let bundleIdAppPath: string;

    beforeEach(async () => {
      cleanup = new CleanupStack();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-snapshot-'));
      cleanup.defer('remove macOS snapshot directory', () =>
        fs.rmSync(tmpDir, { recursive: true, force: true }),
      );
      derivedDataPath = path.join(tmpDir, 'DerivedData');
      bundleIdAppPath = createBundleIdApp(tmpDir);
      harness = await createHarnessForRuntime(runtime);
      cleanup.defer('cleanup snapshot harness', () => harness.cleanup());
    });

    afterEach(async () => {
      await cleanup.cleanup();
    });

    describe('build', () => {
      it('success', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
        });
        expectFixture(result, 'build--success', 'success');
      });

      it('success - prepared tests', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
          buildForTesting: true,
          testProductsPath: path.join(tmpDir, 'MCPTest Tests.xctestproducts'),
        });
        expectFixture(result, 'build--success-prepared-tests', 'success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
          derivedDataPath,
        });
        expectFixture(result, 'build--error-wrong-scheme', 'error');
      });

      it('error - compiler error', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
          extraArgs: compilerErrorExtraArgs(),
        });
        expectFixture(result, 'build--error-compiler', 'error');
      });

      it('error - prepared tests with wrong scheme', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
          derivedDataPath,
          buildForTesting: true,
          testProductsPath: path.join(tmpDir, 'Invalid MCPTest Tests.xctestproducts'),
        });
        expectFixture(result, 'build--error-prepared-tests-wrong-scheme', 'error');
      });
    });

    describe('build-and-run', () => {
      it('success', { timeout: 120000 }, async () => {
        deferAppPathCleanup(cleanup, builtAppPath(derivedDataPath, SCHEME, 'macosx'));
        const result = await harness.invoke('macos', 'build-and-run', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
        });
        expectFixture(result, 'build-and-run--success', 'success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'build-and-run', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
          derivedDataPath,
        });
        expectFixture(result, 'build-and-run--error-wrong-scheme', 'error');
      });

      it('error - compiler error', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'build-and-run', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
          extraArgs: compilerErrorExtraArgs(),
        });
        expectFixture(result, 'build-and-run--error-compiler', 'error');
      });
    });

    describe('test', () => {
      it('success', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
          extraArgs: [
            '-only-testing:MCPTestTests/MCPTestTests/appNameIsCorrect()',
            '-only-testing:MCPTestTests/MCPTestsXCTests/testAppNameIsCorrect',
          ],
        });
        expectFixture(result, 'test--success', 'success');
      });

      it('failure - intentional test failure', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
        });
        expectFixture(result, 'test--failure', 'error');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
          derivedDataPath,
        });
        expectFixture(result, 'test--error-wrong-scheme', 'error');
      });

      it('error - compiler error', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
          extraArgs: compilerErrorExtraArgs([
            '-only-testing:MCPTestTests/MCPTestTests/appNameIsCorrect()',
            '-only-testing:MCPTestTests/MCPTestsXCTests/testAppNameIsCorrect',
          ]),
        });
        expectFixture(result, 'test--error-compiler', 'error');
      });
    });

    describe('get-app-path', () => {
      it('success', { timeout: 120000 }, async () => {
        await buildApp({
          projectPath: PROJECT,
          scheme: SCHEME,
          destination: 'platform=macOS',
          derivedDataPath,
        });
        const result = await harness.invoke('macos', 'get-app-path', {
          projectPath: PROJECT,
          scheme: SCHEME,
          derivedDataPath,
        });
        expectFixture(result, 'get-app-path--success', 'success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'get-app-path', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
          derivedDataPath,
        });
        expectFixture(result, 'get-app-path--error-wrong-scheme', 'error');
      });
    });

    describe('launch', () => {
      it('success', { timeout: 120000 }, async () => {
        await buildApp({
          projectPath: PROJECT,
          scheme: SCHEME,
          destination: 'platform=macOS',
          derivedDataPath,
        });
        const appPath = builtAppPath(derivedDataPath, SCHEME, 'macosx');
        deferAppPathCleanup(cleanup, appPath);
        const result = await harness.invoke('macos', 'launch', {
          appPath,
        });
        expectFixture(result, 'launch--success', 'success');
      });

      it('error - invalid app', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'launch', {
          appPath: path.join(tmpDir, 'NonExistent.app'),
        });
        expectFixture(result, 'launch--error-invalid-app', 'error');
      });
    });

    describe('stop', () => {
      it('success', { timeout: 120000 }, async () => {
        await buildApp({
          projectPath: PROJECT,
          scheme: SCHEME,
          destination: 'platform=macOS',
          derivedDataPath,
        });
        const processId = await launchOwnedMacApp(
          builtAppPath(derivedDataPath, SCHEME, 'macosx'),
          cleanup,
        );
        const result = await harness.invoke('macos', 'stop', { processId });
        expectFixture(result, 'stop--success', 'success');
      });

      it('error - no app', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'stop', { processId: 999999 });
        expectFixture(result, 'stop--error-no-app', 'error');
      });
    });

    describe('get-macos-bundle-id', () => {
      it('success', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'get-macos-bundle-id', {
          appPath: bundleIdAppPath,
        });
        expectFixture(result, 'get-macos-bundle-id--success', 'success');
      });

      it('error - missing app', { timeout: 120000 }, async () => {
        const result = await harness.invoke('macos', 'get-macos-bundle-id', {
          appPath: path.join(tmpDir, 'missing.app'),
        });
        expectFixture(result, 'get-macos-bundle-id--error-missing-app', 'error');
      });
    });
  });
}
