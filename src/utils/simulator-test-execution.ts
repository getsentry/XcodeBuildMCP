import { parseResultBundlePathArgs } from './result-bundle-args.ts';
import type { TestPreflightResult } from './test-preflight.ts';

function parseTestSelectorArgs(extraArgs: string[] | undefined): {
  remainingArgs: string[];
  selectorArgs: string[];
  resultBundlePath?: string;
} {
  const parsedResultBundleArgs = parseResultBundlePathArgs(extraArgs);
  if (parsedResultBundleArgs.remainingArgs.length === 0) {
    return {
      remainingArgs: [],
      selectorArgs: [],
      ...(parsedResultBundleArgs.resultBundlePath
        ? { resultBundlePath: parsedResultBundleArgs.resultBundlePath }
        : {}),
    };
  }

  const remainingArgs: string[] = [];
  const selectorArgs: string[] = [];

  for (let index = 0; index < parsedResultBundleArgs.remainingArgs.length; index += 1) {
    const argument = parsedResultBundleArgs.remainingArgs[index]!;

    if (argument === '-only-testing' || argument === '-skip-testing') {
      const value = parsedResultBundleArgs.remainingArgs[index + 1];
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

  return {
    remainingArgs,
    selectorArgs,
    ...(parsedResultBundleArgs.resultBundlePath
      ? { resultBundlePath: parsedResultBundleArgs.resultBundlePath }
      : {}),
  };
}

export function createSimulatorTwoPhaseExecutionPlan(params: {
  extraArgs?: string[];
  preflight?: TestPreflightResult;
  resultBundlePath?: string;
}): {
  buildArgs: string[];
  testArgs: string[];
  usesExactSelectors: boolean;
  resultBundlePath?: string;
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
    ...(resultBundlePath ? { resultBundlePath } : {}),
  };
}
