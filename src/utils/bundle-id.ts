import type { CommandExecutor } from './command.ts';

async function executeSyncCommand(command: string, executor: CommandExecutor): Promise<string> {
  const result = await executor(['/bin/sh', '-c', command], 'Bundle ID Extraction');
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
    return await executeSyncCommand(`defaults read "${appPath}/Info" CFBundleIdentifier`, executor);
  } catch {
    return await executeSyncCommand(
      `/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "${appPath}/Info.plist"`,
      executor,
    );
  }
}
