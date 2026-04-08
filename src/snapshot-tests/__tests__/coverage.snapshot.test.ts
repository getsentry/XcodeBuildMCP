import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshotHarness, ensureSimulatorBooted } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('coverage workflow', () => {
  let harness: SnapshotHarness;
  let xcresultPath: string;
  let invalidXcresultPath: string;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 120_000 });
    harness = await createSnapshotHarness();
    await ensureSimulatorBooted('iPhone 17');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-snapshot-'));
    xcresultPath = path.join(tmpDir, 'TestResults.xcresult');
    const derivedDataPath = path.join(tmpDir, 'DerivedData');

    // Create a fake .xcresult directory that passes file-exists validation
    // but makes xcrun xccov fail with a real executable error
    invalidXcresultPath = path.join(tmpDir, 'invalid.xcresult');
    fs.mkdirSync(invalidXcresultPath);

    // Uses a fresh derived data path to ensure a fully clean build so coverage
    // targets are deterministic. The Calculator example app has an intentionally
    // failing test, so xcodebuild exits non-zero but the xcresult is still produced.
    try {
      execSync(
        [
          'xcodebuild test',
          `-workspace ${WORKSPACE}`,
          '-scheme CalculatorApp',
          "-destination 'platform=iOS Simulator,name=iPhone 17'",
          '-enableCodeCoverage YES',
          `-derivedDataPath ${derivedDataPath}`,
          `-resultBundlePath ${xcresultPath}`,
          '-quiet',
        ].join(' '),
        { encoding: 'utf8', timeout: 120_000, stdio: 'pipe' },
      );
    } catch {
      // Expected: test suite has an intentional failure
    }

    if (!fs.existsSync(xcresultPath)) {
      throw new Error(`Failed to generate xcresult at ${xcresultPath}`);
    }
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
    if (xcresultPath) {
      const tmpDir = path.dirname(xcresultPath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('get-coverage-report', () => {
    it('success', async () => {
      // Filter to CalculatorAppTests which is always present and deterministic.
      // The unfiltered report can include SPM framework targets non-deterministically.
      const { text, isError } = await harness.invoke('coverage', 'get-coverage-report', {
        xcresultPath,
        target: 'CalculatorAppTests',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'get-coverage-report--success');
    });

    it('error - invalid bundle', async () => {
      const { text, isError } = await harness.invoke('coverage', 'get-coverage-report', {
        xcresultPath: invalidXcresultPath,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'get-coverage-report--error-invalid-bundle');
    });
  });

  describe('get-file-coverage', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('coverage', 'get-file-coverage', {
        xcresultPath,
        file: 'CalculatorService.swift',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'get-file-coverage--success');
    });

    it('error - invalid bundle', async () => {
      const { text, isError } = await harness.invoke('coverage', 'get-file-coverage', {
        xcresultPath: invalidXcresultPath,
        file: 'SomeFile.swift',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'get-file-coverage--error-invalid-bundle');
    });
  });
});
