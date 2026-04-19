import type { Argv } from 'yargs';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import * as clack from '@clack/prompts';
import {
  version as currentVersion,
  packageName,
  repositoryOwner,
  repositoryName,
} from '../../utils/version/index.ts';
import { isInteractiveTTY } from '../interactive/prompts.ts';

// --- Types ---

interface AutoUpgradeMethod {
  kind: 'homebrew' | 'npm-global';
  manualCommand: string;
  autoCommands: string[][];
}

interface ManualOnlyMethod {
  kind: 'npx' | 'unknown';
  manualInstructions: string[];
}

export type InstallMethod = AutoUpgradeMethod | ManualOnlyMethod;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
}

export type VersionComparison = 'older' | 'equal' | 'newer';

export interface LatestReleaseInfo {
  tagName: string;
  version: string;
  name: string | undefined;
  body: string;
  htmlUrl: string;
  publishedAt: string | undefined;
}

export interface UpgradeDependencies {
  currentVersion: string;
  packageName: string;
  repositoryOwner: string;
  repositoryName: string;
  fetchLatestRelease: () => Promise<LatestReleaseInfo>;
  detectInstallMethod: () => InstallMethod;
  spawnUpgradeProcess: (commands: string[][]) => Promise<number>;
  isInteractive: () => boolean;
}

export interface UpgradeOptions {
  check: boolean;
  yes: boolean;
}

// --- Version comparison ---

export function parseVersion(raw: string): ParsedVersion | undefined {
  const stripped = raw.startsWith('v') ? raw.slice(1) : raw;
  const match = stripped.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:\+[a-zA-Z0-9.]+)?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

function comparePrereleaseIdentifiers(a: string, b: string): number {
  const aParts = a.split('.');
  const bParts = b.split('.');
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    if (i >= aParts.length) return -1;
    if (i >= bParts.length) return 1;

    const aIsNum = /^\d+$/.test(aParts[i]);
    const bIsNum = /^\d+$/.test(bParts[i]);

    if (aIsNum && bIsNum) {
      const diff = Number(aParts[i]) - Number(bParts[i]);
      if (diff !== 0) return diff;
      continue;
    }

    if (aIsNum) return -1;
    if (bIsNum) return 1;

    const cmp = aParts[i].localeCompare(bParts[i]);
    if (cmp !== 0) return cmp;
  }

  return 0;
}

export function compareVersions(current: ParsedVersion, latest: ParsedVersion): VersionComparison {
  for (const field of ['major', 'minor', 'patch'] as const) {
    if (current[field] < latest[field]) return 'older';
    if (current[field] > latest[field]) return 'newer';
  }

  if (current.prerelease !== undefined && latest.prerelease !== undefined) {
    const cmp = comparePrereleaseIdentifiers(current.prerelease, latest.prerelease);
    if (cmp < 0) return 'older';
    if (cmp > 0) return 'newer';
    return 'equal';
  }

  if (current.prerelease !== undefined && latest.prerelease === undefined) return 'older';
  if (current.prerelease === undefined && latest.prerelease !== undefined) return 'newer';

  return 'equal';
}

// --- Install method detection ---

export function collectCandidatePaths(): string[] {
  const candidates: string[] = [];

  if (process.argv[1]) {
    candidates.push(process.argv[1]);
    try {
      candidates.push(fs.realpathSync(process.argv[1]));
    } catch {
      // Symlink resolution may fail
    }
  }

  if (process.execPath) {
    candidates.push(process.execPath);
    try {
      candidates.push(fs.realpathSync(process.execPath));
    } catch {
      // Skip
    }
  }

  return candidates;
}

export function detectInstallMethodFromPaths(
  pkgName: string,
  candidatePaths: string[],
): InstallMethod {
  const normalized = candidatePaths.map((p) => p.toLowerCase());

  const isNpx = normalized.some(
    (p) => p.includes('/_npx/') && p.includes(`/node_modules/${pkgName}/`),
  );
  if (isNpx) {
    return {
      kind: 'npx',
      manualInstructions: [
        'npx always fetches the latest version by default when using @latest.',
        'If you pinned a specific version, update the version in your MCP client config.',
      ],
    };
  }

  const isHomebrew = normalized.some(
    (p) => p.includes(`/cellar/${pkgName}/`) || p.includes(`/homebrew/cellar/${pkgName}/`),
  );
  if (isHomebrew) {
    return {
      kind: 'homebrew',
      manualCommand: `brew update && brew upgrade ${pkgName}`,
      autoCommands: [
        ['brew', 'update'],
        ['brew', 'upgrade', pkgName],
      ],
    };
  }

  const isNpmGlobal = normalized.some((p) => p.includes(`/node_modules/${pkgName}/`));
  if (isNpmGlobal) {
    return {
      kind: 'npm-global',
      manualCommand: `npm install -g ${pkgName}@latest`,
      autoCommands: [['npm', 'install', '-g', `${pkgName}@latest`]],
    };
  }

  return {
    kind: 'unknown',
    manualInstructions: [
      `Homebrew:   brew update && brew upgrade ${pkgName}`,
      `npm:        npm install -g ${pkgName}@latest`,
      `npx:        npx always fetches the latest when using @latest`,
    ],
  };
}

// --- Release fetch ---

interface GitHubReleaseResponse {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
}

export async function fetchLatestReleaseFromGitHub(
  owner: string,
  name: string,
  pkgVersion: string,
): Promise<LatestReleaseInfo> {
  const url = `https://api.github.com/repos/${owner}/${name}/releases/latest`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `xcodebuildmcp/${pkgVersion}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out after 10 seconds');
      }
      throw error;
    }

    if (response.status === 403 || response.status === 429) {
      throw new Error('GitHub API rate limit exceeded. Try again later.');
    }

    if (!response.ok) {
      throw new Error(`GitHub API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as GitHubReleaseResponse;

    if (!data.tag_name) {
      throw new Error('GitHub release response missing tag_name');
    }

    if (!data.html_url) {
      throw new Error('GitHub release response missing html_url');
    }

    const version = data.tag_name.startsWith('v') ? data.tag_name.slice(1) : data.tag_name;

    return {
      tagName: data.tag_name,
      version,
      name: data.name ?? undefined,
      body: data.body ?? '',
      htmlUrl: data.html_url,
      publishedAt: data.published_at ?? undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// --- Release notes rendering ---

export function truncateReleaseNotes(body: string, releaseUrl: string): string {
  const MAX_LINES = 20;
  const MAX_CHARS = 2000;

  const normalized = body.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) {
    return `Full release notes: ${releaseUrl}`;
  }

  const lines = normalized.split('\n');
  const included: string[] = [];
  let charCount = 0;
  let truncated = false;

  for (const line of lines) {
    if (included.length >= MAX_LINES) {
      truncated = true;
      break;
    }
    const nextCharCount = charCount + (included.length > 0 ? 1 : 0) + line.length;
    if (nextCharCount > MAX_CHARS && included.length > 0) {
      truncated = true;
      break;
    }
    included.push(line);
    charCount = nextCharCount;
  }

  let result = included.join('\n');
  if (truncated) {
    result += '\n\n... (truncated)';
  }
  result += `\n\nFull release notes: ${releaseUrl}`;
  return result;
}

// --- Spawn runner ---

function defaultSpawnUpgradeProcess(commands: string[][]): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentIndex = 0;

    function runNext(): void {
      if (currentIndex >= commands.length) {
        resolve(0);
        return;
      }

      const [cmd, ...args] = commands[currentIndex];
      const child = spawn(cmd, args, { stdio: 'inherit' });

      const forwardSigint = (): void => {
        child.kill('SIGINT');
      };
      const forwardSigterm = (): void => {
        child.kill('SIGTERM');
      };

      process.on('SIGINT', forwardSigint);
      process.on('SIGTERM', forwardSigterm);

      const cleanup = (): void => {
        process.removeListener('SIGINT', forwardSigint);
        process.removeListener('SIGTERM', forwardSigterm);
      };

      child.on('error', (err) => {
        cleanup();
        reject(err);
      });

      child.on('close', (code) => {
        cleanup();
        if (code !== 0) {
          resolve(code ?? 1);
          return;
        }
        currentIndex++;
        runNext();
      });
    }

    runNext();
  });
}

// --- Default dependencies ---

function createDefaultDependencies(): UpgradeDependencies {
  return {
    currentVersion,
    packageName,
    repositoryOwner,
    repositoryName,
    fetchLatestRelease: () =>
      fetchLatestReleaseFromGitHub(repositoryOwner, repositoryName, currentVersion),
    detectInstallMethod: () => detectInstallMethodFromPaths(packageName, collectCandidatePaths()),
    spawnUpgradeProcess: defaultSpawnUpgradeProcess,
    isInteractive: isInteractiveTTY,
  };
}

// --- Helpers ---

function isAutoUpgradeMethod(method: InstallMethod): method is AutoUpgradeMethod {
  return method.kind === 'homebrew' || method.kind === 'npm-global';
}

function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function writeError(text: string): void {
  process.stderr.write(`${text}\n`);
}

// --- Main command logic ---

export async function runUpgradeCommand(
  options: UpgradeOptions,
  deps?: Partial<UpgradeDependencies>,
): Promise<number> {
  const d = { ...createDefaultDependencies(), ...deps };
  const isTTY = d.isInteractive();

  if (isTTY) {
    clack.intro('XcodeBuildMCP Upgrade');
  }

  const installMethod = d.detectInstallMethod();

  let release: LatestReleaseInfo;
  try {
    if (isTTY) {
      const s = clack.spinner();
      s.start('Checking for updates...');
      try {
        release = await d.fetchLatestRelease();
        s.stop('Update check complete.');
      } catch (error) {
        s.stop('Update check failed.');
        throw error;
      }
    } else {
      release = await d.fetchLatestRelease();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (isTTY) {
      clack.log.error(`Failed to check for updates: ${reason}`);
      clack.log.info(`Current version: ${d.currentVersion}`);
      clack.log.info(`Install method: ${installMethod.kind}`);
      if (isAutoUpgradeMethod(installMethod)) {
        clack.log.info(`Manual upgrade: ${installMethod.manualCommand}`);
      }
      clack.outro('');
    } else {
      writeError(`Failed to check for updates: ${reason}`);
      writeLine(`Current version: ${d.currentVersion}`);
      writeLine(`Install method: ${installMethod.kind}`);
      if (isAutoUpgradeMethod(installMethod)) {
        writeLine(`Manual upgrade: ${installMethod.manualCommand}`);
      }
    }

    return 1;
  }

  const parsedCurrent = parseVersion(d.currentVersion);
  const parsedLatest = parseVersion(release.version);

  if (!parsedCurrent || !parsedLatest) {
    const msg = `Cannot compare versions: current=${d.currentVersion}, latest=${release.version}`;
    if (isTTY) {
      clack.log.error(msg);
      clack.outro('');
    } else {
      writeError(msg);
    }
    return 1;
  }

  const comparison = compareVersions(parsedCurrent, parsedLatest);

  if (comparison === 'equal') {
    const msg = `Already up to date (${d.currentVersion}).`;
    if (isTTY) {
      clack.log.success(msg);
      clack.outro('');
    } else {
      writeLine(msg);
    }
    return 0;
  }

  if (comparison === 'newer') {
    const msg = `Local version (${d.currentVersion}) is ahead of latest release (${release.version}).`;
    if (isTTY) {
      clack.log.info(msg);
      clack.outro('');
    } else {
      writeLine(msg);
    }
    return 0;
  }

  const versionLine = `${d.currentVersion} → ${release.version}`;
  const releaseName = release.name ? ` — ${release.name}` : '';
  const publishedLine = release.publishedAt
    ? `Published: ${release.publishedAt.split('T')[0]}`
    : '';
  const notes = truncateReleaseNotes(release.body, release.htmlUrl);

  if (isTTY) {
    clack.log.step(`Update available: ${versionLine}${releaseName}`);
    if (publishedLine) clack.log.info(publishedLine);
    clack.log.info(`Install method: ${installMethod.kind}`);
    clack.note(notes, 'Release Notes');
  } else {
    writeLine(`Update available: ${versionLine}${releaseName}`);
    if (publishedLine) writeLine(publishedLine);
    writeLine(`Install method: ${installMethod.kind}`);
    writeLine('');
    writeLine(notes);
    writeLine('');
  }

  if (options.check) {
    if (isTTY) clack.outro('');
    return 0;
  }

  if (installMethod.kind === 'npx') {
    for (const instruction of installMethod.manualInstructions) {
      if (isTTY) {
        clack.log.info(instruction);
      } else {
        writeLine(instruction);
      }
    }
    if (isTTY) clack.outro('');
    return 0;
  }

  if (installMethod.kind === 'unknown') {
    if (isTTY) {
      clack.log.info('Could not detect install method. Upgrade manually:');
      for (const instruction of installMethod.manualInstructions) {
        clack.log.message(`  ${instruction}`);
      }
      clack.outro('');
    } else {
      writeLine('Could not detect install method. Upgrade manually:');
      for (const instruction of installMethod.manualInstructions) {
        writeLine(`  ${instruction}`);
      }
    }
    return 0;
  }

  if (!isAutoUpgradeMethod(installMethod)) {
    return 0;
  }

  if (options.yes) {
    return executeUpgrade(installMethod, d, isTTY);
  }

  if (!isTTY) {
    writeLine(`Run: ${installMethod.manualCommand}`);
    writeLine('Or re-run with --yes to upgrade automatically.');
    return 1;
  }

  const confirmed = await clack.confirm({
    message: `Upgrade via ${installMethod.kind}?`,
    initialValue: true,
  });

  if (clack.isCancel(confirmed) || !confirmed) {
    clack.log.info('Upgrade skipped.');
    clack.outro('');
    return 0;
  }

  return executeUpgrade(installMethod, d, isTTY);
}

async function executeUpgrade(
  method: AutoUpgradeMethod,
  deps: UpgradeDependencies,
  isTTY: boolean,
): Promise<number> {
  if (isTTY) {
    clack.log.step(`Running: ${method.manualCommand}`);
  } else {
    writeLine(`Running: ${method.manualCommand}`);
  }

  const exitCode = await deps.spawnUpgradeProcess(method.autoCommands);

  if (exitCode !== 0) {
    const msg = `Upgrade process exited with code ${exitCode}.`;
    if (isTTY) {
      clack.log.error(msg);
      clack.outro('');
    } else {
      writeError(msg);
    }
    return exitCode;
  }

  if (isTTY) {
    clack.log.success('Upgrade complete.');
    clack.outro('');
  } else {
    writeLine('Upgrade complete.');
  }

  return 0;
}

// --- Yargs registration ---

export function registerUpgradeCommand(app: Argv): void {
  app.command(
    'upgrade',
    'Check for updates and upgrade XcodeBuildMCP',
    (yargs) =>
      yargs
        .option('check', {
          type: 'boolean',
          default: false,
          describe: 'Check for updates without upgrading',
        })
        .option('yes', {
          type: 'boolean',
          alias: 'y',
          default: false,
          describe: 'Skip confirmation and upgrade automatically',
        }),
    async (argv) => {
      const exitCode = await runUpgradeCommand({
        check: argv.check as boolean,
        yes: argv.yes as boolean,
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    },
  );
}
