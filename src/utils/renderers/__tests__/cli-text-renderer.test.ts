import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCliTextRenderer } from '../cli-text-renderer.ts';

const reporter = {
  update: vi.fn<(message: string) => void>(),
  clear: vi.fn<() => void>(),
};

vi.mock('../../cli-progress-reporter.ts', () => ({
  createCliProgressReporter: () => reporter,
}));

describe('cli-text-renderer', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    reporter.update.mockReset();
    reporter.clear.mockReset();
    process.env.NO_COLOR = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });

    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it('renders one blank-line boundary between front matter and first runtime line', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [
        { label: 'Scheme', value: 'MyApp' },
        { label: 'Project', value: '/tmp/MyApp.xcodeproj' },
        { label: 'Configuration', value: 'Debug' },
        { label: 'Platform', value: 'macOS' },
      ],
    });

    renderer.onEvent({
      type: 'build-stage',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('  Platform: macOS\n\n\u203A Compiling\n');
  });

  it('uses transient interactive updates for active phases and durable writes for lasting events', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: true });

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [{ label: 'Scheme', value: 'MyApp' }],
    });

    renderer.onEvent({
      type: 'build-stage',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onEvent({
      type: 'status-line',
      timestamp: '2026-03-20T12:00:02.000Z',
      level: 'info',
      message: 'Resolving app path',
    });

    renderer.onEvent({
      type: 'compiler-warning',
      timestamp: '2026-03-20T12:00:03.000Z',
      operation: 'BUILD',
      message: 'unused variable',
      rawLine: '/tmp/MyApp.swift:10: warning: unused variable',
    });

    renderer.onEvent({
      type: 'status-line',
      timestamp: '2026-03-20T12:00:04.000Z',
      level: 'success',
      message: 'Resolving app path',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:05.000Z',
      operation: 'BUILD',
      status: 'SUCCEEDED',
    });

    expect(reporter.update).toHaveBeenCalledWith('Compiling...');
    expect(reporter.update).toHaveBeenCalledWith('Resolving app path...');

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).not.toContain('\u203A Compiling\n');
    expect(output).toContain('Warnings (1):');
    expect(output).toContain('unused variable');
    expect(output).toContain('\u{2705} Resolving app path\n');
  });

  it('renders grouped sad-path diagnostics before the failed summary', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [
        { label: 'Scheme', value: 'MyApp' },
        { label: 'Project', value: '/tmp/MyApp.xcodeproj' },
        { label: 'Configuration', value: 'Debug' },
        { label: 'Platform', value: 'iOS Simulator' },
        { label: 'Simulator', value: 'INVALID-SIM-ID-123' },
      ],
    });

    renderer.onEvent({
      type: 'compiler-error',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      message: 'No available simulator matched: INVALID-SIM-ID-123',
      rawLine: 'No available simulator matched: INVALID-SIM-ID-123',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 1200,
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('Errors (1):');
    expect(output).toContain('  \u2717 No available simulator matched: INVALID-SIM-ID-123');
    expect(output).toContain('\u{274C} Build failed. (\u{23F1}\u{FE0F} 1.2s)');
  });

  it('groups compiler diagnostics under a nested failure header before the failed summary', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [
        { label: 'Scheme', value: 'MyApp' },
        { label: 'Project', value: '/tmp/MyApp.xcodeproj' },
        { label: 'Configuration', value: 'Debug' },
        { label: 'Platform', value: 'macOS' },
      ],
    });

    renderer.onEvent({
      type: 'build-stage',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onEvent({
      type: 'compiler-error',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:03.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 4000,
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '\u203A Compiling\n\nCompiler Errors (1):\n\n  \u2717 unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
    expect(output).not.toContain('error: unterminated string literal\n  ContentView.swift:16:18');
    expect(output).toContain('\n\n\u{274C} Build failed. (\u{23F1}\u{FE0F} 4.0s)');
  });

  it('uses exactly one blank-line boundary between front matter and compiler errors when no runtime line rendered', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [
        { label: 'Scheme', value: 'MyApp' },
        { label: 'Project', value: '/tmp/MyApp.xcodeproj' },
        { label: 'Configuration', value: 'Debug' },
        { label: 'Platform', value: 'macOS' },
      ],
    });

    renderer.onEvent({
      type: 'compiler-error',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 2000,
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '  Platform: macOS\n\nCompiler Errors (1):\n\n  \u2717 unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
    expect(output).not.toContain('  Platform: macOS\n\n\nCompiler Errors (1):');
  });

  it('persists the last transient runtime phase as a durable line before grouped compiler errors', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: true });

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [{ label: 'Scheme', value: 'MyApp' }],
    });

    renderer.onEvent({
      type: 'build-stage',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onEvent({
      type: 'build-stage',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      stage: 'LINKING',
      message: 'Linking',
    });

    renderer.onEvent({
      type: 'compiler-error',
      timestamp: '2026-03-20T12:00:03.000Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:04.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 4000,
    });

    expect(reporter.update).toHaveBeenCalledWith('Compiling...');
    expect(reporter.update).toHaveBeenCalledWith('Linking...');

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '\u203A Linking\n\nCompiler Errors (1):\n\n  \u2717 unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
  });

  it('renders summary, execution-derived footer, and next steps in that order', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:05.000Z',
      operation: 'BUILD',
      status: 'SUCCEEDED',
      durationMs: 7100,
    });

    renderer.onEvent({
      type: 'status-line',
      timestamp: '2026-03-20T12:00:06.000Z',
      level: 'success',
      message: 'Build & Run complete',
    });

    renderer.onEvent({
      type: 'detail-tree',
      timestamp: '2026-03-20T12:00:06.000Z',
      items: [{ label: 'App Path', value: '/tmp/build/MyApp.app' }],
    });

    renderer.onEvent({
      type: 'next-steps',
      timestamp: '2026-03-20T12:00:07.000Z',
      steps: [{ label: 'Get built macOS app path', cliTool: 'get-app-path', workflow: 'macos' }],
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    const summaryIndex = output.indexOf('\u{2705} Build succeeded.');
    const footerIndex = output.indexOf('\u{2705} Build & Run complete');
    const nextStepsIndex = output.indexOf('Next steps:');

    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThan(summaryIndex);
    expect(nextStepsIndex).toBeGreaterThan(footerIndex);
    expect(output).toContain('\u{2705} Build & Run complete');
    expect(output).toContain('\u2514 App Path: /tmp/build/MyApp.app');
  });
});
