import { log } from './logger.ts';
import type { CommandResponse } from './command.ts';
import { getDefaultCommandExecutor } from './command.ts';
import { existsSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import { getConfig } from './config-store.ts';

let overriddenXcodemakePath: string | null = null;

export function isXcodemakeEnabled(): boolean {
  return getConfig().incrementalBuildsEnabled;
}

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

function overrideXcodemakeCommand(path: string): void {
  overriddenXcodemakePath = path;
  log('info', `Using overridden xcodemake path: ${path}`);
}

async function installXcodemake(): Promise<boolean> {
  const tempDir = os.tmpdir();
  const xcodemakeDir = path.join(tempDir, 'xcodebuildmcp');
  const xcodemakePath = path.join(xcodemakeDir, 'xcodemake');

  log('info', `Attempting to install xcodemake to ${xcodemakePath}`);

  try {
    await fs.mkdir(xcodemakeDir, { recursive: true });

    log('info', 'Downloading xcodemake from GitHub...');
    const response = await fetch(
      'https://raw.githubusercontent.com/cameroncooke/xcodemake/main/xcodemake',
    );

    if (!response.ok) {
      throw new Error(`Failed to download xcodemake: ${response.status} ${response.statusText}`);
    }

    const scriptContent = await response.text();
    await fs.writeFile(xcodemakePath, patchXcodemakeScript(scriptContent), 'utf8');

    await fs.chmod(xcodemakePath, 0o755);
    log('info', 'Made xcodemake executable');

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

export async function isXcodemakeAvailable(): Promise<boolean> {
  if (!isXcodemakeEnabled()) {
    log('debug', 'xcodemake is not enabled, skipping availability check');
    return false;
  }

  try {
    if (overriddenXcodemakePath && existsSync(overriddenXcodemakePath)) {
      log('debug', `xcodemake found at overridden path: ${overriddenXcodemakePath}`);
      return true;
    }

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

export function doesMakefileExist(projectDir: string): boolean {
  return existsSync(`${projectDir}/Makefile`);
}

function sanitizeXcodemakeLogTag(args: string[]): string {
  const sanitized = ['xcodemake', ...args]
    .join('_')
    .replace(/[/:]+/g, '_')
    .replace(/[^\p{L}\p{N}._+=,@ -]+/gu, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'xcodemake';
}

function getXcodemakeLogFileName(args: string[]): string {
  const logSuffix = `-${createHash('md5').update(args.join('\0')).digest('hex')}.log`;
  const maxLogNameLength = 150;
  const maxLogTagLength = Math.max(0, maxLogNameLength - logSuffix.length);
  const logTag = sanitizeXcodemakeLogTag(args).slice(0, maxLogTagLength).replace(/_+$/g, '');

  return `${logTag || 'xcodemake'}${logSuffix}`;
}

function patchXcodemakeScript(scriptContent: string): string {
  const patchedImports = scriptContent.includes('use Digest::MD5 qw(md5_hex);')
    ? scriptContent
    : scriptContent.replace('use IO::File;\n', 'use IO::File;\nuse Digest::MD5 qw(md5_hex);\n');

  return patchedImports
    .replace(
      'my $log = "xcodemake @original_ARGV.log";',
      `my $logTag = join "_", ("xcodemake", @original_ARGV);
$logTag =~ s{[/:]+}{_}g;
$logTag =~ s{[^[:alnum:]._+=,@ -]+}{_}g;
$logTag =~ s{\\s+}{_}g;
$logTag =~ s{_+}{_}g;
$logTag =~ s{^_+|_+$}{}g;
$logTag ||= "xcodemake";
my $maxLogNameLength = 150;
my $logSuffix = "-" . md5_hex(join "\\0", @original_ARGV) . ".log";
$logTag = substr($logTag, 0, $maxLogNameLength - length($logSuffix));
$logTag =~ s{_+$}{};
my $log = ($logTag || "xcodemake") . $logSuffix;`,
    )
    .replaceAll(
      `dollarEscape($make_dep_source);
                unescape("'", $make_dep_source);`,
      `dollarEscape($make_dep_source);
                unescape("'", $make_dep_source);
                escape(" ", $make_dep_source);`,
    );
}

export function doesMakeLogFileExist(projectDir: string, command: string[]): boolean {
  try {
    const xcodemakeCommand = ['xcodemake', ...command.slice(1)];
    const escapedCommand = xcodemakeCommand.map((arg) => {
      // Remove projectDir from arguments if present at the start
      const prefix = projectDir + '/';
      if (arg.startsWith(prefix)) {
        return arg.substring(prefix.length);
      }
      return arg;
    });
    const logFileName = getXcodemakeLogFileName(escapedCommand.slice(1));
    log('debug', `Checking for Makefile log: ${logFileName} in directory: ${projectDir}`);

    const files = readdirSync(projectDir);
    const exists = files.includes(logFileName);
    log('debug', `Makefile log ${exists ? 'exists' : 'does not exist'}: ${logFileName}`);
    return exists;
  } catch (error) {
    log(
      'error',
      `Error checking for Makefile log: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export async function executeXcodemakeCommand(
  projectDir: string,
  buildArgs: string[],
  logPrefix: string,
): Promise<CommandResponse> {
  const xcodemakeCommand = [getXcodemakeCommand(), ...buildArgs];
  const prefix = projectDir + '/';
  const command = xcodemakeCommand.map((arg) => {
    if (arg.startsWith(prefix)) {
      return arg.substring(prefix.length);
    }
    return arg;
  });

  return getDefaultCommandExecutor()(command, logPrefix, false, { cwd: projectDir });
}

export async function executeMakeCommand(
  projectDir: string,
  logPrefix: string,
): Promise<CommandResponse> {
  const command = ['make'];
  return getDefaultCommandExecutor()(command, logPrefix, false, { cwd: projectDir });
}
