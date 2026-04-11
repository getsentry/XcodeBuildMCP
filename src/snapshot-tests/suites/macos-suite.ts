import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DERIVED_DATA_DIR } from '../../utils/log-paths.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const PROJECT = 'example_projects/macOS/MCPTest.xcodeproj';

export function registerMacosSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'macos');
  const expectCanonicalFixture = createWorkflowFixtureMatcher(runtime, 'macos', {
    fixtureRuntime: 'cli',
  });

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
        expectCanonicalFixture(text, 'build--success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectCanonicalFixture(text, 'build--error-wrong-scheme');
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
        expectCanonicalFixture(text, 'build-and-run--success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'build-and-run', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectCanonicalFixture(text, 'build-and-run--error-wrong-scheme');
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
        expectCanonicalFixture(text, 'test--success');
      });

      it('failure - intentional test failure', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: 'MCPTest',
        });
        expect(isError).toBe(true);
        expect(text.length).toBeGreaterThan(10);
        expectCanonicalFixture(text, 'test--failure');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'test', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectCanonicalFixture(text, 'test--error-wrong-scheme');
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
        expectCanonicalFixture(text, 'get-app-path--success');
      });

      it('error - wrong scheme', { timeout: 120000 }, async () => {
        const { text, isError } = await harness.invoke('macos', 'get-app-path', {
          projectPath: PROJECT,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectCanonicalFixture(text, 'get-app-path--error-wrong-scheme');
      });
    });

    describe('launch', () => {
      it('success', { timeout: 120000 }, async () => {
        const settingsOutput = execSync(
          `xcodebuild -project ${PROJECT} -scheme MCPTest -showBuildSettings -derivedDataPath '${DERIVED_DATA_DIR}' 2>/dev/null`,
          { encoding: 'utf8' },
        );
        const match = settingsOutput.match(/BUILT_PRODUCTS_DIR = (.+)/);
        const appPath = `${match![1]!.trim()}/MCPTest.app`;

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
        const settingsOutput = execSync(
          `xcodebuild -project ${PROJECT} -scheme MCPTest -showBuildSettings -derivedDataPath '${DERIVED_DATA_DIR}' 2>/dev/null`,
          { encoding: 'utf8' },
        );
        const match = settingsOutput.match(/BUILT_PRODUCTS_DIR = (.+)/);
        const appPath = `${match![1]!.trim()}/MCPTest.app`;

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
