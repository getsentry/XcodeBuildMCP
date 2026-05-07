import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  getWorkspaceFilesystemLayout,
  getWorkspacesDir,
  setXcodeBuildMCPAppDirOverrideForTests,
} from '../log-paths.ts';

describe('log paths', () => {
  afterEach(() => {
    setXcodeBuildMCPAppDirOverrideForTests(null);
  });

  it('builds the workspace-first filesystem layout', () => {
    const appDir = path.join('/tmp', 'xcodebuildmcp-app');
    setXcodeBuildMCPAppDirOverrideForTests(appDir);

    const layout = getWorkspaceFilesystemLayout('workspace-a');

    expect(getWorkspacesDir()).toBe(path.join(appDir, 'workspaces'));
    expect(layout).toMatchObject({
      workspaceKey: 'workspace-a',
      root: path.join(appDir, 'workspaces', 'workspace-a'),
      logs: path.join(appDir, 'workspaces', 'workspace-a', 'logs'),
      state: path.join(appDir, 'workspaces', 'workspace-a', 'state'),
      locks: path.join(appDir, 'workspaces', 'workspace-a', 'locks'),
      derivedData: path.join(appDir, 'workspaces', 'workspace-a', 'DerivedData'),
      resultBundles: path.join(appDir, 'workspaces', 'workspace-a', 'result-bundles'),
      logRetention: {
        lockDir: path.join(appDir, 'workspaces', 'workspace-a', 'locks', 'log-retention.lock'),
        markerPath: path.join(
          appDir,
          'workspaces',
          'workspace-a',
          'state',
          'log-retention',
          'last-cleanup',
        ),
      },
      filesystemLifecycle: {
        lockDir: path.join(
          appDir,
          'workspaces',
          'workspace-a',
          'locks',
          'filesystem-lifecycle.lock',
        ),
        markerPath: path.join(
          appDir,
          'workspaces',
          'workspace-a',
          'state',
          'filesystem-lifecycle',
          'last-cleanup',
        ),
      },
      simulatorLaunchOsLogRegistryDir: path.join(
        appDir,
        'workspaces',
        'workspace-a',
        'state',
        'simulator-launch-oslog',
      ),
    });
  });
});
