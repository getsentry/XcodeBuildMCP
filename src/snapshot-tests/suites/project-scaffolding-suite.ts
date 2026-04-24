import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

export function registerProjectScaffoldingSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'project-scaffolding');

  describe(`${runtime} project-scaffolding workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let tmpDir: string;

    beforeAll(async () => {
      harness = await createHarnessForRuntime(runtime);
      tmpDir = mkdtempSync(join(tmpdir(), 'xbm-scaffold-'));
    });

    afterAll(async () => {
      await harness.cleanup();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('scaffold-ios', () => {
      it('success', async () => {
        const outputPath = join(tmpDir, 'ios');
        const { text, isError } = await harness.invoke('project-scaffolding', 'scaffold-ios', {
          projectName: 'SnapshotTestApp',
          outputPath,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'scaffold-ios--success');
      }, 120000);

      it('error - existing project', async () => {
        const outputPath = join(tmpDir, 'ios-existing');
        mkdirSync(outputPath, { recursive: true });

        await harness.invoke('project-scaffolding', 'scaffold-ios', {
          projectName: 'SnapshotTestApp',
          outputPath,
        });

        const { text, isError } = await harness.invoke('project-scaffolding', 'scaffold-ios', {
          projectName: 'SnapshotTestApp',
          outputPath,
        });
        expect(isError).toBe(true);
        expectFixture(text, 'scaffold-ios--error-existing');
      }, 120000);
    });

    describe('scaffold-macos', () => {
      it('success', async () => {
        const outputPath = join(tmpDir, 'macos');
        const { text, isError } = await harness.invoke('project-scaffolding', 'scaffold-macos', {
          projectName: 'SnapshotTestMacApp',
          outputPath,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'scaffold-macos--success');
      }, 120000);

      it('error - existing project', async () => {
        const outputPath = join(tmpDir, 'macos-existing');
        mkdirSync(outputPath, { recursive: true });

        await harness.invoke('project-scaffolding', 'scaffold-macos', {
          projectName: 'SnapshotTestMacApp',
          outputPath,
        });

        const { text, isError } = await harness.invoke('project-scaffolding', 'scaffold-macos', {
          projectName: 'SnapshotTestMacApp',
          outputPath,
        });
        expect(isError).toBe(true);
        expectFixture(text, 'scaffold-macos--error-existing');
      }, 120000);
    });
  });
}
