import type { TestPreflightResult } from './test-preflight.ts';

function parseTestSelectorArgs(extraArgs: string[] | undefined): {
  remainingArgs: string[];
  selectorArgs: string[];
  resultBundlePath?: string;
} {
  if (!extraArgs || extraArgs.length === 0) {
    return { remainingArgs: [], selectorArgs: [] };
  }

  const remainingArgs: string[] = [];
  const selectorArgs: string[] = [];
  let resultBundlePath: string | undefined;

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

    if (argument === '-resultBundlePath') {
      const value = extraArgs[index + 1];
      if (value) {
        resultBundlePath = value;
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

  return { remainingArgs, selectorArgs, resultBundlePath };
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
  const parsedArgs = parseTestSelectorArgs(params.extraArgs);
  const selectedTestArgs = parsedArgs.selectorArgs;
  const usesExactSelectors = selectedTestArgs.length > 0;
  const resultBundlePath = params.resultBundlePath ?? parsedArgs.resultBundlePath;

  return {
    buildArgs: [...parsedArgs.remainingArgs, ...selectedTestArgs],
    testArgs: [
      ...parsedArgs.remainingArgs,
      ...selectedTestArgs,
      ...(resultBundlePath ? ['-resultBundlePath', resultBundlePath] : []),
    ],
    usesExactSelectors,
  };
}
