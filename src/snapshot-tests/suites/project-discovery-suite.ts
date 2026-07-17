import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowResultFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const APP_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.test.snapshot</string>
</dict>
</plist>`;

function createTestApp(infoPlistDirectory: string): { appPath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-discovery-'));
  const appPath = path.join(tmpDir, 'BundleTest.app');
  const plistDirectory = path.join(appPath, infoPlistDirectory);
  fs.mkdirSync(plistDirectory, { recursive: true });
  fs.writeFileSync(path.join(plistDirectory, 'Info.plist'), APP_INFO_PLIST);
  return {
    appPath,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

export function registerProjectDiscoverySnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowResultFixtureMatcher(runtime, 'project-discovery');

  describe(`${runtime} project-discovery workflow`, () => {
    let harness: WorkflowSnapshotHarness;

    beforeEach(async () => {
      harness = await createHarnessForRuntime(runtime);
    });

    afterEach(async () => {
      await harness.cleanup();
    });

    describe('list-schemes', () => {
      it('success', async () => {
        const result = await harness.invoke('project-discovery', 'list-schemes', {
          workspacePath: WORKSPACE,
        });
        expectFixture(result, 'list-schemes--success', 'success');
      });

      it('error - invalid workspace', async () => {
        const result = await harness.invoke('project-discovery', 'list-schemes', {
          workspacePath: '/nonexistent/path/Fake.xcworkspace',
        });
        expectFixture(result, 'list-schemes--error-invalid-workspace', 'error');
      });
    });

    describe('show-build-settings', () => {
      it('success', async () => {
        const result = await harness.invoke('project-discovery', 'show-build-settings', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
        });
        expectFixture(result, 'show-build-settings--success', 'success');
      });

      it('error - wrong scheme', async () => {
        const result = await harness.invoke('project-discovery', 'show-build-settings', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
        });
        expectFixture(result, 'show-build-settings--error-wrong-scheme', 'error');
      });
    });

    describe('discover-projs', () => {
      it('success', async () => {
        const result = await harness.invoke('project-discovery', 'discover-projects', {
          workspaceRoot: 'example_projects/iOS_Calculator',
        });
        expectFixture(result, 'discover-projs--success', 'success');
      });

      it('error - invalid root', async () => {
        const result = await harness.invoke('project-discovery', 'discover-projects', {
          workspaceRoot: '/nonexistent/path/Fake.app',
        });
        expectFixture(result, 'discover-projs--error-invalid-root', 'error');
      });
    });

    describe('get-app-bundle-id', () => {
      it('success', async () => {
        const testApp = createTestApp('');
        try {
          const result = await harness.invoke('project-discovery', 'get-app-bundle-id', {
            appPath: testApp.appPath,
          });
          expectFixture(result, 'get-app-bundle-id--success', 'success');
        } finally {
          testApp.cleanup();
        }
      });

      it('error - missing app', async () => {
        const result = await harness.invoke('project-discovery', 'get-app-bundle-id', {
          appPath: '/nonexistent/path/Fake.app',
        });
        expectFixture(result, 'get-app-bundle-id--error-missing-app', 'error');
      });
    });

    describe('get-macos-bundle-id', () => {
      it('success', async () => {
        const testApp = createTestApp('Contents');
        try {
          const result = await harness.invoke('project-discovery', 'get-macos-bundle-id', {
            appPath: testApp.appPath,
          });
          expectFixture(result, 'get-macos-bundle-id--success', 'success');
        } finally {
          testApp.cleanup();
        }
      });

      it('error - missing app', async () => {
        const result = await harness.invoke('project-discovery', 'get-macos-bundle-id', {
          appPath: '/nonexistent/path/Fake.app',
        });
        expectFixture(result, 'get-macos-bundle-id--error-missing-app', 'error');
      });
    });
  });
}
