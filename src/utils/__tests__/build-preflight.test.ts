import { describe, it, expect } from 'vitest';
import { displayPath, formatToolPreflight } from '../build-preflight.ts';
import { computeScopedDerivedDataPath } from '../derived-data-path.ts';
import { DERIVED_DATA_DIR } from '../log-paths.ts';

const DISPLAY_DERIVED_DATA = displayPath(DERIVED_DATA_DIR);
const displayScopedDerivedData = (anchorPath: string): string =>
  displayPath(computeScopedDerivedDataPath(anchorPath));

describe('formatToolPreflight', () => {
  it('formats simulator build with workspace and simulator name', () => {
    const result = formatToolPreflight({
      operation: 'Build',
      scheme: 'MyApp',
      workspacePath: '/path/to/MyApp.xcworkspace',
      configuration: 'Debug',
      platform: 'iOS Simulator',
      simulatorName: 'iPhone 17',
    });

    expect(result).toBe(
      [
        '\u{1F528} Build',
        '',
        '   Scheme: MyApp',
        '   Workspace: /path/to/MyApp.xcworkspace',
        '   Configuration: Debug',
        '   Platform: iOS Simulator',
        '   Simulator: iPhone 17',
        `   Derived Data: ${displayScopedDerivedData('/path/to/MyApp.xcworkspace')}`,
        '',
      ].join('\n'),
    );
  });

  it('formats simulator build with project and simulator ID', () => {
    const result = formatToolPreflight({
      operation: 'Build',
      scheme: 'MyApp',
      projectPath: '/path/to/MyApp.xcodeproj',
      configuration: 'Release',
      platform: 'iOS Simulator',
      simulatorId: 'ABC-123-DEF',
    });

    expect(result).toBe(
      [
        '\u{1F528} Build',
        '',
        '   Scheme: MyApp',
        '   Project: /path/to/MyApp.xcodeproj',
        '   Configuration: Release',
        '   Platform: iOS Simulator',
        '   Simulator: ABC-123-DEF',
        `   Derived Data: ${displayScopedDerivedData('/path/to/MyApp.xcodeproj')}`,
        '',
      ].join('\n'),
    );
  });

  it('formats build & run with device ID only', () => {
    const result = formatToolPreflight({
      operation: 'Build & Run',
      scheme: 'MyApp',
      projectPath: '/path/to/MyApp.xcodeproj',
      configuration: 'Debug',
      platform: 'iOS',
      deviceId: 'DEVICE-UDID-123',
    });

    expect(result).toBe(
      [
        '\u{1F680} Build & Run',
        '',
        '   Scheme: MyApp',
        '   Project: /path/to/MyApp.xcodeproj',
        '   Configuration: Debug',
        '   Platform: iOS',
        '   Device: DEVICE-UDID-123',
        `   Derived Data: ${displayScopedDerivedData('/path/to/MyApp.xcodeproj')}`,
        '',
      ].join('\n'),
    );
  });

  it('formats build & run with device name and ID', () => {
    const result = formatToolPreflight({
      operation: 'Build & Run',
      scheme: 'MyApp',
      projectPath: '/path/to/MyApp.xcodeproj',
      configuration: 'Debug',
      platform: 'iOS',
      deviceId: 'DEVICE-UDID-123',
      deviceName: "Cameron's iPhone",
    });

    expect(result).toBe(
      [
        '\u{1F680} Build & Run',
        '',
        '   Scheme: MyApp',
        '   Project: /path/to/MyApp.xcodeproj',
        '   Configuration: Debug',
        '   Platform: iOS',
        "   Device: Cameron's iPhone (DEVICE-UDID-123)",
        `   Derived Data: ${displayScopedDerivedData('/path/to/MyApp.xcodeproj')}`,
        '',
      ].join('\n'),
    );
  });

  it('formats macOS build & run with the approved front-matter spacing', () => {
    const result = formatToolPreflight({
      operation: 'Build & Run',
      scheme: 'MacApp',
      projectPath: '/path/to/MacApp.xcodeproj',
      configuration: 'Debug',
      platform: 'macOS',
    });

    expect(result).toBe(
      [
        '\u{1F680} Build & Run',
        '',
        '   Scheme: MacApp',
        '   Project: /path/to/MacApp.xcodeproj',
        '   Configuration: Debug',
        '   Platform: macOS',
        `   Derived Data: ${displayScopedDerivedData('/path/to/MacApp.xcodeproj')}`,
        '',
      ].join('\n'),
    );
  });

  it('formats macOS build with architecture', () => {
    const result = formatToolPreflight({
      operation: 'Build',
      scheme: 'MyMacApp',
      workspacePath: '/path/to/workspace.xcworkspace',
      configuration: 'Debug',
      platform: 'macOS',
      arch: 'arm64',
    });

    expect(result).toBe(
      [
        '\u{1F528} Build',
        '',
        '   Scheme: MyMacApp',
        '   Workspace: /path/to/workspace.xcworkspace',
        '   Configuration: Debug',
        '   Platform: macOS',
        `   Derived Data: ${displayScopedDerivedData('/path/to/workspace.xcworkspace')}`,
        '   Architecture: arm64',
        '',
      ].join('\n'),
    );
  });

  it('formats clean operation', () => {
    const result = formatToolPreflight({
      operation: 'Clean',
      scheme: 'MyApp',
      projectPath: '/path/to/MyApp.xcodeproj',
      configuration: 'Debug',
      platform: 'iOS',
    });

    expect(result).toBe(
      [
        '\u{1F9F9} Clean',
        '',
        '   Scheme: MyApp',
        '   Project: /path/to/MyApp.xcodeproj',
        '   Configuration: Debug',
        '   Platform: iOS',
        `   Derived Data: ${displayScopedDerivedData('/path/to/MyApp.xcodeproj')}`,
        '',
      ].join('\n'),
    );
  });

  it('omits workspace/project when neither provided', () => {
    const result = formatToolPreflight({
      operation: 'Build',
      scheme: 'MyApp',
      configuration: 'Debug',
      platform: 'macOS',
    });

    expect(result).toBe(
      [
        '\u{1F528} Build',
        '',
        '   Scheme: MyApp',
        '   Configuration: Debug',
        '   Platform: macOS',
        `   Derived Data: ${DISPLAY_DERIVED_DATA}`,
        '',
      ].join('\n'),
    );
  });

  it('formats test operation', () => {
    const result = formatToolPreflight({
      operation: 'Test',
      scheme: 'MyApp',
      workspacePath: '/path/to/MyApp.xcworkspace',
      configuration: 'Debug',
      platform: 'iOS Simulator',
      simulatorName: 'iPhone 17',
    });

    expect(result).toBe(
      [
        '\u{1F9EA} Test',
        '',
        '   Scheme: MyApp',
        '   Workspace: /path/to/MyApp.xcworkspace',
        '   Configuration: Debug',
        '   Platform: iOS Simulator',
        '   Simulator: iPhone 17',
        `   Derived Data: ${displayScopedDerivedData('/path/to/MyApp.xcworkspace')}`,
        '',
      ].join('\n'),
    );
  });

  it('shows relative path when under cwd', () => {
    const cwd = process.cwd();
    const result = formatToolPreflight({
      operation: 'Build',
      scheme: 'MyApp',
      workspacePath: `${cwd}/MyApp.xcworkspace`,
      configuration: 'Debug',
      platform: 'macOS',
    });

    expect(result).toContain('   Workspace: MyApp.xcworkspace');
    expect(result).not.toContain(cwd);
  });

  it('shows absolute path when outside cwd', () => {
    const result = formatToolPreflight({
      operation: 'Build',
      scheme: 'MyApp',
      projectPath: '/other/location/MyApp.xcodeproj',
      configuration: 'Debug',
      platform: 'macOS',
    });

    expect(result).toContain('   Project: /other/location/MyApp.xcodeproj');
  });

  it('prefers simulator name over simulator ID when both provided', () => {
    const result = formatToolPreflight({
      operation: 'Build',
      scheme: 'MyApp',
      configuration: 'Debug',
      platform: 'iOS Simulator',
      simulatorName: 'iPhone 17',
      simulatorId: 'ABC-123',
    });

    expect(result).toContain('Simulator: iPhone 17');
    expect(result).not.toContain('ABC-123');
  });
});
