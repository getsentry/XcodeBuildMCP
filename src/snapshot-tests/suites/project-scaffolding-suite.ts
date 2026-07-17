import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowResultFixtureMatcher } from './helpers.ts';

export function registerProjectScaffoldingSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowResultFixtureMatcher(runtime, 'project-scaffolding');

  describe(`${runtime} project-scaffolding workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let tmpDir: string;

    beforeEach(async () => {
      harness = await createHarnessForRuntime(runtime);
      tmpDir = mkdtempSync(join(tmpdir(), 'xbm-scaffold-'));
    });

    afterEach(async () => {
      try {
        await harness.cleanup();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe('scaffold-ios', () => {
      it('success', async () => {
        const result = await harness.invoke('project-scaffolding', 'scaffold-ios', {
          projectName: 'SnapshotTestApp',
          outputPath: join(tmpDir, 'ios'),
        });
        expectFixture(result, 'scaffold-ios--success', 'success');
      }, 120000);

      it('error - existing project', async () => {
        const outputPath = join(tmpDir, 'ios-existing');
        mkdirSync(join(outputPath, 'SnapshotTestApp.xcworkspace'), { recursive: true });

        const result = await harness.invoke('project-scaffolding', 'scaffold-ios', {
          projectName: 'SnapshotTestApp',
          outputPath,
        });
        expectFixture(result, 'scaffold-ios--error-existing', 'error');
      }, 120000);
    });

    describe('scaffold-macos', () => {
      it('success', async () => {
        const result = await harness.invoke('project-scaffolding', 'scaffold-macos', {
          projectName: 'SnapshotTestMacApp',
          outputPath: join(tmpDir, 'macos'),
        });
        expectFixture(result, 'scaffold-macos--success', 'success');
      }, 120000);

      it('error - existing project', async () => {
        const outputPath = join(tmpDir, 'macos-existing');
        mkdirSync(join(outputPath, 'SnapshotTestMacApp.xcworkspace'), { recursive: true });

        const result = await harness.invoke('project-scaffolding', 'scaffold-macos', {
          projectName: 'SnapshotTestMacApp',
          outputPath,
        });
        expectFixture(result, 'scaffold-macos--error-existing', 'error');
      }, 120000);
    });
  });
}
