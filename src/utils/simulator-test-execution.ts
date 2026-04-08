import { collectResolvedTestSelectors, type TestPreflightResult } from './test-preflight.ts';

function parseTestSelectorArgs(extraArgs: string[] | undefined): {
  remainingArgs: string[];
  selectorArgs: string[];
} {
  if (!extraArgs || extraArgs.length === 0) {
    return { remainingArgs: [], selectorArgs: [] };
  }

  const remainingArgs: string[] = [];
  const selectorArgs: string[] = [];

  for (let index = 0; index < extraArgs.length; index += 1) {
    const argument = extraArgs[index]!;

    if (argument === '-only-testing' || argument === '-skip-testing') {
      const value = extraArgs[index + 1];
      if (value) {
        selectorArgs.push(argument, value);
        index += 1;
      }
      continue;
    }

    if (argument.startsWith('-only-testing:') || argument.startsWith('-skip-testing:')) {
      selectorArgs.push(argument);
      continue;
    }

    remainingArgs.push(argument);
  }

  return { remainingArgs, selectorArgs };
}

export function createSimulatorTwoPhaseExecutionPlan(params: {
  extraArgs?: string[];
  preflight?: TestPreflightResult;
  resultBundlePath?: string;
}): {
  buildArgs: string[];
  testArgs: string[];
  usesExactSelectors: boolean;
} {
  const { remainingArgs, selectorArgs } = parseTestSelectorArgs(params.extraArgs);
  const resolvedSelectors = params.preflight ? collectResolvedTestSelectors(params.preflight) : [];
  const exactSelectorArgs = resolvedSelectors.flatMap((selector) => [`-only-testing:${selector}`]);
  const usesExactSelectors = exactSelectorArgs.length > 0;

  const selectedTestArgs = usesExactSelectors ? exactSelectorArgs : selectorArgs;

  return {
    buildArgs: [...remainingArgs, ...selectedTestArgs],
    testArgs: [
      ...remainingArgs,
      ...selectedTestArgs,
      ...(params.resultBundlePath ? ['-resultBundlePath', params.resultBundlePath] : []),
    ],
    usesExactSelectors,
  };
}
