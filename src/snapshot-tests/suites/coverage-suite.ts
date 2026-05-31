import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSimulatorBooted } from '../harness.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

export function registerCoverageSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'coverage');

  describe(`${runtime} coverage workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let xcresultPath: string;
    let invalidXcresultPath: string;

    beforeAll(async () => {
      vi.setConfig({ testTimeout: 120_000 });
      harness = await createHarnessForRuntime(runtime);
      await ensureSimulatorBooted('iPhone 17 Pro');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-snapshot-'));
      xcresultPath = path.join(tmpDir, 'TestResults.xcresult');
      const derivedDataPath = path.join(tmpDir, 'DerivedData');

      // Create a fake .xcresult directory that passes file-exists validation
      // but makes xcrun xccov fail with a real executable error
      invalidXcresultPath = path.join(tmpDir, 'invalid.xcresult');
      fs.mkdirSync(invalidXcresultPath);

      await harness.invoke('simulator', 'test', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        simulatorName: 'iPhone 17',
        derivedDataPath,
        extraArgs: ['-enableCodeCoverage', 'YES', '-resultBundlePath', xcresultPath],
      });

      if (!fs.existsSync(xcresultPath)) {
        throw new Error(`Failed to generate xcresult at ${xcresultPath}`);
      }
    }, 120_000);

    afterAll(async () => {
      await harness.cleanup();
      if (xcresultPath) {
        const tmpDir = path.dirname(xcresultPath);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe('get-coverage-report', () => {
      it('success', async () => {
        // Filter to CalculatorAppTests which is always present and deterministic.
        // The unfiltered report can include SPM framework targets non-deterministically.
        const { text } = await harness.invoke('coverage', 'get-coverage-report', {
          xcresultPath,
          target: 'CalculatorAppTests',
        });
        expectFixture(text, 'get-coverage-report--success');
      });

      it('error - invalid bundle', async () => {
        const { text } = await harness.invoke('coverage', 'get-coverage-report', {
          xcresultPath: invalidXcresultPath,
        });
        expectFixture(text, 'get-coverage-report--error-invalid-bundle');
      });
    });

    describe('get-file-coverage', () => {
      it('success', async () => {
        const { text } = await harness.invoke('coverage', 'get-file-coverage', {
          xcresultPath,
          file: 'CalculatorService.swift',
        });
        expectFixture(text, 'get-file-coverage--success');
      });

      it('error - invalid bundle', async () => {
        const { text } = await harness.invoke('coverage', 'get-file-coverage', {
          xcresultPath: invalidXcresultPath,
          file: 'SomeFile.swift',
        });
        expectFixture(text, 'get-file-coverage--error-invalid-bundle');
      });
    });
  });
}
