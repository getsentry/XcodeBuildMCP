import type { CommandExecutor } from './command.ts';

async function runSpawn(
  command: string[],
  executor: CommandExecutor,
  logPrefix: string,
): Promise<string> {
  const result = await executor(command, logPrefix, false);
  if (!result.success) {
    throw new Error(result.error ?? 'Command failed');
  }
  return result.output || '';
}

export async function extractBundleIdFromAppPath(
  appPath: string,
  executor: CommandExecutor,
): Promise<string> {
  try {
    return await runSpawn(
      ['defaults', 'read', `${appPath}/Info`, 'CFBundleIdentifier'],
      executor,
      'Bundle ID Extraction',
    );
  } catch {
    return await runSpawn(
      ['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleIdentifier', `${appPath}/Info.plist`],
      executor,
      'Bundle ID Extraction',
    );
  }
}
