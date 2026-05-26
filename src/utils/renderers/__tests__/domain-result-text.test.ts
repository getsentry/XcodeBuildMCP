import { describe, expect, it } from 'vitest';
import type {
  LaunchResultDomainResult,
  UiActionResultDomainResult,
} from '../../../types/domain-results.ts';
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

function launchResult(
  artifacts: LaunchResultDomainResult['artifacts'],
  error: string,
): LaunchResultDomainResult {
  return {
    kind: 'launch-result',
    didError: true,
    error,
    summary: { status: 'FAILED' },
    artifacts,
    diagnostics: { warnings: [], errors: [] },
  };
}

describe('renderDomainResultTextItems', () => {
  it('renders macOS launch errors from artifacts instead of exact error text', () => {
    expect(
      renderDomainResultTextItems(
        launchResult({ appPath: '/tmp/Test.app' }, 'Custom launch failure.'),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "operation": "Launch macOS App",
          "params": [
            {
              "label": "App",
              "value": "/tmp/Test.app",
            },
          ],
          "type": "header",
        },
        {
          "level": "error",
          "message": "Custom launch failure.",
          "type": "status",
        },
      ]
    `);
  });

  it('does not classify targetless simulator launch errors as macOS without app artifacts', () => {
    expect(
      renderDomainResultTextItems(
        launchResult({ bundleId: 'com.example.App' }, 'Failed to launch app.'),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "operation": "Launch App",
          "params": [
            {
              "label": "Bundle ID",
              "value": "com.example.App",
            },
          ],
          "type": "header",
        },
        {
          "level": "error",
          "message": "Failed to launch app.",
          "type": "status",
        },
      ]
    `);
  });

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
