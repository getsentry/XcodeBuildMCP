import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

function normalizeTmpDir(text: string, tmpDir: string): string {
  const escaped = tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'g'), '<TMPDIR>');
}

describe('project-scaffolding workflow', () => {
  let harness: SnapshotHarness;
  let tmpDir: string;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
    tmpDir = mkdtempSync(join(tmpdir(), 'xbm-scaffold-'));
  });

  afterAll(() => {
    harness.cleanup();
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
      expectMatchesFixture(normalizeTmpDir(text, tmpDir), __filename, 'scaffold-ios--success');
    }, 120000);

    it('error - existing project', async () => {
      const outputPath = join(tmpDir, 'ios-existing');
      mkdirSync(outputPath, { recursive: true });

      // Scaffold once to create the project files
      await harness.invoke('project-scaffolding', 'scaffold-ios', {
        projectName: 'SnapshotTestApp',
        outputPath,
      });

      // Scaffold again into the same directory to trigger the error
      const { text, isError } = await harness.invoke('project-scaffolding', 'scaffold-ios', {
        projectName: 'SnapshotTestApp',
        outputPath,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(
        normalizeTmpDir(text, tmpDir),
        __filename,
        'scaffold-ios--error-existing',
      );
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
      expectMatchesFixture(normalizeTmpDir(text, tmpDir), __filename, 'scaffold-macos--success');
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
      expectMatchesFixture(
        normalizeTmpDir(text, tmpDir),
        __filename,
        'scaffold-macos--error-existing',
      );
    }, 120000);
  });
});
