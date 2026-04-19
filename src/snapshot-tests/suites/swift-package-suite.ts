import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { clearAllProcesses } from '../../mcp/tools/swift-package/active-processes.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const PACKAGE_PATH = 'example_projects/spm';

export function registerSwiftPackageSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'swift-package');

  describe(`${runtime} swift-package workflow`, () => {
    let harness: WorkflowSnapshotHarness;

    beforeAll(async () => {
      vi.setConfig({ testTimeout: 120_000 });
      harness = await createHarnessForRuntime(runtime);
    }, 120_000);

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('build', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'build', {
          packagePath: PACKAGE_PATH,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'build--success');
      }, 120_000);

      it('error - bad path', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'build', {
          packagePath: 'example_projects/NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'build--error-bad-path');
      });
    });

    describe('test', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'test', {
          packagePath: PACKAGE_PATH,
          filter: 'basicTruthTest',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'test--success');
      }, 120_000);

      it('failure - intentional test failure', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'test', {
          packagePath: PACKAGE_PATH,
        });
        expect(isError).toBe(true);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'test--failure');
      }, 120_000);

      it('error - bad path', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'test', {
          packagePath: 'example_projects/NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'test--error-bad-path');
      });
    });

    describe('clean', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'clean', {
          packagePath: PACKAGE_PATH,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'clean--success');
      });

      it('error - bad path', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'clean', {
          packagePath: 'example_projects/NONEXISTENT',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'clean--error-bad-path');
      });
    });

    describe('run', () => {
      it('success', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'run', {
          packagePath: PACKAGE_PATH,
          executableName: 'spm',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(0);
        expectFixture(text, 'run--success');
      }, 120_000);

      it('error - bad executable', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'run', {
          packagePath: PACKAGE_PATH,
          executableName: 'nonexistent-executable',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'run--error-bad-executable');
      }, 120_000);
    });

    describe('list', () => {
      it('no processes', async () => {
        clearAllProcesses();
        const { text, isError } = await harness.invoke('swift-package', 'list', {});
        expect(isError).toBe(false);
        expectFixture(text, 'list--no-processes');
      });

      it('success', async () => {
        await harness.invoke('swift-package', 'run', {
          packagePath: PACKAGE_PATH,
          executableName: 'spm',
          background: true,
        });

        try {
          const { text, isError } = await harness.invoke('swift-package', 'list', {});
          expect(isError).toBe(false);
          expectFixture(text, 'list--success');
        } finally {
          clearAllProcesses();
        }
      }, 120_000);
    });

    describe('stop', () => {
      it('error - no process', async () => {
        const { text, isError } = await harness.invoke('swift-package', 'stop', {
          pid: 999999,
        });
        expect(isError).toBe(true);
        expectFixture(text, 'stop--error-no-process');
      });
    });
  });
}
