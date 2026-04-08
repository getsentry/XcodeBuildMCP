import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('project-discovery workflow', () => {
  let harness: SnapshotHarness;
  let tmpDir: string;
  let bundleIdAppPath: string;

  beforeAll(async () => {
    harness = await createSnapshotHarness();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-discovery-'));
    bundleIdAppPath = path.join(tmpDir, 'BundleTest.app');
    fs.mkdirSync(bundleIdAppPath);
    fs.writeFileSync(
      path.join(bundleIdAppPath, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.test.snapshot</string>
</dict>
</plist>`,
    );
    const contentsDir = path.join(bundleIdAppPath, 'Contents');
    fs.mkdirSync(contentsDir);
    fs.writeFileSync(
      path.join(contentsDir, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.test.snapshot</string>
</dict>
</plist>`,
    );
  });

  afterAll(() => {
    harness.cleanup();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('list-schemes', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'list-schemes', {
        workspacePath: WORKSPACE,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'list-schemes--success');
    });

    it('error - invalid workspace', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'list-schemes', {
        workspacePath: '/nonexistent/path/Fake.xcworkspace',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'list-schemes--error-invalid-workspace');
    });
  });

  describe('show-build-settings', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'show-build-settings', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'show-build-settings--success');
    });

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'show-build-settings', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'show-build-settings--error-wrong-scheme');
    });
  });

  describe('discover-projs', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'discover-projects', {
        workspaceRoot: 'example_projects/iOS_Calculator',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'discover-projs--success');
    });

    it('error - invalid root', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'discover-projects', {
        workspaceRoot: '/nonexistent/path/Fake.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'discover-projs--error-invalid-root');
    });
  });

  describe('get-app-bundle-id', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'get-app-bundle-id', {
        appPath: bundleIdAppPath,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'get-app-bundle-id--success');
    });

    it('error - missing app', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'get-app-bundle-id', {
        appPath: '/nonexistent/path/Fake.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'get-app-bundle-id--error-missing-app');
    });
  });

  describe('get-macos-bundle-id', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'get-macos-bundle-id', {
        appPath: bundleIdAppPath,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'get-macos-bundle-id--success');
    });

    it('error - missing app', async () => {
      const { text, isError } = await harness.invoke('project-discovery', 'get-macos-bundle-id', {
        appPath: '/nonexistent/path/Fake.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'get-macos-bundle-id--error-missing-app');
    });
  });
});
