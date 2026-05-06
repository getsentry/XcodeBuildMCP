import { describe, expect, it } from 'vitest';
import { createSimulatorTwoPhaseExecutionPlan } from '../simulator-test-execution.ts';
import type { TestPreflightResult } from '../test-preflight.ts';

function createPreflight(): TestPreflightResult {
  return {
    scheme: 'CalculatorApp',
    configuration: 'Debug',
    projectPath: '/tmp/CalculatorApp.xcodeproj',
    destinationName: 'iPhone 17 Pro',
    selectors: { onlyTesting: [], skipTesting: [] },
    warnings: [],
    completeness: 'complete',
    totalTests: 2,
    targets: [
      {
        name: 'CalculatorAppTests',
        warnings: [],
        files: [
          {
            path: '/tmp/CalculatorAppTests.swift',
            tests: [
              {
                framework: 'xctest',
                targetName: 'CalculatorAppTests',
                typeName: 'CalculatorAppTests',
                methodName: 'testAddition',
                displayName: 'CalculatorAppTests/CalculatorAppTests/testAddition',
                line: 10,
                parameterized: false,
              },
              {
                framework: 'swift-testing',
                targetName: 'CalculatorAppTests',
                typeName: 'ExpressionSuite',
                methodName: 'evaluatesExpression',
                displayName: 'CalculatorAppTests/ExpressionSuite/evaluatesExpression',
                line: 20,
                parameterized: true,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('createSimulatorTwoPhaseExecutionPlan', () => {
  it('keeps preflight discovery observational instead of synthesizing only-testing selectors', () => {
    const plan = createSimulatorTwoPhaseExecutionPlan({
      extraArgs: ['-parallel-testing-enabled', 'YES'],
      preflight: createPreflight(),
      resultBundlePath: '/tmp/Calculator.xcresult',
    });

    expect(plan.buildArgs).toEqual(['-parallel-testing-enabled', 'YES']);
    expect(plan.testArgs).toEqual([
      '-parallel-testing-enabled',
      'YES',
      '-resultBundlePath',
      '/tmp/Calculator.xcresult',
    ]);
    expect(plan.usesExactSelectors).toBe(false);
    expect(plan.resultBundlePath).toBe('/tmp/Calculator.xcresult');
  });

  it('preserves user-supplied selector arguments in both simulator test phases', () => {
    const plan = createSimulatorTwoPhaseExecutionPlan({
      extraArgs: [
        '-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition',
        '-skip-testing',
        'CalculatorAppTests/ExpressionSuite/evaluatesExpression',
      ],
      preflight: createPreflight(),
    });

    expect(plan.buildArgs).toEqual([
      '-only-testing:CalculatorAppTests/CalculatorAppTests/testAddition',
      '-skip-testing',
      'CalculatorAppTests/ExpressionSuite/evaluatesExpression',
    ]);
    expect(plan.testArgs).toEqual(plan.buildArgs);
    expect(plan.usesExactSelectors).toBe(true);
  });

  it('keeps resultBundlePath out of build-for-testing args and includes it for test-without-building', () => {
    const plan = createSimulatorTwoPhaseExecutionPlan({
      extraArgs: ['-resultBundlePath', '/tmp/UserProvided.xcresult'],
    });

    expect(plan.buildArgs).toEqual([]);
    expect(plan.testArgs).toEqual(['-resultBundlePath', '/tmp/UserProvided.xcresult']);
    expect(plan.resultBundlePath).toBe('/tmp/UserProvided.xcresult');
  });

  it('supports equals-form resultBundlePath arguments', () => {
    const plan = createSimulatorTwoPhaseExecutionPlan({
      extraArgs: ['-resultBundlePath=/tmp/EqualsProvided.xcresult'],
    });

    expect(plan.buildArgs).toEqual([]);
    expect(plan.testArgs).toEqual(['-resultBundlePath', '/tmp/EqualsProvided.xcresult']);
    expect(plan.resultBundlePath).toBe('/tmp/EqualsProvided.xcresult');
  });

  it('uses the last valid resultBundlePath argument', () => {
    const plan = createSimulatorTwoPhaseExecutionPlan({
      extraArgs: [
        '-resultBundlePath',
        '-quiet',
        '-resultBundlePath',
        '/tmp/First.xcresult',
        '-resultBundlePath=/tmp/Last.xcresult',
      ],
    });

    expect(plan.buildArgs).toEqual(['-quiet']);
    expect(plan.testArgs).toEqual(['-quiet', '-resultBundlePath', '/tmp/Last.xcresult']);
    expect(plan.resultBundlePath).toBe('/tmp/Last.xcresult');
  });
});
