import { execSync } from 'node:child_process';

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
