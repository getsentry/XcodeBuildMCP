function isResultBundlePathValue(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !value.startsWith('-');
}

export function parseResultBundlePathArgs(extraArgs?: readonly string[]): {
  remainingArgs: string[];
  resultBundlePath?: string;
} {
  if (!extraArgs) {
    return { remainingArgs: [] };
  }

  const remainingArgs: string[] = [];
  let resultBundlePath: string | undefined;

  for (let index = 0; index < extraArgs.length; index += 1) {
    const argument = extraArgs[index];
    if (argument === '-resultBundlePath') {
      const value = extraArgs[index + 1];
      if (isResultBundlePathValue(value)) {
        resultBundlePath = value;
        index += 1;
      }
      continue;
    }

    if (argument?.startsWith('-resultBundlePath=')) {
      const value = argument.slice('-resultBundlePath='.length);
      if (isResultBundlePathValue(value)) {
        resultBundlePath = value;
      }
      continue;
    }

    if (argument !== undefined) {
      remainingArgs.push(argument);
    }
  }

  return {
    remainingArgs,
    ...(resultBundlePath ? { resultBundlePath } : {}),
  };
}

export function findResultBundlePathArg(extraArgs?: readonly string[]): string | undefined {
  return parseResultBundlePathArgs(extraArgs).resultBundlePath;
}
