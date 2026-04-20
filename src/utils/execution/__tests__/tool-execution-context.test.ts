import { describe, expect, it } from 'vitest';
import { DefaultToolExecutionContext } from '../tool-execution-context.ts';
import type { DomainFragment } from '../../../types/domain-fragments.ts';

describe('DefaultToolExecutionContext', () => {
  it('emits domain fragments through onFragment callback and stores result', () => {
    const emittedFragments: DomainFragment[] = [];
    const context = new DefaultToolExecutionContext({
      onFragment: (fragment) => {
        emittedFragments.push(fragment);
      },
    });

    context.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'boot-simulator',
      status: 'started',
    });
    context.emitFragment({
      kind: 'build-run-result',
      fragment: 'build-stage',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling App.swift',
    });
    context.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'boot-simulator',
      status: 'succeeded',
    });
    context.attach({ path: '/tmp/screenshot.png', mimeType: 'image/png' });

    context.emitResult({
      kind: 'build-run-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED', durationMs: 500, target: 'simulator' },
      artifacts: { buildLogPath: '/tmp/build.log', simulatorId: 'test-uuid' },
      diagnostics: { warnings: [], errors: [] },
    });

    expect(emittedFragments).toHaveLength(3);
    expect(emittedFragments.map((f) => f.fragment)).toEqual(['phase', 'build-stage', 'phase']);
    expect(context.getAttachments()).toEqual([
      { path: '/tmp/screenshot.png', mimeType: 'image/png' },
    ]);
    expect(context.getResult()).toEqual({
      kind: 'build-run-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED', durationMs: 500, target: 'simulator' },
      artifacts: { buildLogPath: '/tmp/build.log', simulatorId: 'test-uuid' },
      diagnostics: { warnings: [], errors: [] },
    });
  });

  it('silently discards fragments when no callback is provided', () => {
    const context = new DefaultToolExecutionContext();
    expect(() => {
      context.emitFragment({
        kind: 'build-run-result',
        fragment: 'warning',
        message: 'test warning',
      });
    }).not.toThrow();
  });
});
