/**
 * Headless launch policy.
 *
 * When `XCODEBUILDMCP_HEADLESS_LAUNCH=1` is set, GUI launches that would
 * otherwise steal window focus on macOS are suppressed:
 *
 * - macOS app launches use `open -g` (run in background, no foreground steal).
 * - Simulator.app launches are skipped entirely; `simctl boot` alone keeps
 *   the simulator runtime available for `simctl` UI automation without
 *   surfacing a window.
 *
 * This is intended for snapshot/smoke tests and other CI-style runs. It is
 * deliberately off by default so MCP/CLI behaviour in production is unchanged.
 */

const HEADLESS_LAUNCH_ENV_VAR = 'XCODEBUILDMCP_HEADLESS_LAUNCH';

export function isHeadlessLaunchMode(): boolean {
  const value = process.env[HEADLESS_LAUNCH_ENV_VAR];
  if (!value) {
    return false;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Build the argv to launch a macOS application bundle via `open`.
 * In headless launch mode, `-g` is added so the app does not become foreground.
 */
export function buildOpenAppCommand(appPath: string, opts?: { args?: string[] }): string[] {
  const command: string[] = ['open'];
  if (isHeadlessLaunchMode()) {
    command.push('-g');
  }
  command.push(appPath);
  if (opts?.args?.length) {
    command.push('--args', ...opts.args);
  }
  return command;
}

/**
 * Build the argv to surface Simulator.app, or `null` to indicate the launch
 * should be skipped (headless mode — `simctl boot` is sufficient).
 */
export function buildOpenSimulatorAppCommand(opts?: { simulatorId?: string }): string[] | null {
  if (isHeadlessLaunchMode()) {
    return null;
  }
  const command = ['open', '-a', 'Simulator'];
  if (opts?.simulatorId) {
    command.push('--args', '-CurrentDeviceUDID', opts.simulatorId);
  }
  return command;
}
