import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { isDeviceAvailable } from '../device-availability.ts';
import { CleanupStack } from '../preflight/cleanup.ts';
import {
  ensureDeviceAppNotInstalled,
  installDeviceApp,
  launchDeviceApp,
  uninstallDeviceApp,
  waitForDeviceAppInstallationState,
} from '../preflight/device.ts';
import { buildApp, builtAppPath } from '../preflight/xcodebuild.ts';
import {
  compilerErrorExtraArgs,
  createHarnessForRuntime,
  createWorkflowResultFixtureMatcher,
} from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';
const DEVICE_ID = process.env.DEVICE_ID;
const DEVICE_READY = isDeviceAvailable(DEVICE_ID);

function deferCalculatorUninstall(cleanup: CleanupStack, deviceId: string): void {
  cleanup.defer('uninstall calculator from device', async () => {
    await uninstallDeviceApp(deviceId, BUNDLE_ID);
    if (await waitForDeviceAppInstallationState(deviceId, BUNDLE_ID, false)) {
      throw new Error(`Calculator remained installed on device ${deviceId} after cleanup`);
    }
  });
}

function deferCalculatorUninstallIfPresent(cleanup: CleanupStack, deviceId: string): void {
  cleanup.defer('uninstall calculator from device if installed by test', async () => {
    const installed = await waitForDeviceAppInstallationState(deviceId, BUNDLE_ID, true);
    if (!installed) {
      return;
    }
    await uninstallDeviceApp(deviceId, BUNDLE_ID);
    if (await waitForDeviceAppInstallationState(deviceId, BUNDLE_ID, false)) {
      throw new Error(`Calculator remained installed on device ${deviceId} after cleanup`);
    }
  });
}

async function buildDeviceCalculator(deviceId: string, derivedDataPath: string): Promise<string> {
  await buildApp({
    workspacePath: WORKSPACE,
    scheme: 'CalculatorApp',
    destination: `platform=iOS,id=${deviceId}`,
    derivedDataPath,
  });
  return builtAppPath(derivedDataPath, 'CalculatorApp', 'iphoneos');
}

if (DEVICE_ID && !DEVICE_READY) {
  // eslint-disable-next-line no-console
  console.warn(
    `[device-suite] DEVICE_ID="${DEVICE_ID}" is set but the device is not reachable (locked, disconnected, or powered off). Device-dependent tests will be skipped.`,
  );
}

export function registerDeviceSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowResultFixtureMatcher(runtime, 'device');

  describe(`${runtime} device workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let cleanup: CleanupStack;
    let derivedDataPath: string;

    beforeEach(async () => {
      vi.setConfig({ testTimeout: 120_000 });
      harness = await createHarnessForRuntime(runtime);
      cleanup = new CleanupStack();
      derivedDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'device-derived-data-'));
      cleanup.defer('remove device DerivedData', () => {
        fs.rmSync(derivedDataPath, { recursive: true, force: true });
      });
    }, 120_000);

    afterEach(async () => {
      try {
        await cleanup.cleanup();
      } finally {
        await harness.cleanup();
      }
    });

    describe('list', () => {
      it('success', async () => {
        const result = await harness.invoke('device', 'list', {});
        expectFixture(result, 'list--success', 'success');
      });
    });

    describe('build', () => {
      it('success', async () => {
        const result = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          derivedDataPath,
        });
        expectFixture(result, 'build--success', 'success');
      });

      it('success - prepared tests without a selected device', async () => {
        const result = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          derivedDataPath,
          buildForTesting: true,
          testProductsPath: path.join(
            derivedDataPath,
            'Generic CalculatorApp Tests.xctestproducts',
          ),
        });
        expectFixture(result, 'build--success-prepared-tests-generic', 'success');
      });

      it('error - wrong scheme', async () => {
        const result = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
          derivedDataPath,
        });
        expectFixture(result, 'build--error-wrong-scheme', 'error');
      });

      it('error - compiler error', async () => {
        const result = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          derivedDataPath,
          extraArgs: compilerErrorExtraArgs(),
        });
        expectFixture(result, 'build--error-compiler', 'error');
      });

      it('error - prepared tests with wrong scheme', async () => {
        const result = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
          derivedDataPath,
          buildForTesting: true,
          testProductsPath: path.join(
            derivedDataPath,
            'Invalid CalculatorApp Tests.xctestproducts',
          ),
        });
        expectFixture(result, 'build--error-prepared-tests-wrong-scheme', 'error');
      });
    });

    describe('get-app-path', () => {
      it('success', async () => {
        const result = await harness.invoke('device', 'get-app-path', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          derivedDataPath,
        });
        expectFixture(result, 'get-app-path--success', 'success');
      });

      it('error - wrong scheme', async () => {
        const result = await harness.invoke('device', 'get-app-path', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
          derivedDataPath,
        });
        expectFixture(result, 'get-app-path--error-wrong-scheme', 'error');
      });
    });

    describe('install', () => {
      it('error - invalid app path', async () => {
        const result = await harness.invoke('device', 'install', {
          deviceId: '00000000-0000-0000-0000-000000000000',
          appPath: '/tmp/nonexistent.app',
        });
        expectFixture(result, 'install--error-invalid-app', 'error');
      });
    });

    describe('launch', () => {
      it('error - invalid bundle', async () => {
        const result = await harness.invoke('device', 'launch', {
          deviceId: '00000000-0000-0000-0000-000000000000',
          bundleId: 'com.nonexistent.app',
        });
        expectFixture(result, 'launch--error-invalid-bundle', 'error');
      });
    });

    describe('stop', () => {
      it('error - no app', async () => {
        const result = await harness.invoke('device', 'stop', {
          deviceId: '00000000-0000-0000-0000-000000000000',
          processId: 99999,
          bundleId: 'com.nonexistent.app',
        });
        expectFixture(result, 'stop--error-no-app', 'error');
      });
    });

    describe.runIf(DEVICE_READY)('build-and-run (requires device)', () => {
      it('success', async () => {
        await ensureDeviceAppNotInstalled(DEVICE_ID!, BUNDLE_ID);
        deferCalculatorUninstall(cleanup, DEVICE_ID!);
        const result = await harness.invoke('device', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
          derivedDataPath,
        });
        expectFixture(result, 'build-and-run--success', 'success');
      });

      it('error - wrong scheme', async () => {
        const result = await harness.invoke('device', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
          deviceId: DEVICE_ID,
          derivedDataPath,
        });
        expectFixture(result, 'build-and-run--error-wrong-scheme', 'error');
      });

      it('error - compiler error', async () => {
        const result = await harness.invoke('device', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
          derivedDataPath,
          extraArgs: compilerErrorExtraArgs(),
        });
        expectFixture(result, 'build-and-run--error-compiler', 'error');
      });
    });

    describe.runIf(DEVICE_READY)('install (requires device)', () => {
      it('success', async () => {
        await ensureDeviceAppNotInstalled(DEVICE_ID!, BUNDLE_ID);
        deferCalculatorUninstall(cleanup, DEVICE_ID!);
        const appPath = await buildDeviceCalculator(DEVICE_ID!, derivedDataPath);
        const result = await harness.invoke('device', 'install', {
          deviceId: DEVICE_ID,
          appPath,
        });
        expectFixture(result, 'install--success', 'success');
      }, 300_000);
    });

    describe.runIf(DEVICE_READY)('launch (requires device)', () => {
      it('success', async () => {
        await ensureDeviceAppNotInstalled(DEVICE_ID!, BUNDLE_ID);
        const appPath = await buildDeviceCalculator(DEVICE_ID!, derivedDataPath);
        await installDeviceApp(DEVICE_ID!, appPath);
        deferCalculatorUninstall(cleanup, DEVICE_ID!);
        const result = await harness.invoke('device', 'launch', {
          deviceId: DEVICE_ID,
          bundleId: BUNDLE_ID,
        });
        expectFixture(result, 'launch--success', 'success');
      }, 300_000);
    });

    describe.runIf(DEVICE_READY)('stop (requires device)', () => {
      it('success', async () => {
        await ensureDeviceAppNotInstalled(DEVICE_ID!, BUNDLE_ID);
        const appPath = await buildDeviceCalculator(DEVICE_ID!, derivedDataPath);
        await installDeviceApp(DEVICE_ID!, appPath);
        deferCalculatorUninstall(cleanup, DEVICE_ID!);
        const pid = await launchDeviceApp(DEVICE_ID!, BUNDLE_ID);

        await new Promise((resolve) => setTimeout(resolve, 2000));

        const result = await harness.invoke('device', 'stop', {
          deviceId: DEVICE_ID,
          processId: pid,
        });
        expectFixture(result, 'stop--success', 'success');
      }, 300_000);
    });

    describe.runIf(DEVICE_READY)('test (requires device)', () => {
      it('success - targeted passing test', async () => {
        await ensureDeviceAppNotInstalled(DEVICE_ID!, BUNDLE_ID);
        deferCalculatorUninstallIfPresent(cleanup, DEVICE_ID!);
        const result = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
          derivedDataPath,
          extraArgs: ['-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition'],
        });
        expectFixture(result, 'test--success', 'success');
      }, 300_000);

      it('failure - intentional test failure', async () => {
        await ensureDeviceAppNotInstalled(DEVICE_ID!, BUNDLE_ID);
        deferCalculatorUninstallIfPresent(cleanup, DEVICE_ID!);
        const result = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
          derivedDataPath,
        });
        expectFixture(result, 'test--failure', 'error');
      }, 300_000);

      it('error - compiler error', async () => {
        await ensureDeviceAppNotInstalled(DEVICE_ID!, BUNDLE_ID);
        deferCalculatorUninstallIfPresent(cleanup, DEVICE_ID!);
        const result = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
          derivedDataPath,
          extraArgs: compilerErrorExtraArgs([
            '-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition',
          ]),
        });
        expectFixture(result, 'test--error-compiler', 'error');
      }, 300_000);
    });
  });
}
