import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { executionToJson, planToJson } from '../purge-ui.ts';
import type {
  PurgeStorageExecutionResult,
  PurgeStoragePlan,
  PurgeStorageReport,
} from '../../../utils/purge-storage.ts';

function minimalReport(): PurgeStorageReport {
  return {
    appRoot: process.cwd(),
    workspacesDir: path.join(process.cwd(), 'tmp', 'workspaces'),
    workspaces: [],
    families: [],
    totals: { bytes: 0, fileCount: 0, directoryCount: 0 },
    warnings: [],
  };
}

describe('purge UI JSON', () => {
  it('sanitizes skipped reasons in plan JSON', () => {
    const rawPath = path.join(process.cwd(), 'tmp', 'purge-json', 'active.log');
    const displayFriendlyPath = path.join('tmp', 'purge-json', 'active.log');
    const plan: PurgeStoragePlan = {
      action: 'dry-run',
      scope: { type: 'workspace', workspaceKey: 'DemoApp-123456789abc' },
      classes: ['logs'],
      report: minimalReport(),
      selectedWorkspaceKeys: ['DemoApp-123456789abc'],
      candidates: [],
      skipped: [
        {
          workspaceKey: 'DemoApp-123456789abc',
          storageClass: 'logs',
          path: rawPath,
          reason: `refused to delete ${rawPath}`,
        },
      ],
      totals: { bytes: 0, fileCount: 0, directoryCount: 0, candidateCount: 0 },
      warnings: [],
    };

    const output = planToJson(plan) as { skipped: Array<{ path: string; reason: string }> };

    expect(JSON.stringify(output)).not.toContain(rawPath);
    expect(output.skipped[0]).toMatchObject({
      path: displayFriendlyPath,
      reason: `refused to delete ${displayFriendlyPath}`,
    });
  });

  it('sanitizes skipped reasons in execution JSON', () => {
    const rawPath = path.join(process.cwd(), 'tmp', 'purge-json', 'active.log');
    const displayFriendlyPath = path.join('tmp', 'purge-json', 'active.log');
    const result: PurgeStorageExecutionResult = {
      action: 'delete',
      scope: { type: 'workspace', workspaceKey: 'DemoApp-123456789abc' },
      classes: ['logs'],
      selectedWorkspaceKeys: ['DemoApp-123456789abc'],
      deleted: [],
      skipped: [
        {
          workspaceKey: 'DemoApp-123456789abc',
          storageClass: 'logs',
          path: rawPath,
          reason: `refused to delete ${rawPath}`,
        },
      ],
      totals: { bytes: 0, deletedCount: 0, skippedCount: 1 },
      warnings: [],
    };

    const output = executionToJson(result) as {
      skipped: Array<{ path: string; reason: string }>;
    };

    expect(JSON.stringify(output)).not.toContain(rawPath);
    expect(output.skipped[0]).toMatchObject({
      path: displayFriendlyPath,
      reason: `refused to delete ${displayFriendlyPath}`,
    });
  });
});
