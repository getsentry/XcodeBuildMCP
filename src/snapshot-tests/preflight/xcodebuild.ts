import path from 'node:path';
import {
  runExternalCommand,
  runExternalCommandChecked,
  type ExternalCommandRunner,
} from './command-runner.ts';

export interface BuildAppOptions {
  projectPath?: string;
  workspacePath?: string;
  scheme: string;
  destination: string;
  derivedDataPath: string;
  configuration?: string;
  sdk?: string;
  extraArgs?: string[];
}

export async function buildApp(
  options: BuildAppOptions,
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<void> {
  if ((options.projectPath === undefined) === (options.workspacePath === undefined)) {
    throw new Error('Exactly one of projectPath or workspacePath is required');
  }

  const containerArgs = options.projectPath
    ? ['-project', options.projectPath]
    : ['-workspace', options.workspacePath!];
  const args = [
    ...containerArgs,
    '-scheme',
    options.scheme,
    '-configuration',
    options.configuration ?? 'Debug',
    '-destination',
    options.destination,
    '-derivedDataPath',
    options.derivedDataPath,
  ];
  if (options.sdk) {
    args.push('-sdk', options.sdk);
  }
  args.push('build', ...(options.extraArgs ?? []));

  await runExternalCommandChecked(
    'xcodebuild',
    args,
    { timeoutMs: 300_000 },
    runner,
    `Build ${options.scheme}`,
  );
}

export function builtAppPath(
  derivedDataPath: string,
  productName: string,
  platform: 'iphonesimulator' | 'iphoneos' | 'macosx',
  configuration = 'Debug',
): string {
  const suffix = platform === 'macosx' ? configuration : `${configuration}-${platform}`;
  return path.join(derivedDataPath, 'Build', 'Products', suffix, `${productName}.app`);
}
