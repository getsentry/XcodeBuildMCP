import type { SessionDefaults } from './session-store.ts';

export type ExclusiveParameterGroup = readonly string[];

export function hasConcreteSessionDefaultValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

export function pickSessionDefaultsForKeys(
  keys: Iterable<string>,
  defaults: Partial<SessionDefaults>,
): Record<string, unknown> {
  const pickedDefaults: Record<string, unknown> = {};

  for (const key of keys) {
    const value = defaults[key as keyof SessionDefaults];
    if (hasConcreteSessionDefaultValue(value)) {
      pickedDefaults[key] = value;
    }
  }

  return pickedDefaults;
}

// Known options disambiguate separated values that start with '-' or contain '='.
const valuelessXcodebuildExtraArgKeys = new Set([
  '-alltargets',
  '-allowProvisioningDeviceRegistration',
  '-allowProvisioningUpdates',
  '-checkFirstLaunchStatus',
  '-create-xcframework',
  '-disableAutomaticPackageResolution',
  '-disablePackageRepositoryCache',
  '-downloadAllPlatforms',
  '-enumerate-tests',
  '-exportArchive',
  '-exportLocalizations',
  '-exportNotarizedApp',
  '-help',
  '-hideShellScriptEnvironment',
  '-importLocalizations',
  '-includeScreenshots',
  '-json',
  '-license',
  '-list',
  '-mergeImport',
  '-onlyUsePackageVersionsFromResolvedFile',
  '-parallelizeTargets',
  '-prepareDeviceSupport',
  '-quiet',
  '-resolvePackageDependencies',
  '-retry-tests-on-failure',
  '-runFirstLaunch',
  '-run-tests-until-failure',
  '-showBuildSettings',
  '-showBuildSettingsForIndex',
  '-showBuildTimingSummary',
  '-showTestPlans',
  '-showdestinations',
  '-showsdks',
  '-skipMacroValidation',
  '-skipPackageSignatureValidation',
  '-skipPackageUpdates',
  '-skipPackagePluginValidation',
  '-skipUnavailableActions',
  '-usage',
  '-verbose',
  '-version',
]);

const valueTakingXcodebuildExtraArgKeys = new Set([
  '-arch',
  '-architecture',
  '-architectureVariant',
  '-archivePath',
  '-authenticationKeyID',
  '-authenticationKeyIssuerID',
  '-authenticationKeyPath',
  '-buildVersion',
  '-clonedSourcePackagesDirPath',
  '-collect-test-diagnostics',
  '-configuration',
  '-defaultLanguage',
  '-defaultPackageRegistryURL',
  '-default-test-execution-time-allowance',
  '-deleteComponent',
  '-derivedDataPath',
  '-destination',
  '-destination-timeout',
  '-downloadComponent',
  '-downloadPlatform',
  '-enableAddressSanitizer',
  '-enableCodeCoverage',
  '-enablePerformanceTestsDiagnostics',
  '-enableThreadSanitizer',
  '-enableUndefinedBehaviorSanitizer',
  '-exportLanguage',
  '-exportOptionsPlist',
  '-exportPath',
  '-find-executable',
  '-find-library',
  '-framework',
  '-headers',
  '-importComponent',
  '-importPath',
  '-importPlatform',
  '-jobs',
  '-library',
  '-localizationPath',
  '-maximum-concurrent-test-device-destinations',
  '-maximum-concurrent-test-simulator-destinations',
  '-maximum-parallel-testing-workers',
  '-maximum-test-execution-time-allowance',
  '-modelCode',
  '-only-test-configuration',
  '-only-testing',
  '-osVersion',
  '-output',
  '-packageAuthorizationProvider',
  '-packageCachePath',
  '-packageDependencySCMToRegistryTransformation',
  '-packageFingerprintPolicy',
  '-packageSigningEntityPolicy',
  '-parallel-testing-enabled',
  '-parallel-testing-worker-count',
  '-platform',
  '-project',
  '-resultBundlePath',
  '-resultBundleVersion',
  '-resultStreamPath',
  '-scheme',
  '-scmProvider',
  '-sdk',
  '-showComponent',
  '-skip-test-configuration',
  '-skip-testing',
  '-target',
  '-test-enumeration-format',
  '-test-enumeration-output-path',
  '-test-enumeration-style',
  '-test-iterations',
  '-test-repetition-relaunch-enabled',
  '-test-timeouts-enabled',
  '-testLanguage',
  '-testPlan',
  '-testProductsPath',
  '-testRegion',
  '-toolchain',
  '-workspace',
  '-xcconfig',
  '-xctestrun',
]);

type ExtraArgGroup = {
  key: string | null;
  args: unknown[];
};

function findBuildSettingAssignmentIndex(arg: string): number {
  let bracketDepth = 0;

  for (let index = 0; index < arg.length; index += 1) {
    const char = arg[index];
    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === '=' && bracketDepth === 0) {
      return index;
    }
  }

  return -1;
}

function getExtraArgKey(arg: string): string | null {
  if (arg.startsWith('-')) {
    const separatorIndexes = [arg.indexOf(':'), arg.indexOf('=')].filter((index) => index !== -1);
    const separatorIndex = Math.min(...separatorIndexes);

    return separatorIndexes.length === 0 ? arg : arg.slice(0, separatorIndex);
  }

  const equalsIndex = findBuildSettingAssignmentIndex(arg);
  return equalsIndex === -1 ? null : arg.slice(0, equalsIndex);
}

function isStandaloneOption(arg: string): boolean {
  return arg.startsWith('-') && !arg.includes(':') && !arg.includes('=');
}

function hasInlineOptionValue(arg: string): boolean {
  return arg.startsWith('-') && (arg.includes(':') || arg.includes('='));
}

function isKnownXcodebuildOption(arg: string): boolean {
  const key = getExtraArgKey(arg);
  return (
    key !== null &&
    (valuelessXcodebuildExtraArgKeys.has(key) || valueTakingXcodebuildExtraArgKeys.has(key))
  );
}

function canTreatAsSeparatedOptionValue(optionArg: string, valueArg: string): boolean {
  const key = getExtraArgKey(optionArg);
  if (key === null || !isStandaloneOption(optionArg) || valuelessXcodebuildExtraArgKeys.has(key)) {
    return false;
  }

  if (valueTakingXcodebuildExtraArgKeys.has(key)) {
    return !isKnownXcodebuildOption(valueArg);
  }

  return !valueArg.startsWith('-') && findBuildSettingAssignmentIndex(valueArg) === -1;
}

// Consume each token once so values cannot also become override keys; preserve group and token order.
function groupExtraArgs(args: readonly unknown[]): ExtraArgGroup[] {
  const groups: ExtraArgGroup[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== 'string') {
      groups.push({ key: null, args: [arg] });
      continue;
    }

    const key = getExtraArgKey(arg);
    const groupedArgs: unknown[] = [arg];
    const nextArg = args[index + 1];
    if (
      key !== null &&
      !hasInlineOptionValue(arg) &&
      typeof nextArg === 'string' &&
      canTreatAsSeparatedOptionValue(arg, nextArg)
    ) {
      groupedArgs.push(nextArg);
      index += 1;
    }

    groups.push({ key, args: groupedArgs });
  }

  return groups;
}

function filterOverriddenExtraArgs(
  defaultExtraArgs: readonly unknown[],
  overriddenKeys: Set<string>,
): unknown[] {
  return groupExtraArgs(defaultExtraArgs)
    .filter((group) => group.key === null || !overriddenKeys.has(group.key))
    .flatMap((group) => group.args);
}

function mergeExtraArgs(
  defaultExtraArgs: readonly unknown[],
  explicitExtraArgs: readonly unknown[],
): unknown[] {
  if (explicitExtraArgs.length === 0) {
    return [];
  }

  const overriddenKeys = new Set(
    groupExtraArgs(explicitExtraArgs)
      .map((group) => group.key)
      .filter((key): key is string => key !== null),
  );
  if (overriddenKeys.size === 0) {
    return [...defaultExtraArgs, ...explicitExtraArgs];
  }

  return [...filterOverriddenExtraArgs(defaultExtraArgs, overriddenKeys), ...explicitExtraArgs];
}

export function mergeSessionDefaultArgs(opts: {
  defaults: Record<string, unknown>;
  explicitArgs: Record<string, unknown>;
  exclusivePairs?: readonly ExclusiveParameterGroup[];
}): Record<string, unknown> {
  const sanitizedArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts.explicitArgs)) {
    if (!hasConcreteSessionDefaultValue(value)) {
      continue;
    }
    sanitizedArgs[key] = value;
  }

  const merged: Record<string, unknown> = { ...opts.defaults, ...sanitizedArgs };

  if (
    Object.prototype.hasOwnProperty.call(sanitizedArgs, 'extraArgs') &&
    Array.isArray(opts.defaults.extraArgs) &&
    Array.isArray(sanitizedArgs.extraArgs)
  ) {
    merged.extraArgs = mergeExtraArgs(opts.defaults.extraArgs, sanitizedArgs.extraArgs);
  }

  if (
    opts.defaults.env &&
    typeof opts.defaults.env === 'object' &&
    !Array.isArray(opts.defaults.env) &&
    sanitizedArgs.env &&
    typeof sanitizedArgs.env === 'object' &&
    !Array.isArray(sanitizedArgs.env)
  ) {
    merged.env = {
      ...(opts.defaults.env as Record<string, string>),
      ...(sanitizedArgs.env as Record<string, string>),
    };
  }

  for (const pair of opts.exclusivePairs ?? []) {
    const userProvidedConcrete = pair.some((key) =>
      Object.prototype.hasOwnProperty.call(sanitizedArgs, key),
    );
    if (!userProvidedConcrete) {
      continue;
    }

    for (const key of pair) {
      if (!Object.prototype.hasOwnProperty.call(sanitizedArgs, key) && key in merged) {
        delete merged[key];
      }
    }
  }

  for (const pair of opts.exclusivePairs ?? []) {
    const allFromDefaults = pair.every(
      (key) => !Object.prototype.hasOwnProperty.call(sanitizedArgs, key),
    );
    if (!allFromDefaults) {
      continue;
    }

    const presentKeys = pair.filter((key) => hasConcreteSessionDefaultValue(merged[key]));
    if (presentKeys.length <= 1) {
      continue;
    }

    for (let index = 1; index < presentKeys.length; index += 1) {
      delete merged[presentKeys[index]];
    }
  }

  return merged;
}
