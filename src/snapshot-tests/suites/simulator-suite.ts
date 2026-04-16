import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSimulatorBooted } from '../harness.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { extractAppPathFromSnapshotOutput } from '../output-parsers.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const TEST_TIMEOUT_MS = 120_000;
const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const SCHEME = 'CalculatorApp';
const INVALID_SCHEME = 'NONEXISTENT';
const SIMULATOR_NAME = 'iPhone 17';
const PRIMARY_BOOTED_SIMULATOR = 'iPhone 17 Pro';
const IOS_SIMULATOR_PLATFORM = 'iOS Simulator';
const CALCULATOR_BUNDLE_ID = 'io.sentry.calculatorapp';
const NONEXISTENT_BUNDLE_ID = 'com.nonexistent.app';

export function registerSimulatorSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'simulator');

  describe(`${runtime} simulator workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let simulatorUdid: string;

    beforeAll(async () => {
      vi.setConfig({ testTimeout: TEST_TIMEOUT_MS });
      harness = await createHarnessForRuntime(runtime);
      simulatorUdid = await ensureSimulatorBooted(PRIMARY_BOOTED_SIMULATOR);
    }, TEST_TIMEOUT_MS);

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('build', () => {
      it(
        'success',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'build', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(false);
          expect(text.length).toBeGreaterThan(10);
          expectFixture(text, 'build--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'build', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(true);
          expectFixture(text, 'build--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('build-and-run', () => {
      it(
        'success',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'build-and-run', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(false);
          expect(text.length).toBeGreaterThan(10);
          expectFixture(text, 'build-and-run--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'build-and-run', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(true);
          expectFixture(text, 'build-and-run--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('test', () => {
      it(
        'success',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'test', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
            extraArgs: ['-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition'],
          });
          expect(isError).toBe(false);
          expect(text.length).toBeGreaterThan(10);
          expectFixture(text, 'test--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'failure - intentional test failure',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'test', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(true);
          expect(text.length).toBeGreaterThan(10);
          expectFixture(text, 'test--failure');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'test', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(true);
          expectFixture(text, 'test--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('get-app-path', () => {
      it(
        'success',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'get-app-path', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            platform: IOS_SIMULATOR_PLATFORM,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(false);
          expect(text.length).toBeGreaterThan(10);
          expectFixture(text, 'get-app-path--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'get-app-path', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            platform: IOS_SIMULATOR_PLATFORM,
            simulatorName: SIMULATOR_NAME,
          });
          expect(isError).toBe(true);
          expectFixture(text, 'get-app-path--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('list', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('simulator', 'list', {});
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'list--success');
      });
    });

    describe('install', () => {
      it(
        'success',
        async () => {
          const appPathResult = await harness.invoke('simulator', 'get-app-path', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            platform: IOS_SIMULATOR_PLATFORM,
            simulatorName: SIMULATOR_NAME,
          });
          expect(appPathResult.isError).toBe(false);

          const appPath = extractAppPathFromSnapshotOutput(appPathResult.rawText);

          const { text, isError } = await harness.invoke('simulator', 'install', {
            simulatorId: simulatorUdid,
            appPath,
          });
          expect(isError).toBe(false);
          expectFixture(text, 'install--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - invalid app',
        async () => {
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-install-'));
          const fakeApp = path.join(tmpDir, 'NotAnApp.app');
          fs.mkdirSync(fakeApp);
          try {
            const { text } = await harness.invoke('simulator', 'install', {
              simulatorId: simulatorUdid,
              appPath: fakeApp,
            });
            expect(text.length).toBeGreaterThan(0);
            expectFixture(text, 'install--error-invalid-app');
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('launch-app', () => {
      it(
        'success',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'launch-app', {
            simulatorId: simulatorUdid,
            bundleId: CALCULATOR_BUNDLE_ID,
          });
          expect(isError).toBe(false);
          expectFixture(text, 'launch-app--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - not installed',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'launch-app', {
            simulatorId: simulatorUdid,
            bundleId: NONEXISTENT_BUNDLE_ID,
          });
          expect(isError).toBe(true);
          expectFixture(text, 'launch-app--error-not-installed');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('screenshot', () => {
      it(
        'success',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'screenshot', {
            simulatorId: simulatorUdid,
            returnFormat: 'path',
          });
          expect(isError).toBe(false);
          expectFixture(text, 'screenshot--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - invalid simulator',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'screenshot', {
            simulatorId: '00000000-0000-0000-0000-000000000000',
            returnFormat: 'path',
          });
          expect(isError).toBe(true);
          expectFixture(text, 'screenshot--error-invalid-simulator');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('stop', () => {
      it(
        'success',
        async () => {
          await harness.invoke('simulator', 'launch-app', {
            simulatorId: simulatorUdid,
            bundleId: CALCULATOR_BUNDLE_ID,
          });

          const { text, isError } = await harness.invoke('simulator', 'stop', {
            simulatorId: simulatorUdid,
            bundleId: CALCULATOR_BUNDLE_ID,
          });
          expect(isError).toBe(false);
          expectFixture(text, 'stop--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - no app',
        async () => {
          const { text, isError } = await harness.invoke('simulator', 'stop', {
            simulatorId: simulatorUdid,
            bundleId: NONEXISTENT_BUNDLE_ID,
          });
          expect(isError).toBe(true);
          expectFixture(text, 'stop--error-no-app');
        },
        TEST_TIMEOUT_MS,
      );
    });

    if (runtime !== 'cli') {
      describe('mcp-only extras', () => {
        beforeEach(async () => {
          await harness.invoke('session-management', 'clear-defaults', { all: true });
        });

        // MCP disables session-default hydration in the snapshot harness, while the CLI surface
        // validates and hydrates arguments differently. This makes the empty-args build failure
        // a transport-specific MCP snapshot rather than a shared CLI/MCP parity case.
        it('build -- error missing params', async () => {
          if (runtime === 'json') {
            await expect(harness.invoke('simulator', 'build', {})).rejects.toThrow(
              'Structured output missing for simulator/build',
            );
            return;
          }

          const { text, isError } = await harness.invoke('simulator', 'build', {});
          expect(isError).toBe(true);
          expectFixture(text, 'build--error-missing-params');
        });
      });
    }
  });
}
