import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';
const DEVICE_ID = process.env.DEVICE_ID;

interface DeviceCtlLaunchResult {
  result?: {
    process?: {
      processIdentifier?: number;
    };
  };
}

export function registerDeviceSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'device');
  const expectCanonicalFixture = createWorkflowFixtureMatcher(runtime, 'device', {
    fixtureRuntime: 'cli',
  });

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
        expectCanonicalFixture(text, 'build--success');
      });

      it('error - wrong scheme', async () => {
        const { text, isError } = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectCanonicalFixture(text, 'build--error-wrong-scheme');
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
        expectCanonicalFixture(text, 'get-app-path--success');
      });

      it('error - wrong scheme', async () => {
        const { text, isError } = await harness.invoke('device', 'get-app-path', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectCanonicalFixture(text, 'get-app-path--error-wrong-scheme');
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

    describe.runIf(DEVICE_ID)('build-and-run (requires device)', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('device', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectCanonicalFixture(text, 'build-and-run--success');
      });
    });

    describe.runIf(DEVICE_ID)('install (requires device)', () => {
      it('success', async () => {
        const appPathOutput = execSync(
          [
            'xcodebuild -workspace',
            WORKSPACE,
            '-scheme CalculatorApp',
            `-destination 'id=${DEVICE_ID}'`,
            '-showBuildSettings',
          ].join(' '),
          { encoding: 'utf8', timeout: 30_000, stdio: 'pipe' },
        );
        const builtProductsDir = appPathOutput
          .split('\n')
          .find((line) => line.includes('BUILT_PRODUCTS_DIR'))
          ?.split('=')[1]
          ?.trim();
        const appPath = `${builtProductsDir}/CalculatorApp.app`;

        const { text, isError } = await harness.invoke('device', 'install', {
          deviceId: DEVICE_ID,
          appPath,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'install--success');
      }, 60_000);
    });

    describe.runIf(DEVICE_ID)('launch (requires device)', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('device', 'launch', {
          deviceId: DEVICE_ID,
          bundleId: BUNDLE_ID,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'launch--success');
      }, 60_000);
    });

    describe.runIf(DEVICE_ID)('stop (requires device)', () => {
      it('success', async () => {
        const tmpJson = `/tmp/devicectl-launch-${Date.now()}.json`;
        execSync(
          `xcrun devicectl device process launch --device ${DEVICE_ID} ${BUNDLE_ID} --json-output ${tmpJson}`,
          { encoding: 'utf8', timeout: 30_000, stdio: 'pipe' },
        );
        const launchData = JSON.parse(fs.readFileSync(tmpJson, 'utf8')) as DeviceCtlLaunchResult;
        fs.unlinkSync(tmpJson);
        const pid = launchData?.result?.process?.processIdentifier;
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

    describe.runIf(DEVICE_ID)('test (requires device)', () => {
      it('success - targeted passing test', async () => {
        const { text, isError } = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
          extraArgs: ['-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition'],
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectCanonicalFixture(text, 'test--success');
      }, 300_000);

      it('failure - intentional test failure', async () => {
        const { text, isError } = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: DEVICE_ID,
        });
        expect(isError).toBe(true);
        expect(text.length).toBeGreaterThan(10);
        expectCanonicalFixture(text, 'test--failure');
      }, 300_000);
    });
  });
}
