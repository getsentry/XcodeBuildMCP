import { describe, expect, it } from 'vitest';
import { createXcodebuildPipeline } from '../xcodebuild-pipeline.ts';
import type { StartedPipeline } from '../xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../xcodebuild-output.ts';
import type { AnyFragment } from '../../types/domain-fragments.ts';

function startPipeline(emit: (fragment: AnyFragment) => void = () => {}): StartedPipeline {
  const pipeline = createXcodebuildPipeline({
    operation: 'BUILD',
    toolName: 'build_run_macos',
    params: { scheme: 'MyApp' },
    emit,
  });
  return { pipeline, startedAt: Date.now() };
}

describe('xcodebuild-output', () => {
  it('does not emit fallback events (fallback is handled by domain result creators)', () => {
    const emitted: AnyFragment[] = [];
    const started = startPipeline((fragment) => emitted.push(fragment));
    emitted.length = 0;

    finalizeInlineXcodebuild({
      started,
      succeeded: false,
      durationMs: 100,
    });

    expect(emitted).toEqual([
      {
        kind: 'build-result',
        fragment: 'build-summary',
        operation: 'BUILD',
        status: 'FAILED',
        durationMs: 100,
      },
    ]);
  });

  it('logs parser debug info without emitting progress events during finalize', () => {
    const emitted: AnyFragment[] = [];
    const started = startPipeline((fragment) => emitted.push(fragment));
    emitted.length = 0;

    started.pipeline.onStdout('UNRECOGNIZED LINE\n');

    finalizeInlineXcodebuild({
      started,
      succeeded: true,
      durationMs: 100,
    });

    expect(emitted).toEqual([
      {
        kind: 'build-result',
        fragment: 'build-summary',
        operation: 'BUILD',
        status: 'SUCCEEDED',
        durationMs: 100,
      },
    ]);
  });

  it('returns finalized state without synthesizing footer events beyond the build summary', () => {
    const emitted: AnyFragment[] = [];
    const started = startPipeline((fragment) => emitted.push(fragment));
    emitted.length = 0;

    const result = finalizeInlineXcodebuild({
      started,
      succeeded: true,
      durationMs: 100,
    });

    expect(result.state.finalStatus).toBe('SUCCEEDED');
    expect(result.state.wallClockDurationMs).toBe(100);
    expect(emitted).toEqual([
      {
        kind: 'build-result',
        fragment: 'build-summary',
        operation: 'BUILD',
        status: 'SUCCEEDED',
        durationMs: 100,
      },
    ]);
    expect(started.pipeline.logPath).toContain('build_run_macos_');
  });
});
