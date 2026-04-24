import { describe, expect, it } from 'vitest';
import {
  appPathErrorMessages,
  buildAppPathFailure,
  buildAppPathSuccess,
  buildBundleIdResult,
} from '../app-query-results.ts';

describe('app query results', () => {
  it('keeps app path failure errors short while preserving query diagnostics', () => {
    const result = buildAppPathFailure(
      'xcodebuild: error: Scheme "Missing" is not configured for running.',
      { workspacePath: '/tmp/App.xcworkspace', scheme: 'Missing' },
      'simulator',
      'Failed to get app path.',
    );

    expect(result).toEqual({
      kind: 'app-path',
      didError: true,
      error: 'Failed to get app path.',
      request: { workspacePath: '/tmp/App.xcworkspace', scheme: 'Missing' },
      summary: { status: 'FAILED', target: 'simulator' },
      diagnostics: {
        warnings: [],
        errors: [{ message: 'Scheme "Missing" is not configured for running.' }],
      },
    });
  });

  it('preserves original query lines for unparsable app path failures', () => {
    const result = buildAppPathFailure(
      'timestamped xcodebuild detail\nraw failure detail',
      { projectPath: '/tmp/App.xcodeproj' },
      'device',
      'Query failed.',
    );

    expect(result.error).toBe('Query failed.');
    expect(result).toHaveProperty('diagnostics');
    expect(result.diagnostics?.errors).toEqual([
      { message: 'timestamped xcodebuild detail' },
      { message: 'raw failure detail' },
    ]);
    expect(appPathErrorMessages('raw failure detail')).toEqual(['raw failure detail']);
  });

  it('builds app path success results without diagnostics', () => {
    expect(buildAppPathSuccess('/tmp/App.app', {}, 'macos')).toEqual({
      kind: 'app-path',
      didError: false,
      error: null,
      request: {},
      summary: { status: 'SUCCEEDED', target: 'macos' },
      artifacts: { appPath: '/tmp/App.app' },
    });
  });

  it('builds bundle ID failures with short errors and diagnostics', () => {
    expect(
      buildBundleIdResult('/tmp/App.app', undefined, 'Failed to get bundle ID.', {
        warnings: [],
        errors: [{ message: 'File not found: /tmp/App.app' }],
      }),
    ).toEqual({
      kind: 'bundle-id',
      didError: true,
      error: 'Failed to get bundle ID.',
      artifacts: { appPath: '/tmp/App.app' },
      diagnostics: {
        warnings: [],
        errors: [{ message: 'File not found: /tmp/App.app' }],
      },
    });
  });
});
