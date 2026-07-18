import * as z from 'zod';

type TestSourceParams = {
  projectPath?: unknown;
  workspacePath?: unknown;
  scheme?: unknown;
  configuration?: unknown;
  derivedDataPath?: unknown;
  testProductsPath?: unknown;
  xctestrunPath?: unknown;
  extraArgs?: unknown;
};

const conflictingPreparedTestArgKeys = new Set([
  '-configuration',
  '-derivedDataPath',
  '-destination',
  '-project',
  '-scheme',
  '-testProductsPath',
  '-workspace',
  '-xctestrun',
]);

const conflictingPreparedTestActions = new Set([
  'build-for-testing',
  'test',
  'test-without-building',
]);

function getArgumentKey(argument: string): string {
  const separatorIndexes = [argument.indexOf(':'), argument.indexOf('=')].filter(
    (index) => index !== -1,
  );
  return separatorIndexes.length === 0
    ? argument
    : argument.slice(0, Math.min(...separatorIndexes));
}

function getConflictingPreparedTestArgs(extraArgs: unknown): string[] {
  if (!Array.isArray(extraArgs)) {
    return [];
  }

  return extraArgs.filter(
    (argument): argument is string =>
      typeof argument === 'string' &&
      (conflictingPreparedTestArgKeys.has(getArgumentKey(argument)) ||
        conflictingPreparedTestActions.has(argument)),
  );
}

export function filterPreparedTestExtraArgs(extraArgs: string[]): string[] {
  const filteredArgs: string[] = [];

  for (let index = 0; index < extraArgs.length; index += 1) {
    const argument = extraArgs[index]!;
    const argumentKey = getArgumentKey(argument);

    if (conflictingPreparedTestActions.has(argument)) {
      continue;
    }

    if (conflictingPreparedTestArgKeys.has(argumentKey)) {
      if (argument === argumentKey && index + 1 < extraArgs.length) {
        index += 1;
      }
      continue;
    }

    filteredArgs.push(argument);
  }

  return filteredArgs;
}

export function filterTestProductsPathArgs(extraArgs: string[]): string[] {
  const filteredArgs: string[] = [];

  for (let index = 0; index < extraArgs.length; index += 1) {
    const argument = extraArgs[index]!;
    const argumentKey = getArgumentKey(argument);

    if (argumentKey === '-testProductsPath') {
      if (argument === argumentKey && index + 1 < extraArgs.length) {
        index += 1;
      }
      continue;
    }

    filteredArgs.push(argument);
  }

  return filteredArgs;
}

export function getPreparedTestDestinationArgs(extraArgs: string[]): string[] {
  const destinationArgs: string[] = [];

  for (let index = 0; index < extraArgs.length; index += 1) {
    const argument = extraArgs[index]!;
    if (getArgumentKey(argument) !== '-destination') {
      continue;
    }

    destinationArgs.push(argument);
    if (argument === '-destination' && index + 1 < extraArgs.length) {
      destinationArgs.push(extraArgs[index + 1]!);
      index += 1;
    }
  }

  return destinationArgs;
}

export function hasPreparedTestSource(params: {
  testProductsPath?: string;
  xctestrunPath?: string;
}): boolean {
  return params.testProductsPath !== undefined || params.xctestrunPath !== undefined;
}

export function withProjectWorkspaceOrTestArtifact<T extends z.ZodObject>(baseObject: T): T {
  return baseObject.superRefine((value: TestSourceParams, context) => {
    const preparedSourceCount =
      Number(value.testProductsPath !== undefined) + Number(value.xctestrunPath !== undefined);

    if (preparedSourceCount > 1) {
      context.addIssue({
        code: 'custom',
        message: 'testProductsPath and xctestrunPath are mutually exclusive. Provide only one.',
      });
      return;
    }

    if (preparedSourceCount === 1) {
      const conflictingFields = [
        'projectPath',
        'workspacePath',
        'scheme',
        'configuration',
        'derivedDataPath',
      ].filter((key) => value[key as keyof TestSourceParams] !== undefined);
      if (conflictingFields.length > 0) {
        context.addIssue({
          code: 'custom',
          message: `Prepared test artifacts cannot be combined with source inputs: ${conflictingFields.join(', ')}.`,
        });
      }

      const conflictingArgs = getConflictingPreparedTestArgs(value.extraArgs);
      if (conflictingArgs.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['extraArgs'],
          message: `Prepared test artifacts cannot be combined with conflicting xcodebuild arguments: ${conflictingArgs.join(', ')}.`,
        });
      }
      return;
    }

    if (value.scheme === undefined) {
      context.addIssue({ code: 'custom', path: ['scheme'], message: 'scheme is required.' });
    }

    const sourceCount =
      Number(value.projectPath !== undefined) + Number(value.workspacePath !== undefined);
    if (sourceCount === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Either projectPath or workspacePath is required.',
      });
    } else if (sourceCount > 1) {
      context.addIssue({
        code: 'custom',
        message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
      });
    }
  });
}

export const TEST_SOURCE_EXCLUSIVE_GROUPS = [
  ['testProductsPath', 'xctestrunPath'],
  ['testProductsPath', 'projectPath', 'workspacePath'],
  ['xctestrunPath', 'projectPath', 'workspacePath'],
  ['testProductsPath', 'scheme'],
  ['xctestrunPath', 'scheme'],
  ['testProductsPath', 'configuration'],
  ['xctestrunPath', 'configuration'],
  ['testProductsPath', 'derivedDataPath'],
  ['xctestrunPath', 'derivedDataPath'],
] as const;
