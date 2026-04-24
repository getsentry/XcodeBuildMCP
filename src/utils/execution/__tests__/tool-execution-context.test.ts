import { describe, expect, it } from 'vitest';
import { DefaultStreamingExecutionContext } from '../tool-execution-context.ts';
import { createStreamingExecutionContext } from '../../tool-execution-compat.ts';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { AnyFragment, DomainFragment } from '../../../types/domain-fragments.ts';

describe('DefaultStreamingExecutionContext', () => {
  it('emits domain fragments through onFragment callback and collects attachments', () => {
    const emittedFragments: DomainFragment[] = [];
    const context = new DefaultStreamingExecutionContext({
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

    expect(emittedFragments).toHaveLength(3);
    expect(emittedFragments.map((f) => f.fragment)).toEqual(['phase', 'build-stage', 'phase']);
    expect(context.getAttachments()).toEqual([
      { path: '/tmp/screenshot.png', mimeType: 'image/png' },
    ]);
  });

  it('silently discards fragments when no callback is provided', () => {
    const context = new DefaultStreamingExecutionContext();
    expect(() => {
      context.emitFragment({
        kind: 'build-run-result',
        fragment: 'warning',
        message: 'test warning',
      });
    }).not.toThrow();
  });
});

describe('createStreamingExecutionContext', () => {
  function makeHandlerContext(streamingFragmentsEnabled: boolean): {
    ctx: ToolHandlerContext;
    emitted: AnyFragment[];
  } {
    const emitted: AnyFragment[] = [];
    const ctx: ToolHandlerContext = {
      liveProgressEnabled: true,
      streamingFragmentsEnabled,
      emit: (fragment) => emitted.push(fragment),
      attach: () => {},
    };
    return { ctx, emitted };
  }

  const testFragment: DomainFragment = {
    kind: 'build-run-result',
    fragment: 'phase',
    phase: 'boot-simulator',
    status: 'started',
  };

  it('forwards fragments through ctx.emit when streamingFragmentsEnabled is true', () => {
    const { ctx, emitted } = makeHandlerContext(true);
    const execCtx = createStreamingExecutionContext(ctx);

    execCtx.emitFragment(testFragment);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe(testFragment);
  });

  it('silently drops fragments when streamingFragmentsEnabled is false', () => {
    const { ctx, emitted } = makeHandlerContext(false);
    const execCtx = createStreamingExecutionContext(ctx);

    execCtx.emitFragment(testFragment);

    expect(emitted).toHaveLength(0);
  });
});
