import { execSync } from 'node:child_process';
import { XcodeToolsBridgeClient } from '../integrations/xcode-tools-bridge/client.ts';

const BRIDGE_PROBE_TIMEOUT_MS = 8_000;

export function isXcodeIdeBridgeAvailable(): boolean {
  try {
    execSync('xcrun --find mcpbridge', {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: BRIDGE_PROBE_TIMEOUT_MS,
    });
    execSync('pgrep -x Xcode', {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: BRIDGE_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

export async function listAvailableXcodeIdeBridgeToolNames(): Promise<Set<string>> {
  const client = new XcodeToolsBridgeClient();
  try {
    await client.connectOnce();
    const tools = await client.listTools();
    return new Set(tools.map((tool) => tool.name));
  } finally {
    await client.disconnect();
  }
}
