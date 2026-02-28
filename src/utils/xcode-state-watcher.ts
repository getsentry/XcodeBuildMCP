/**
 * Xcode IDE State Watcher
 *
 * Watches Xcode's UserInterfaceState.xcuserstate file for changes and
 * automatically syncs scheme/simulator selection to session defaults.
 *
 * Uses chokidar for reliable FSEvents-based file watching on macOS.
 */

import { watch, type FSWatcher } from 'chokidar';
import { log } from './logger.ts';
import { parseXcuserstate } from './nskeyedarchiver-parser.ts';
import { sessionStore } from './session-store.ts';
import { findXcodeStateFile, lookupSimulatorName } from './xcode-state-reader.ts';
import type { CommandExecutor } from './execution/index.ts';
import { getDefaultCommandExecutor } from './execution/index.ts';

interface WatcherState {
  watcher: FSWatcher | null;
  watchedPath: string | null;
  cachedScheme: string | null;
  cachedSimulatorId: string | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  executor: CommandExecutor | null;
  cwd: string | null;
  projectPath: string | null;
  workspacePath: string | null;
}

const state: WatcherState = {
  watcher: null,
  watchedPath: null,
  cachedScheme: null,
  cachedSimulatorId: null,
  debounceTimer: null,
  executor: null,
  cwd: null,
  projectPath: null,
  workspacePath: null,
};

const DEBOUNCE_MS = 300;

/**
 * Look up bundle ID for a scheme using xcodebuild -showBuildSettings
 */
export async function lookupBundleId(
  executor: CommandExecutor,
  scheme: string,
  projectPath?: string | null,
  workspacePath?: string | null,
): Promise<string | undefined> {
  const args = ['xcodebuild', '-showBuildSettings', '-scheme', scheme, '-skipPackageUpdates'];

  if (workspacePath) {
    args.push('-workspace', workspacePath);
  } else if (projectPath) {
    args.push('-project', projectPath);
  } else {
    // No project/workspace specified, let xcodebuild find it
  }

  const result = await executor(args, 'Get bundle ID from build settings', false);

  if (!result.success) {
    log('debug', `[xcode-watcher] Failed to get build settings: ${result.error}`);
    return undefined;
  }

  // Parse PRODUCT_BUNDLE_IDENTIFIER from output
  const match = result.output.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*(.+)/);
  if (match) {
    return match[1].trim();
  }

  return undefined;
}

/**
 * Extract scheme and simulator ID from xcuserstate file
 */
function extractState(filePath: string): { scheme: string | null; simulatorId: string | null } {
  try {
    const result = parseXcuserstate(filePath);
    return {
      scheme: result.scheme ?? null,
      simulatorId: result.simulatorId ?? null,
    };
  } catch (e) {
    log('warn', `[xcode-watcher] Failed to parse xcuserstate: ${e}`);
    return { scheme: null, simulatorId: null };
  }
}

/**
 * Handle file change event (debounced)
 */
function handleFileChange(): void {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    processFileChange().catch((e) => {
      log('warn', `[xcode-watcher] Error processing file change: ${e}`);
    });
  }, DEBOUNCE_MS);
}

/**
 * Process the file change and update session defaults
 */
async function processFileChange(): Promise<void> {
  if (!state.watchedPath) return;

  const newState = extractState(state.watchedPath);

  const schemeChanged = newState.scheme !== state.cachedScheme;
  const simulatorChanged = newState.simulatorId !== state.cachedSimulatorId;

  if (!schemeChanged && !simulatorChanged) {
    log('debug', '[xcode-watcher] File changed but scheme/simulator unchanged');
    return;
  }

  const updates: Record<string, string> = {};

  if (schemeChanged && newState.scheme) {
    updates.scheme = newState.scheme;
    log('info', `[xcode-watcher] Scheme changed: "${state.cachedScheme}" -> "${newState.scheme}"`);
    state.cachedScheme = newState.scheme;
  }

  if (simulatorChanged && newState.simulatorId) {
    updates.simulatorId = newState.simulatorId;
    log(
      'info',
      `[xcode-watcher] Simulator changed: "${state.cachedSimulatorId}" -> "${newState.simulatorId}"`,
    );
    state.cachedSimulatorId = newState.simulatorId;
  }

  // Update session defaults immediately with scheme/simulatorId
  if (Object.keys(updates).length > 0) {
    sessionStore.setDefaults(updates);
    log('info', `[xcode-watcher] Session defaults updated: ${JSON.stringify(updates)}`);
  }

  // Look up simulator name asynchronously (non-blocking)
  if (simulatorChanged && newState.simulatorId && state.executor && state.cwd) {
    lookupSimulatorName({ executor: state.executor, cwd: state.cwd }, newState.simulatorId)
      .then((name) => {
        if (name) {
          sessionStore.setDefaults({ simulatorName: name });
          log('info', `[xcode-watcher] Simulator name resolved: "${name}"`);
        }
      })
      .catch((e) => {
        log('debug', `[xcode-watcher] Failed to lookup simulator name: ${e}`);
      });
  }

  // Look up bundle ID asynchronously when scheme changes (non-blocking)
  if (schemeChanged && newState.scheme && state.executor) {
    lookupBundleId(state.executor, newState.scheme, state.projectPath, state.workspacePath)
      .then((bundleId) => {
        if (bundleId) {
          sessionStore.setDefaults({ bundleId });
          log('info', `[xcode-watcher] Bundle ID resolved: "${bundleId}"`);
        }
      })
      .catch((e) => {
        log('debug', `[xcode-watcher] Failed to lookup bundle ID: ${e}`);
      });
  }
}

export interface StartWatcherOptions {
  executor?: CommandExecutor;
  cwd?: string;
  searchRoot?: string;
  workspacePath?: string;
  projectPath?: string;
}

/**
 * Start watching the xcuserstate file for changes
 */
export async function startXcodeStateWatcher(options: StartWatcherOptions = {}): Promise<boolean> {
  if (state.watcher) {
    log('debug', '[xcode-watcher] Watcher already running');
    return true;
  }

  const executor = options.executor ?? getDefaultCommandExecutor();
  const cwd = options.cwd ?? process.cwd();

  const xcuserstatePath = await findXcodeStateFile({
    executor,
    cwd,
    searchRoot: options.searchRoot,
    workspacePath: options.workspacePath,
    projectPath: options.projectPath,
  });

  if (!xcuserstatePath) {
    log('debug', '[xcode-watcher] No xcuserstate file found, watcher not started');
    return false;
  }

  // Initialize cached state
  const initialState = extractState(xcuserstatePath);
  state.cachedScheme = initialState.scheme;
  state.cachedSimulatorId = initialState.simulatorId;
  state.watchedPath = xcuserstatePath;
  state.executor = executor;
  state.cwd = cwd;
  state.projectPath = options.projectPath ?? null;
  state.workspacePath = options.workspacePath ?? null;

  log(
    'info',
    `[xcode-watcher] Starting watcher for ${xcuserstatePath} (scheme="${initialState.scheme}", sim="${initialState.simulatorId}")`,
  );

  state.watcher = watch(xcuserstatePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  state.watcher.on('change', () => {
    log('debug', '[xcode-watcher] File change detected');
    handleFileChange();
  });

  state.watcher.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log('warn', `[xcode-watcher] Watcher error: ${message}`);
  });

  return true;
}

/**
 * Stop the xcuserstate watcher
 */
export async function stopXcodeStateWatcher(): Promise<void> {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }

  if (state.watcher) {
    await state.watcher.close();
    state.watcher = null;
    state.watchedPath = null;
    state.executor = null;
    state.cwd = null;
    state.projectPath = null;
    state.workspacePath = null;
    log('info', '[xcode-watcher] Watcher stopped');
  }
}

/**
 * Check if the watcher is currently running
 */
export function isWatcherRunning(): boolean {
  return state.watcher !== null;
}

/**
 * Get the currently watched path
 */
export function getWatchedPath(): string | null {
  return state.watchedPath;
}
