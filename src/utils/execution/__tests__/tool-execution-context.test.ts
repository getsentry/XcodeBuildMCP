import { describe, expect, it } from 'vitest';
import { DefaultToolExecutionContext } from '../tool-execution-context.ts';

describe('DefaultToolExecutionContext', () => {
  it('collects progress and attachments, calls the progress sink, and stores the result', () => {
    const sinkEvents: Array<{ type: string }> = [];
    const context = new DefaultToolExecutionContext({
      progressSink: (event) => {
        sinkEvents.push({ type: event.type });
      },
    });

    context.emitProgress({ type: 'status', level: 'info', message: 'Starting build' });
    context.emitProgress({
      type: 'xcodebuild-line',
      operation: 'BUILD',
      stream: 'stdout',
      line: 'CompileSwift normal arm64 /tmp/App.swift',
    });
    context.emitProgress({ type: 'artifact', name: 'Build Log', path: '/tmp/build.log' });
    context.attach({ path: '/tmp/screenshot.png', mimeType: 'image/png' });

    context.emitResult({
      kind: 'build-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED', durationMs: 500 },
      artifacts: { buildLogPath: '/tmp/build.log' },
      diagnostics: { warnings: [], errors: [] },
    });

    expect(context.getProgressEvents()).toHaveLength(3);
    expect(sinkEvents).toEqual([
      { type: 'status' },
      { type: 'xcodebuild-line' },
      { type: 'artifact' },
    ]);
    expect(context.getAttachments()).toEqual([
      { path: '/tmp/screenshot.png', mimeType: 'image/png' },
    ]);
    expect(context.getProgressEvents().map((event) => event.type)).toEqual([
      'status',
      'xcodebuild-line',
      'artifact',
    ]);
    expect(context.getResult()).toEqual({
      kind: 'build-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED', durationMs: 500 },
      artifacts: { buildLogPath: '/tmp/build.log' },
      diagnostics: { warnings: [], errors: [] },
    });
  });
});
