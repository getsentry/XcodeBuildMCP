import { describe, it, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSimulatorBooted } from '../harness.ts';
import {
  isMcpSnapshotRuntime,
  type SnapshotRuntime,
  type WorkflowSnapshotHarness,
} from '../contracts.ts';
import { extractAppPathFromSnapshotResult } from '../output-parsers.ts';
import {
  compilerErrorExtraArgs,
  createHarnessForRuntime,
  createWorkflowFixtureMatcher,
} from './helpers.ts';

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
          const { text } = await harness.invoke('simulator', 'build', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'build--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text } = await harness.invoke('simulator', 'build', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'build--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - compiler error',
        async () => {
          const { text } = await harness.invoke('simulator', 'build', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
            extraArgs: compilerErrorExtraArgs(),
          });
          expectFixture(text, 'build--error-compiler');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('build-and-run', () => {
      it(
        'success',
        async () => {
          const { text } = await harness.invoke('simulator', 'build-and-run', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'build-and-run--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text } = await harness.invoke('simulator', 'build-and-run', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'build-and-run--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - compiler error',
        async () => {
          const { text } = await harness.invoke('simulator', 'build-and-run', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
            extraArgs: compilerErrorExtraArgs(),
          });
          expectFixture(text, 'build-and-run--error-compiler');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('test', () => {
      it(
        'success',
        async () => {
          const { text } = await harness.invoke('simulator', 'test', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
            extraArgs: ['-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition'],
          });
          expectFixture(text, 'test--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'failure - intentional test failure',
        async () => {
          const { text } = await harness.invoke('simulator', 'test', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'test--failure');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text } = await harness.invoke('simulator', 'test', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'test--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - compiler error',
        async () => {
          const { text } = await harness.invoke('simulator', 'test', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            simulatorName: SIMULATOR_NAME,
            extraArgs: compilerErrorExtraArgs([
              '-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition',
            ]),
          });
          expectFixture(text, 'test--error-compiler');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('get-app-path', () => {
      it(
        'success',
        async () => {
          const { text } = await harness.invoke('simulator', 'get-app-path', {
            workspacePath: WORKSPACE,
            scheme: SCHEME,
            platform: IOS_SIMULATOR_PLATFORM,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'get-app-path--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - wrong scheme',
        async () => {
          const { text } = await harness.invoke('simulator', 'get-app-path', {
            workspacePath: WORKSPACE,
            scheme: INVALID_SCHEME,
            platform: IOS_SIMULATOR_PLATFORM,
            simulatorName: SIMULATOR_NAME,
          });
          expectFixture(text, 'get-app-path--error-wrong-scheme');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('list', () => {
      it('success', async () => {
        const { text } = await harness.invoke('simulator', 'list', {});
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

          const appPath = extractAppPathFromSnapshotResult(appPathResult);

          const { text } = await harness.invoke('simulator', 'install', {
            simulatorId: simulatorUdid,
            appPath,
          });
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
          const { text } = await harness.invoke('simulator', 'launch-app', {
            simulatorId: simulatorUdid,
            bundleId: CALCULATOR_BUNDLE_ID,
          });
          expectFixture(text, 'launch-app--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - not installed',
        async () => {
          const { text } = await harness.invoke('simulator', 'launch-app', {
            simulatorId: simulatorUdid,
            bundleId: NONEXISTENT_BUNDLE_ID,
          });
          expectFixture(text, 'launch-app--error-not-installed');
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('screenshot', () => {
      it(
        'success',
        async () => {
          const { text } = await harness.invoke('simulator', 'screenshot', {
            simulatorId: simulatorUdid,
            returnFormat: 'path',
          });
          expectFixture(text, 'screenshot--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - invalid simulator',
        async () => {
          const { text } = await harness.invoke('simulator', 'screenshot', {
            simulatorId: '00000000-0000-0000-0000-000000000000',
            returnFormat: 'path',
          });
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

          const { text } = await harness.invoke('simulator', 'stop', {
            simulatorId: simulatorUdid,
            bundleId: CALCULATOR_BUNDLE_ID,
          });
          expectFixture(text, 'stop--success');
        },
        TEST_TIMEOUT_MS,
      );

      it(
        'error - no app',
        async () => {
          const { text } = await harness.invoke('simulator', 'stop', {
            simulatorId: simulatorUdid,
            bundleId: NONEXISTENT_BUNDLE_ID,
          });
          expectFixture(text, 'stop--error-no-app');
        },
        TEST_TIMEOUT_MS,
      );
    });

    if (isMcpSnapshotRuntime(runtime) && runtime !== 'mcp/json') {
      describe('mcp-only extras', () => {
        beforeEach(async () => {
          await harness.invoke('session-management', 'clear-defaults', { all: true });
        });

        // MCP disables session-default hydration in the snapshot harness, while the CLI surface
        // validates and hydrates arguments differently. This makes the empty-args build failure
        // a transport-specific MCP snapshot rather than a shared CLI/MCP parity case.
        it('build -- error missing params', async () => {
          const { text } = await harness.invoke('simulator', 'build', {});
          expectFixture(text, 'build--error-missing-params');
        });
      });
    }
  });
}
