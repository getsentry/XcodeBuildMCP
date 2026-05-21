import { describe, expect, it } from 'vitest';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import { renderDomainResultTextItems } from '../domain-result-text.ts';

function uiActionResult(action: UiActionResultDomainResult['action']): UiActionResultDomainResult {
  return {
    kind: 'ui-action-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    action,
    artifacts: { simulatorId: 'SIM-123' },
  };
}

describe('renderDomainResultTextItems', () => {
  it('renders drag UI action results', () => {
    expect(
      renderDomainResultTextItems(
        uiActionResult({
          type: 'drag',
          elementRef: 'e3',
          direction: 'up',
          durationSeconds: 0.5,
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "operation": "Drag",
          "params": [
            {
              "label": "Simulator",
              "value": "SIM-123",
            },
          ],
          "type": "header",
        },
        {
          "level": "success",
          "message": "Drag up from elementRef e3 duration=0.5s simulated successfully.",
          "type": "status",
        },
      ]
    `);
  });

  it('renders batch UI action results', () => {
    expect(
      renderDomainResultTextItems(
        uiActionResult({
          type: 'batch',
          stepCount: 2,
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "operation": "Batch UI Actions",
          "params": [
            {
              "label": "Simulator",
              "value": "SIM-123",
            },
          ],
          "type": "header",
        },
        {
          "level": "success",
          "message": "Batch UI automation completed successfully (2 steps).",
          "type": "status",
        },
      ]
    `);
  });
});
