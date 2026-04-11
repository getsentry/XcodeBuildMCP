import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractGroupedCompilerError,
  formatGroupedCompilerErrors,
  formatGroupedTestFailures,
  formatHumanCompilerErrorEvent,
  formatHumanCompilerWarningEvent,
  formatHeaderEvent,
  formatBuildStageEvent,
  formatTransientBuildStageEvent,
  formatStatusLineEvent,
  formatDetailTreeEvent,
  formatTransientStatusLineEvent,
} from '../event-formatting.ts';

describe('event formatting', () => {
  it('formats header events with emoji, operation, and params', () => {
    expect(
      formatHeaderEvent({
        type: 'header',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'Build & Run',
        params: [{ label: 'Scheme', value: 'MyApp' }],
      }),
    ).toBe('\u{1F680} Build & Run\n\n   Scheme: MyApp\n');
  });

  it('groups test selection params with human-readable labels in header output', () => {
    expect(
      formatHeaderEvent({
        type: 'header',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'Test',
        params: [
          { label: 'Scheme', value: 'MyApp' },
          { label: '-only-testing', value: 'MyAppTests/MyAppTests/testLaunch' },
          { label: '-skip-testing', value: 'MyAppTests/MyAppTests/testFlaky' },
          { label: 'Derived Data', value: '~/Library/Developer/XcodeBuildMCP/DerivedData' },
        ],
      }),
    ).toBe(
      [
        '\u{1F9EA} Test',
        '',
        '   Scheme: MyApp',
        '   Derived Data: ~/Library/Developer/XcodeBuildMCP/DerivedData',
        '   Selective Testing:',
        '     MyAppTests/MyAppTests/testLaunch',
        '     Skip Testing: MyAppTests/MyAppTests/testFlaky',
        '',
      ].join('\n'),
    );
  });

  it('formats build-stage events as durable phase lines', () => {
    expect(
      formatBuildStageEvent({
        type: 'build-stage',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        stage: 'COMPILING',
        message: 'Compiling',
      }),
    ).toBe('\u203A Compiling');
  });

  it('formats transient build-stage events for interactive runtime updates', () => {
    expect(
      formatTransientBuildStageEvent({
        type: 'build-stage',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        stage: 'COMPILING',
        message: 'Compiling',
      }),
    ).toBe('Compiling...');
  });

  it('formats compiler-style errors with a cwd-relative source location when possible', () => {
    const projectBaseDir = join(process.cwd(), 'example_projects/macOS');

    expect(
      formatHumanCompilerErrorEvent(
        {
          type: 'compiler-error',
          timestamp: '2026-03-20T12:00:00.000Z',
          operation: 'BUILD',
          message: 'unterminated string literal',
          rawLine: 'ContentView.swift:16:18: error: unterminated string literal',
        },
        { baseDir: projectBaseDir },
      ),
    ).toBe(
      [
        'error: unterminated string literal',
        '  example_projects/macOS/MCPTest/ContentView.swift:16:18',
      ].join('\n'),
    );
  });

  it('keeps compiler-style error paths absolute when they are outside cwd', () => {
    expect(
      formatHumanCompilerErrorEvent({
        type: 'compiler-error',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        message: 'unterminated string literal',
        rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
      }),
    ).toBe(
      ['error: unterminated string literal', '  /tmp/MCPTest/ContentView.swift:16:18'].join('\n'),
    );
  });

  it('formats tool-originated errors in xcodebuild-style form', () => {
    expect(
      formatHumanCompilerErrorEvent({
        type: 'compiler-error',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        message: 'No available simulator matched: INVALID-SIM-ID-123',
        rawLine: 'No available simulator matched: INVALID-SIM-ID-123',
      }),
    ).toBe('error: No available simulator matched: INVALID-SIM-ID-123');
  });

  it('extracts compiler diagnostics for grouped sad-path rendering', () => {
    expect(
      extractGroupedCompilerError(
        {
          type: 'compiler-error',
          timestamp: '2026-03-20T12:00:00.000Z',
          operation: 'BUILD',
          message: 'unterminated string literal',
          rawLine: 'ContentView.swift:16:18: error: unterminated string literal',
        },
        { baseDir: join(process.cwd(), 'example_projects/macOS') },
      ),
    ).toEqual({
      message: 'unterminated string literal',
      location: 'example_projects/macOS/MCPTest/ContentView.swift:16:18',
    });
  });

  it('formats grouped compiler errors without repeating the error prefix per line', () => {
    expect(
      formatGroupedCompilerErrors(
        [
          {
            type: 'compiler-error',
            timestamp: '2026-03-20T12:00:00.000Z',
            operation: 'BUILD',
            message: 'unterminated string literal',
            rawLine: 'ContentView.swift:16:18: error: unterminated string literal',
          },
        ],
        { baseDir: join(process.cwd(), 'example_projects/macOS') },
      ),
    ).toBe(
      [
        'Compiler Errors (1):',
        '',
        '  \u2717 unterminated string literal',
        '    example_projects/macOS/MCPTest/ContentView.swift:16:18',
        '',
      ].join('\n'),
    );
  });

  it('formats tool-originated warnings with warning emoji', () => {
    expect(
      formatHumanCompilerWarningEvent({
        type: 'compiler-warning',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        message: 'Using cached build products',
        rawLine: 'Using cached build products',
      }),
    ).toBe('  \u{26A0} Using cached build products');
  });

  it('formats status-line events with level emojis', () => {
    expect(
      formatStatusLineEvent({
        type: 'status-line',
        timestamp: '2026-03-20T12:00:00.000Z',
        level: 'info',
        message: 'Resolving app path',
      }),
    ).toBe('\u{2139}\u{FE0F} Resolving app path');

    expect(
      formatStatusLineEvent({
        type: 'status-line',
        timestamp: '2026-03-20T12:00:00.000Z',
        level: 'success',
        message: 'Build & Run complete',
      }),
    ).toBe('\u{2705} Build & Run complete');
  });

  it('formats transient status-line events for info level', () => {
    expect(
      formatTransientStatusLineEvent({
        type: 'status-line',
        timestamp: '2026-03-20T12:00:00.000Z',
        level: 'info',
        message: 'Resolving app path',
      }),
    ).toBe('Resolving app path...');

    expect(
      formatTransientStatusLineEvent({
        type: 'status-line',
        timestamp: '2026-03-20T12:00:00.000Z',
        level: 'success',
        message: 'App path resolved',
      }),
    ).toBeNull();
  });

  it('formats detail-tree events as a tree section', () => {
    const rendered = formatDetailTreeEvent({
      type: 'detail-tree',
      timestamp: '2026-03-20T12:00:00.000Z',
      items: [
        { label: 'App Path', value: '/tmp/build/MyApp.app' },
        { label: 'Bundle ID', value: 'com.example.myapp' },
        { label: 'App ID', value: 'A1B2C3D4' },
        { label: 'Process ID', value: '12345' },
        { label: 'Launch', value: 'Running' },
      ],
    });

    expect(rendered).toContain('  \u251C App Path: /tmp/build/MyApp.app');
    expect(rendered).toContain('  \u251C Bundle ID: com.example.myapp');
    expect(rendered).toContain('  \u251C App ID: A1B2C3D4');
    expect(rendered).toContain('  \u251C Process ID: 12345');
    expect(rendered).toContain('  \u2514 Launch: Running');
  });

  it('formats detail-tree with single item using end branch', () => {
    expect(
      formatDetailTreeEvent({
        type: 'detail-tree',
        timestamp: '2026-03-20T12:00:00.000Z',
        items: [{ label: 'App Path', value: '/tmp/build/MyApp.app' }],
      }),
    ).toBe('  \u2514 App Path: /tmp/build/MyApp.app');
  });

  it('groups test failures by test case within a suite', () => {
    const rendered = formatGroupedTestFailures([
      {
        type: 'test-failure',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'TEST',
        suite: 'MathTests',
        test: 'testAdd',
        message: 'XCTAssertEqual failed',
        location: '/tmp/MathTests.swift:12',
      },
      {
        type: 'test-failure',
        timestamp: '2026-03-20T12:00:01.000Z',
        operation: 'TEST',
        suite: 'MathTests',
        test: 'testAdd',
        message: 'Expected 4, got 5',
        location: '/tmp/MathTests.swift:13',
      },
    ]);

    expect(rendered).toContain('MathTests');
    expect(rendered).toContain('  ✗ testAdd:');
    expect(rendered).toContain('      - XCTAssertEqual failed');
    expect(rendered).toContain('      - Expected 4, got 5');
  });
});
