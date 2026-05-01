import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { isDeviceAvailable } from '../device-availability.ts';
import {
  extractAppPathFromSnapshotOutput,
  extractProcessIdFromSnapshotOutput,
} from '../output-parsers.ts';
import {
  createHarnessForRuntime,
  createWorkflowFixtureMatcher,
  withCalculatorAppCompilerError,
} from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';
const DEVICE_ID = process.env.DEVICE_ID;
const DEVICE_READY = isDeviceAvailable(DEVICE_ID);

if (DEVICE_ID && !DEVICE_READY) {
  // eslint-disable-next-line no-console
  console.warn(
    `[device-suite] DEVICE_ID="${DEVICE_ID}" is set but the device is not reachable (locked, disconnected, or powered off). Device-dependent tests will be skipped.`,
  );
}

export function registerDeviceSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'device');

  describe(`${runtime} device workflow`, () => {
    let harness: WorkflowSnapshotHarness;

    beforeAll(async () => {
      vi.setConfig({ testTimeout: 120_000 });
      harness = await createHarnessForRuntime(runtime);
    }, 120_000);

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('list', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('device', 'list', {});
        expect(isError).toBe(false);
        expectFixture(text, 'list--success');
      });
    });

    describe('build', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'build--success');
      });

      it('error - wrong scheme', async () => {
        const { text, isError } = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'build--error-wrong-scheme');
      });

      it('error - compiler error', async () => {
        const { text, isError } = await withCalculatorAppCompilerError(() =>
          harness.invoke('device', 'build', {
            workspacePath: WORKSPACE,
            scheme: 'CalculatorApp',
          }),
        );
        expect(isError).toBe(true);
        expectFixture(text, 'build--error-compiler');
      });
    });

    describe('get-app-path', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('device', 'get-app-path', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'get-app-path--success');
      });

      it('error - wrong scheme', async () => {
        const { text, isError } = await harness.invoke('device', 'get-app-path', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'get-app-path--error-wrong-scheme');
      });
    });

    describe('install', () => {
      it('error - invalid app path', async () => {
        const { text, isError } = await harness.invoke('device', 'install', {
          deviceId: '00000000-0000-0000-0000-000000000000',
          appPath: '/tmp/nonexistent.app',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'install--error-invalid-app');
      });
    });

    describe('launch', () => {
      it('error - invalid bundle', async () => {
        const { text, isError } = await harness.invoke('device', 'launch', {
          deviceId: '00000000-0000-0000-0000-000000000000',
          bundleId: 'com.nonexistent.app',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'launch--error-invalid-bundle');
      });
    });

    describe('stop', () => {
      it('error - no app', async () => {
        const { text, isError } = await harness.invoke('device', 'stop', {
          deviceId: '00000000-0000-0000-0000-000000000000',
          processId: 99999,
          bundleId: 'com.nonexistent.app',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'stop--error-no-app');
      });
    });

    describe.runIf(DEVICE_READY)('build-and-run (requires device)', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('device', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'build-and-run--success');
      });

      it('error - wrong scheme', async () => {
        const { text, isError } = await harness.invoke('device', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
          deviceId: DEVICE_ID,
        });
        expect(isError).toBe(true);
        expectFixture(text, 'build-and-run--error-wrong-scheme');
      });

      it('error - compiler error', async () => {
        const { text, isError } = await withCalculatorAppCompilerError(() =>
          harness.invoke('device', 'build-and-run', {
            workspacePath: WORKSPACE,
            scheme: 'CalculatorApp',
            deviceId: DEVICE_ID,
          }),
        );
        expect(isError).toBe(true);
        expectFixture(text, 'build-and-run--error-compiler');
      });
    });

    describe.runIf(DEVICE_READY)('install (requires device)', () => {
      it('success', async () => {
        const appPathResult = await harness.invoke('device', 'get-app-path', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
        });
        expect(appPathResult.isError).toBe(false);

        const appPath = extractAppPathFromSnapshotOutput(appPathResult.rawText);

        const { text, isError } = await harness.invoke('device', 'install', {
          deviceId: DEVICE_ID,
          appPath,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'install--success');
      }, 60_000);
    });

    describe.runIf(DEVICE_READY)('launch (requires device)', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('device', 'launch', {
          deviceId: DEVICE_ID,
          bundleId: BUNDLE_ID,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'launch--success');
      }, 60_000);
    });

    describe.runIf(DEVICE_READY)('stop (requires device)', () => {
      it('success', async () => {
        const launchResult = await harness.invoke('device', 'launch', {
          deviceId: DEVICE_ID,
          bundleId: BUNDLE_ID,
        });
        expect(launchResult.isError).toBe(false);

        const pid = extractProcessIdFromSnapshotOutput(launchResult.rawText);
        expect(pid).toBeGreaterThan(0);

        await new Promise((resolve) => setTimeout(resolve, 2000));

        const { text, isError } = await harness.invoke('device', 'stop', {
          deviceId: DEVICE_ID,
          processId: pid,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'stop--success');
      }, 60_000);
    });

    describe.runIf(DEVICE_READY)('test (requires device)', () => {
      it('success - targeted passing test', async () => {
        const { text, isError } = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
          extraArgs: ['-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition'],
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'test--success');
      }, 300_000);

      it('failure - intentional test failure', async () => {
        const { text, isError } = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
        });
        expect(isError).toBe(true);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'test--failure');
      }, 300_000);

      it('error - compiler error', async () => {
        const { text, isError } = await withCalculatorAppCompilerError(() =>
          harness.invoke('device', 'test', {
            workspacePath: WORKSPACE,
            scheme: 'CalculatorApp',
            deviceId: DEVICE_ID,
            extraArgs: ['-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition'],
          }),
        );
        expect(isError).toBe(true);
        expectFixture(text, 'test--error-compiler');
      }, 300_000);
    });
  });
}
