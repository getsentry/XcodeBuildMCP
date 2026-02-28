/**
 * xcodemake Utilities - Support for using xcodemake as an alternative build strategy
 *
 * This utility module provides functions for using xcodemake (https://github.com/johnno1962/xcodemake)
 * as an alternative build strategy for Xcode projects. xcodemake logs xcodebuild output to generate
 * a Makefile for an Xcode project, allowing for faster incremental builds using the "make" command.
 *
 * Responsibilities:
 * - Checking if xcodemake is enabled via environment variable
 * - Executing xcodemake commands with proper argument handling
 * - Converting xcodebuild arguments to xcodemake arguments
 * - Handling xcodemake-specific output and error reporting
 * - Auto-downloading xcodemake if enabled but not found
 */

import { log } from './logger.ts';
import type { CommandResponse } from './command.ts';
import { getDefaultCommandExecutor } from './command.ts';
import { existsSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { getConfig } from './config-store.ts';

// Environment variable to control xcodemake usage
export const XCODEMAKE_ENV_VAR = 'INCREMENTAL_BUILDS_ENABLED';

// Store the overridden path for xcodemake if needed
let overriddenXcodemakePath: string | null = null;

/**
 * Check if xcodemake is enabled via environment variable
 * @returns boolean indicating if xcodemake should be used
 */
export function isXcodemakeEnabled(): boolean {
  return getConfig().incrementalBuildsEnabled;
}

/**
 * Get the xcodemake command to use
 * @returns The command string for xcodemake
 */
function getXcodemakeCommand(): string {
  return overriddenXcodemakePath ?? 'xcodemake';
}

function isExecutable(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Check whether xcodemake binary is currently resolvable without side effects.
 * This does not attempt download or installation.
 */
export function isXcodemakeBinaryAvailable(): boolean {
  if (overriddenXcodemakePath && isExecutable(overriddenXcodemakePath)) {
    return true;
  }

  const pathValue = process.env.PATH ?? '';
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, 'xcodemake');
    if (isExecutable(candidate)) {
      return true;
    }
  }

  return false;
}

/**
 * Override the xcodemake command path
 * @param path Path to the xcodemake executable
 */
function overrideXcodemakeCommand(path: string): void {
  overriddenXcodemakePath = path;
  log('info', `Using overridden xcodemake path: ${path}`);
}

/**
 * Install xcodemake by downloading it from GitHub
 * @returns Promise resolving to boolean indicating if installation was successful
 */
async function installXcodemake(): Promise<boolean> {
  const tempDir = os.tmpdir();
  const xcodemakeDir = path.join(tempDir, 'xcodebuildmcp');
  const xcodemakePath = path.join(xcodemakeDir, 'xcodemake');

  log('info', `Attempting to install xcodemake to ${xcodemakePath}`);

  try {
    // Create directory if it doesn't exist
    await fs.mkdir(xcodemakeDir, { recursive: true });

    // Download the script
    log('info', 'Downloading xcodemake from GitHub...');
    const response = await fetch(
      'https://raw.githubusercontent.com/cameroncooke/xcodemake/main/xcodemake',
    );

    if (!response.ok) {
      throw new Error(`Failed to download xcodemake: ${response.status} ${response.statusText}`);
    }

    const scriptContent = await response.text();
    await fs.writeFile(xcodemakePath, scriptContent, 'utf8');

    // Make executable
    await fs.chmod(xcodemakePath, 0o755);
    log('info', 'Made xcodemake executable');

    // Override the command to use the direct path
    overrideXcodemakeCommand(xcodemakePath);

    return true;
  } catch (error) {
    log(
      'error',
      `Error installing xcodemake: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Check if xcodemake is installed and available. If enabled but not available, attempts to download it.
 * @returns Promise resolving to boolean indicating if xcodemake is available
 */
export async function isXcodemakeAvailable(): Promise<boolean> {
  // First check if xcodemake is enabled, if not, no need to check or install
  if (!isXcodemakeEnabled()) {
    log('debug', 'xcodemake is not enabled, skipping availability check');
    return false;
  }

  try {
    // Check if we already have an overridden path
    if (overriddenXcodemakePath && existsSync(overriddenXcodemakePath)) {
      log('debug', `xcodemake found at overridden path: ${overriddenXcodemakePath}`);
      return true;
    }

    // Check if xcodemake is available in PATH
    const result = await getDefaultCommandExecutor()(['which', 'xcodemake']);
    if (result.success) {
      log('debug', 'xcodemake found in PATH');
      return true;
    }

    log('info', 'xcodemake not found in PATH, attempting to download...');
    const installed = await installXcodemake();
    if (!installed) {
      log('warn', 'xcodemake installation failed');
      return false;
    }

    log('info', 'xcodemake installed successfully');
    return true;
  } catch (error) {
    log(
      'error',
      `Error checking for xcodemake: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Check if a Makefile exists in the current directory
 * @returns boolean indicating if a Makefile exists
 */
export function doesMakefileExist(projectDir: string): boolean {
  return existsSync(`${projectDir}/Makefile`);
}

/**
 * Check if a Makefile log exists in the current directory
 * @param projectDir Directory containing the Makefile
 * @param command Command array to check for log file
 * @returns boolean indicating if a Makefile log exists
 */
export function doesMakeLogFileExist(projectDir: string, command: string[]): boolean {
  // Change to the project directory as xcodemake requires being in the project dir
  const originalDir = process.cwd();

  try {
    process.chdir(projectDir);

    // Construct the expected log filename
    const xcodemakeCommand = ['xcodemake', ...command.slice(1)];
    const escapedCommand = xcodemakeCommand.map((arg) => {
      // Remove projectDir from arguments if present at the start
      const prefix = projectDir + '/';
      if (arg.startsWith(prefix)) {
        return arg.substring(prefix.length);
      }
      return arg;
    });
    const commandString = escapedCommand.join(' ');
    const logFileName = `${commandString}.log`;
    log('debug', `Checking for Makefile log: ${logFileName} in directory: ${process.cwd()}`);

    // Read directory contents and check if the file exists
    const files = readdirSync('.');
    const exists = files.includes(logFileName);
    log('debug', `Makefile log ${exists ? 'exists' : 'does not exist'}: ${logFileName}`);
    return exists;
  } catch (error) {
    // Log potential errors like directory not found, permissions issues, etc.
    log(
      'error',
      `Error checking for Makefile log: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  } finally {
    // Always restore the original directory
    process.chdir(originalDir);
  }
}

/**
 * Execute an xcodemake command to generate a Makefile
 * @param buildArgs Build arguments to pass to xcodemake (without the 'xcodebuild' command)
 * @param logPrefix Prefix for logging
 * @returns Promise resolving to command response
 */
export async function executeXcodemakeCommand(
  projectDir: string,
  buildArgs: string[],
  logPrefix: string,
): Promise<CommandResponse> {
  const xcodemakeCommand = [getXcodemakeCommand(), ...buildArgs];

  // Remove projectDir from arguments if present at the start
  const prefix = projectDir + '/';
  const command = xcodemakeCommand.map((arg) => {
    if (arg.startsWith(prefix)) {
      return arg.substring(prefix.length);
    }
    return arg;
  });

  return getDefaultCommandExecutor()(command, logPrefix, false, { cwd: projectDir });
}

/**
 * Execute a make command for incremental builds
 * @param projectDir Directory containing the Makefile
 * @param logPrefix Prefix for logging
 * @returns Promise resolving to command response
 */
export async function executeMakeCommand(
  projectDir: string,
  logPrefix: string,
): Promise<CommandResponse> {
  const command = ['make'];
  return getDefaultCommandExecutor()(command, logPrefix, false, { cwd: projectDir });
}
