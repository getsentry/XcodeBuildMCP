import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { extractAppPathFromSnapshotOutput } from '../output-parsers.ts';
import {
  compilerErrorExtraArgs,
  createHarnessForRuntime,
  createWorkflowFixtureMatcher,
} from './helpers.ts';

const PROJECT = 'example_projects/macOS/MCPTest.xcodeproj';

export function registerMacosSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'macos');

  describe(`${runtime} macos workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let tmpDir: string;
    let fakeAppPath: string;
    let bundleIdAppPath: string;

    beforeAll(async () => {
      harness = await createHarnessForRuntime(runtime);

      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-snapshot-'));

      fakeAppPath = path.join(tmpDir, 'Fake.app');
      fs.mkdirSync(fakeAppPath);

      bundleIdAppPath = path.join(tmpDir, 'BundleTest.app');
      fs.mkdirSync(bundleIdAppPath);
      const contentsDir = path.join(bundleIdAppPath, 'Contents');
      fs.mkdirSync(contentsDir);
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
    });

    afterAll(async () => {
      await harness.cleanup();
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe('build', () => {
      it('success', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'build--success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'build--error-wrong-scheme');
      });

      it('error - compiler error', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
          extraArgs: compilerErrorExtraArgs(),
        });
        expect(isError).toBe(true);
        expectFixture(text, 'build--error-compiler');
      });
    });

    describe('build-and-run', () => {
      it('success', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build-and-run', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'build-and-run--success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build-and-run', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'build-and-run--error-wrong-scheme');
      });

      it('error - compiler error', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build-and-run', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
          extraArgs: compilerErrorExtraArgs(),
        });
        expect(isError).toBe(true);
        expectFixture(text, 'build-and-run--error-compiler');
      });
    });

    describe('test', () => {
      it('success', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
          extraArgs: [
            '-only-testing:MCPTestTests/MCPTestTests/appNameIsCorrect()',
            '-only-testing:MCPTestTests/MCPTestsXCTests/testAppNameIsCorrect',
          ],
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'test--success');
      });

      it('failure - intentional test failure', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
        });
        expect(isError).toBe(true);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'test--failure');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'test--error-wrong-scheme');
      });

      it('error - compiler error', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
          extraArgs: compilerErrorExtraArgs([
            '-only-testing:MCPTestTests/MCPTestTests/appNameIsCorrect()',
            '-only-testing:MCPTestTests/MCPTestsXCTests/testAppNameIsCorrect',
          ]),
        });
        expect(isError).toBe(true);
        expectFixture(text, 'test--error-compiler');
      });
    });

    describe('get-app-path', () => {
      it('success', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'get-app-path', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'get-app-path--success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'get-app-path', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'get-app-path--error-wrong-scheme');
      });
    });

    describe('launch', () => {
      it('success', { timeout: 120000 }, async () => {
        const appPathResult = await harness.invoke('macos', 'get-app-path', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
        });
        expect(appPathResult.isError).toBe(false);

        const appPath = extractAppPathFromSnapshotOutput(appPathResult.rawText);

        const { text, isError } = await harness.invoke('macos', 'launch', {
          appPath,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'launch--success');
      });

      it('error - invalid app', { timeout: 120000 }, async () => {
        const nonExistentApp = path.join(tmpDir, 'NonExistent.app');
        const { text, isError } = await harness.invoke('macos', 'launch', {
          appPath: nonExistentApp,
        });
        expect(isError).toBe(true);
        expect(text.length).toBeGreaterThan(0);
        expectFixture(text, 'launch--error-invalid-app');
      });
    });

    describe('stop', () => {
      it('success', { timeout: 120000 }, async () => {
        const appPathResult = await harness.invoke('macos', 'get-app-path', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
        });
        expect(appPathResult.isError).toBe(false);

        const appPath = extractAppPathFromSnapshotOutput(appPathResult.rawText);

        await harness.invoke('macos', 'launch', { appPath });

        const { text, isError } = await harness.invoke('macos', 'stop', {
          appName: 'MCPTest',
        });
        expect(isError).toBe(false);
        expectFixture(text, 'stop--success');
      });

      it('error - no app', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'stop', {
          processId: 999999,
        });
        expect(isError).toBe(true);
        expect(text.length).toBeGreaterThan(0);
        expectFixture(text, 'stop--error-no-app');
      });
    });

    describe('get-macos-bundle-id', () => {
      it('success', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'get-macos-bundle-id', {
          appPath: bundleIdAppPath,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(0);
        expectFixture(text, 'get-macos-bundle-id--success');
      });

      it('error - missing app', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'get-macos-bundle-id', {
          appPath: '/nonexistent/path/Fake.app',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'get-macos-bundle-id--error-missing-app');
      });
    });
  });
}
