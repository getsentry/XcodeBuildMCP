import { describe, expect, it } from 'vitest';
import { createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  setUiActionStructuredOutput,
} from '../shared/domain-result.ts';

describe('UI action manifest next-step condition', () => {
  it('activates the refresh template when no runtime snapshot is available', () => {
    const result = createUiActionSuccessResult({ type: 'button', button: 'home' }, 'SIMULATOR-ID');
    const { ctx } = createMockToolHandlerContext();

    setUiActionStructuredOutput(ctx, result);

    expect(ctx.nextSteps).toBeUndefined();
    expect(ctx.nextStepConditionKeys).toEqual(['ui_action_needs_refresh']);
    expect(ctx.nextStepParams).toEqual({
      snapshot_ui: { simulatorId: 'SIMULATOR-ID' },
    });
  });

  it('does not activate the refresh template after a failed action', () => {
    const result = createUiActionFailureResult(
      { type: 'button', button: 'home' },
      'SIMULATOR-ID',
      'Action failed',
    );
    const { ctx } = createMockToolHandlerContext();

    setUiActionStructuredOutput(ctx, result);

    expect(ctx.nextSteps).toBeUndefined();
    expect(ctx.nextStepConditionKeys).toBeUndefined();
    expect(ctx.nextStepParams).toBeUndefined();
  });
});
