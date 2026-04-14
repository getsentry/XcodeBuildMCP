import { describe, expect, it } from 'vitest';
import { startBuildPipeline } from '../xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../xcodebuild-output.ts';
import type { ProgressEvent } from '../../types/progress-events.ts';

function startPipeline(emit: (event: ProgressEvent) => void = () => {}) {
  return startBuildPipeline({
    operation: 'BUILD',
    toolName: 'build_run_macos',
    params: { scheme: 'MyApp' },
    message: '🚀 Build & Run\n\n  Scheme: MyApp',
    emit,
  });
}

describe('xcodebuild-output', () => {
  it('suppresses fallback error progress when structured diagnostics already exist', () => {
    const emitted: ProgressEvent[] = [];
    const started = startPipeline();

    started.pipeline.emitEvent({
      type: 'compiler-error',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MyApp.swift:10:1: error: unterminated string literal',
    });

    const result = finalizeInlineXcodebuild({
      started,
      emit: (event) => emitted.push(event),
      succeeded: false,
      durationMs: 100,
      responseContent: [{ type: 'text', text: 'Legacy fallback error block' }],
      errorFallbackPolicy: 'if-no-structured-diagnostics',
    });

    expect(result.state.errors).toHaveLength(1);
    expect(emitted).toEqual([]);
  });

  it('emits fallback error progress when no structured diagnostics exist', () => {
    const emitted: ProgressEvent[] = [];
    const started = startPipeline();

    finalizeInlineXcodebuild({
      started,
      emit: (event) => emitted.push(event),
      succeeded: false,
      durationMs: 100,
      responseContent: [{ type: 'text', text: 'Legacy fallback error block' }],
      errorFallbackPolicy: 'if-no-structured-diagnostics',
    });

    expect(emitted).toEqual([
      {
        type: 'status',
        level: 'error',
        message: 'Legacy fallback error block',
      },
    ]);
  });

  it('surfaces parser debug logs as progress notices during finalize', () => {
    const emitted: ProgressEvent[] = [];
    const started = startPipeline((event) => emitted.push(event));
    emitted.length = 0;

    started.pipeline.onStdout('UNRECOGNIZED LINE\n');

    finalizeInlineXcodebuild({
      started,
      emit: (event) => emitted.push(event),
      succeeded: true,
      durationMs: 100,
      includeParserDebugFileRef: true,
    });

    expect(emitted).toEqual(
      expect.arrayContaining([
        {
          type: 'status',
          level: 'warning',
          message: 'Parsing issue detected - debug log:',
        },
        expect.objectContaining({
          type: 'file-ref',
          label: 'Parser Debug Log',
          path: expect.stringContaining('build_run_macos_parser-debug_'),
        }),
      ]),
    );
  });

  it('returns finalized state without synthesizing footer events', () => {
    const emitted: ProgressEvent[] = [];
    const started = startPipeline((event) => emitted.push(event));
    emitted.length = 0;

    const result = finalizeInlineXcodebuild({
      started,
      emit: (event) => emitted.push(event),
      succeeded: true,
      durationMs: 100,
    });

    expect(result.state.finalStatus).toBe('SUCCEEDED');
    expect(result.state.wallClockDurationMs).toBe(100);
    expect(emitted).toEqual([]);
    expect(started.pipeline.logPath).toContain('build_run_macos_');
  });
});
