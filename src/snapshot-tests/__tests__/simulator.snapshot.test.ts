import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import {
  createSnapshotHarness,
  ensureSimulatorBooted,
  shutdownAllSimulatorsExcept,
} from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';
import { DERIVED_DATA_DIR } from '../../utils/log-paths.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('simulator workflow', () => {
  let harness: SnapshotHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 120_000 });
    harness = await createSnapshotHarness();
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
  });

  describe('build', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator', 'build', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'build--success');
    }, 120_000);

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('simulator', 'build', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'build--error-wrong-scheme');
    }, 120_000);
  });

  describe('build-and-run', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator', 'build-and-run', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'build-and-run--success');
    }, 120_000);

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('simulator', 'build-and-run', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'build-and-run--error-wrong-scheme');
    }, 120_000);
  });

  describe('test', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator', 'test', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        simulatorName: 'iPhone 17',
        extraArgs: ['-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition'],
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'test--success');
    }, 120_000);

    it('failure - intentional test failure', async () => {
      const { text, isError } = await harness.invoke('simulator', 'test', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(true);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'test--failure');
    }, 120_000);

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('simulator', 'test', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'test--error-wrong-scheme');
    }, 120_000);
  });

  describe('get-app-path', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator', 'get-app-path', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        platform: 'iOS Simulator',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'get-app-path--success');
    }, 120_000);

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('simulator', 'get-app-path', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
        platform: 'iOS Simulator',
        simulatorName: 'iPhone 17',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'get-app-path--error-wrong-scheme');
    }, 120_000);
  });

  describe('list', () => {
    it('success', async () => {
      shutdownAllSimulatorsExcept([simulatorUdid]);
      const { text, isError } = await harness.invoke('simulator', 'list', {});
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'list--success');
    }, 120_000);
  });

  describe('install', () => {
    it('success', async () => {
      const settingsOutput = execSync(
        `xcodebuild -workspace ${WORKSPACE} -scheme CalculatorApp -showBuildSettings -derivedDataPath '${DERIVED_DATA_DIR}' -destination 'platform=iOS Simulator,name=iPhone 17' 2>/dev/null`,
        { encoding: 'utf8' },
      );
      const match = settingsOutput.match(/BUILT_PRODUCTS_DIR = (.+)/);
      const appPath = `${match![1]!.trim()}/CalculatorApp.app`;

      const { text, isError } = await harness.invoke('simulator', 'install', {
        simulatorId: simulatorUdid,
        appPath,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'install--success');
    }, 120_000);

    it('error - invalid app', async () => {
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-install-'));
      const fakeApp = path.join(tmpDir, 'NotAnApp.app');
      fs.mkdirSync(fakeApp);
      try {
        const { text } = await harness.invoke('simulator', 'install', {
          simulatorId: simulatorUdid,
          appPath: fakeApp,
        });
        expect(text.length).toBeGreaterThan(0);
        expectMatchesFixture(text, __filename, 'install--error-invalid-app');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 120_000);
  });

  describe('launch-app', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator', 'launch-app', {
        simulatorId: simulatorUdid,
        bundleId: 'io.sentry.calculatorapp',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'launch-app--success');
    }, 120_000);

    it('error - not installed', async () => {
      const { text, isError } = await harness.invoke('simulator', 'launch-app', {
        simulatorId: simulatorUdid,
        bundleId: 'com.nonexistent.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'launch-app--error-not-installed');
    }, 120_000);
  });

  describe('screenshot', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator', 'screenshot', {
        simulatorId: simulatorUdid,
        returnFormat: 'path',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'screenshot--success');
    }, 120_000);

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('simulator', 'screenshot', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
        returnFormat: 'path',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'screenshot--error-invalid-simulator');
    }, 120_000);
  });

  describe('stop', () => {
    it('success', async () => {
      await harness.invoke('simulator', 'launch-app', {
        simulatorId: simulatorUdid,
        bundleId: 'io.sentry.calculatorapp',
      });

      const { text, isError } = await harness.invoke('simulator', 'stop', {
        simulatorId: simulatorUdid,
        bundleId: 'io.sentry.calculatorapp',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'stop--success');
    }, 120_000);

    it('error - no app', async () => {
      const { text, isError } = await harness.invoke('simulator', 'stop', {
        simulatorId: simulatorUdid,
        bundleId: 'com.nonexistent.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'stop--error-no-app');
    }, 120_000);
  });
});
