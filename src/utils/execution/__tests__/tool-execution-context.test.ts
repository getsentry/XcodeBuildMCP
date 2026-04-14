import { describe, expect, it } from 'vitest';
import type { RenderSession } from '../../../rendering/types.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { DefaultToolExecutionContext } from '../tool-execution-context.ts';

describe('DefaultToolExecutionContext', () => {
  it('collects progress and attachments and forwards adapted pipeline events to a render session', () => {
    const emitted: PipelineEvent[] = [];
    const renderSession: RenderSession = {
      emit(event): void {
        emitted.push(event);
      },
      attach(): void {},
      getEvents(): readonly PipelineEvent[] {
        return emitted;
      },
      getAttachments(): readonly [] {
        return [];
      },
      isError(): boolean {
        return false;
      },
      finalize(): string {
        return '';
      },
    };
    const context = new DefaultToolExecutionContext({
      renderSession,
      xcodebuildOperation: 'BUILD',
    });

    context.emitProgress({ type: 'status', level: 'info', message: 'Starting build' });
    context.emitProgress({
      type: 'xcodebuild-line',
      stream: 'stdout',
      line: 'CompileSwift normal arm64 /tmp/App.swift',
    });
    context.emitProgress({ type: 'artifact', name: 'Build Log', path: '/tmp/build.log' });
    context.attach({ path: '/tmp/screenshot.png', mimeType: 'image/png' });

    const resultEvents = context.emitResult({
      kind: 'build-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED', durationMs: 500 },
      artifacts: { buildLogPath: '/tmp/build.log' },
      diagnostics: { warnings: [], errors: [] },
    });

    expect(context.getProgressEvents()).toHaveLength(3);
    expect(context.getAttachments()).toEqual([
      { path: '/tmp/screenshot.png', mimeType: 'image/png' },
    ]);
    expect(
      emitted.some((event) => event.type === 'status-line' && event.message === 'Starting build'),
    ).toBe(true);
    expect(
      emitted.some((event) => event.type === 'build-stage' && event.stage === 'COMPILING'),
    ).toBe(true);
    expect(
      emitted.some((event) => event.type === 'file-ref' && event.path === '/tmp/build.log'),
    ).toBe(true);
    expect(resultEvents.at(-1)).toMatchObject({
      type: 'summary',
      status: 'SUCCEEDED',
      durationMs: 500,
    });
  });
});
