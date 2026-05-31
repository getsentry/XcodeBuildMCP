import { execSync } from 'node:child_process';
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { clearAllProcesses } from '../../mcp/tools/swift-package/active-processes.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createMcpJsonSnapshotHarness } from '../json-harness.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const PACKAGE_PATH = 'example_projects/spm';

export function registerSwiftPackageSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'swift-package');

  describe(`${runtime} swift-package workflow`, () => {
    let harness: WorkflowSnapshotHarness;

    async function stopAllRunningSwiftPackageProcesses(): Promise<void> {
      const jsonHarness = await createMcpJsonSnapshotHarness();

      try {
        while (true) {
          const { text } = await jsonHarness.invoke('swift-package', 'list', {});
          const envelope = JSON.parse(text) as {
            data?: { processes?: Array<{ processId: number }> };
          };
          const processIds = envelope.data?.processes?.map((process) => process.processId) ?? [];

          if (processIds.length === 0) {
            return;
          }

          for (const processId of processIds) {
            await jsonHarness.invoke('swift-package', 'stop', { pid: processId });
          }
        }
      } finally {
        clearAllProcesses();
        await jsonHarness.cleanup();
      }
    }

    async function resetSwiftPackageState(): Promise<void> {
      try {
        execSync('node build/cli.js daemon stop 2>/dev/null || true', {
          encoding: 'utf8',
          cwd: process.cwd(),
        });
        execSync("pkill -f 'example_projects/spm' 2>/dev/null || true", { encoding: 'utf8' });
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // Ignore
      }
      clearAllProcesses();
    }

    beforeAll(async () => {
      vi.setConfig({ testTimeout: 120_000 });
      await resetSwiftPackageState();
      harness = await createHarnessForRuntime(runtime);
    }, 120_000);

    afterAll(async () => {
      await stopAllRunningSwiftPackageProcesses();
      await harness.cleanup();
      await resetSwiftPackageState();
    });

    describe('build', () => {
      it('success', async () => {
        const { text } = await harness.invoke('swift-package', 'build', {
          packagePath: PACKAGE_PATH,
        });
        expectFixture(text, 'build--success');
      }, 120_000);

      it('error - bad path', async () => {
        const { text } = await harness.invoke('swift-package', 'build', {
          packagePath: 'example_projects/NONEXISTENT',
        });
        expectFixture(text, 'build--error-bad-path');
      });
    });

    describe('test', () => {
      it('success', async () => {
        const { text } = await harness.invoke('swift-package', 'test', {
          packagePath: PACKAGE_PATH,
          filter: 'basicTruthTest',
        });
        expectFixture(text, 'test--success');
      }, 120_000);

      it('failure - intentional test failure', async () => {
        const { text } = await harness.invoke('swift-package', 'test', {
          packagePath: PACKAGE_PATH,
        });
        expectFixture(text, 'test--failure');
      }, 120_000);

      it('error - bad path', async () => {
        const { text } = await harness.invoke('swift-package', 'test', {
          packagePath: 'example_projects/NONEXISTENT',
        });
        expectFixture(text, 'test--error-bad-path');
      });
    });

    describe('clean', () => {
      it('success', async () => {
        const { text } = await harness.invoke('swift-package', 'clean', {
          packagePath: PACKAGE_PATH,
        });
        expectFixture(text, 'clean--success');
      });

      it('error - bad path', async () => {
        const { text } = await harness.invoke('swift-package', 'clean', {
          packagePath: 'example_projects/NONEXISTENT',
        });
        expectFixture(text, 'clean--error-bad-path');
      });
    });

    describe('run', () => {
      it('success', async () => {
        const { text } = await harness.invoke('swift-package', 'run', {
          packagePath: PACKAGE_PATH,
          executableName: 'spm',
        });
        expectFixture(text, 'run--success');
      }, 120_000);

      it('error - bad executable', async () => {
        const { text } = await harness.invoke('swift-package', 'run', {
          packagePath: PACKAGE_PATH,
          executableName: 'nonexistent-executable',
        });
        expectFixture(text, 'run--error-bad-executable');
      }, 120_000);
    });

    describe('list', () => {
      it('no processes', async () => {
        await stopAllRunningSwiftPackageProcesses();
        const { text } = await harness.invoke('swift-package', 'list', {});
        expectFixture(text, 'list--no-processes');
      });

      it('success', async () => {
        await stopAllRunningSwiftPackageProcesses();

        await harness.invoke('swift-package', 'run', {
          packagePath: PACKAGE_PATH,
          executableName: 'spm',
          background: true,
        });

        try {
          const { text } = await harness.invoke('swift-package', 'list', {});
          expectFixture(text, 'list--success');
        } finally {
          await stopAllRunningSwiftPackageProcesses();
        }
      }, 120_000);
    });

    describe('stop', () => {
      it('error - no process', async () => {
        const { text } = await harness.invoke('swift-package', 'stop', {
          pid: 999999,
        });
        expectFixture(text, 'stop--error-no-process');
      });
    });
  });
}
