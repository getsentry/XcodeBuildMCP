import path from 'node:path';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  computeScopedDerivedDataPath,
  resolveEffectiveDerivedDataPath,
} from '../derived-data-path.ts';
import { DERIVED_DATA_DIR } from '../log-paths.ts';

describe('resolveEffectiveDerivedDataPath', () => {
  it('returns the global DerivedData root when no explicit path or anchor is present', () => {
    expect(resolveEffectiveDerivedDataPath()).toBe(DERIVED_DATA_DIR);
    expect(
      resolveEffectiveDerivedDataPath({
        derivedDataPath: ' ',
        workspacePath: '\t',
        projectPath: '',
      }),
    ).toBe(DERIVED_DATA_DIR);
  });

  it('uses an explicit absolute derivedDataPath', () => {
    expect(resolveEffectiveDerivedDataPath({ derivedDataPath: '/tmp/DerivedData' })).toBe(
      '/tmp/DerivedData',
    );
  });

  it('resolves an explicit relative derivedDataPath from cwd', () => {
    expect(
      resolveEffectiveDerivedDataPath({ derivedDataPath: '.derivedData/app', cwd: '/repo' }),
    ).toBe('/repo/.derivedData/app');
  });

  it('expands a bare ~ explicit derivedDataPath to the home directory', () => {
    expect(resolveEffectiveDerivedDataPath({ derivedDataPath: '~' })).toBe(homedir());
  });

  it('expands a ~/-prefixed explicit derivedDataPath under the home directory', () => {
    expect(resolveEffectiveDerivedDataPath({ derivedDataPath: '~/.foo/derivedData' })).toBe(
      path.join(homedir(), '.foo/derivedData'),
    );
  });

  it('scopes DerivedData from workspacePath when derivedDataPath is absent', () => {
    const workspacePath = '/Users/dev/clone-1/MyApp.xcworkspace';

    expect(resolveEffectiveDerivedDataPath({ workspacePath })).toBe(
      computeScopedDerivedDataPath(workspacePath),
    );
  });

  it('prefers workspacePath over projectPath when both anchors are present', () => {
    const workspacePath = '/Users/dev/clone-1/MyApp.xcworkspace';
    const projectPath = '/Users/dev/clone-1/MyApp.xcodeproj';

    expect(resolveEffectiveDerivedDataPath({ workspacePath, projectPath })).toBe(
      computeScopedDerivedDataPath(workspacePath),
    );
  });

  it('scopes DerivedData from projectPath when workspacePath is absent', () => {
    const projectPath = '/Users/dev/clone-2/MyApp.xcodeproj';

    expect(resolveEffectiveDerivedDataPath({ projectPath })).toBe(
      computeScopedDerivedDataPath(projectPath),
    );
  });

  it('resolves relative workspace anchors before hashing', () => {
    const cwd = '/Users/dev/repo';
    const workspacePath = 'App/MyApp.xcworkspace';

    expect(resolveEffectiveDerivedDataPath({ workspacePath, cwd })).toBe(
      computeScopedDerivedDataPath(workspacePath, cwd),
    );
  });

  it('expands a ~/-prefixed workspace anchor before hashing', () => {
    const workspacePath = '~/clone/MyApp.xcworkspace';

    expect(resolveEffectiveDerivedDataPath({ workspacePath })).toBe(
      computeScopedDerivedDataPath(path.join(homedir(), 'clone/MyApp.xcworkspace')),
    );
  });

  it('produces different scoped paths for matching basenames in different directories', () => {
    const firstPath = computeScopedDerivedDataPath('/clone-1/MyApp.xcworkspace');
    const secondPath = computeScopedDerivedDataPath('/clone-2/MyApp.xcworkspace');

    expect(firstPath).toMatch(/MyApp-[a-f0-9]{12}$/);
    expect(secondPath).toMatch(/MyApp-[a-f0-9]{12}$/);
    expect(firstPath).not.toBe(secondPath);
  });
});
