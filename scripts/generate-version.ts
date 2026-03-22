import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface PackageJson {
  name: string;
  version: string;
  iOSTemplateVersion: string;
  macOSTemplateVersion: string;
  repository?: {
    url?: string;
  };
}

function parseGitHubOwnerAndName(url: string): { owner: string; name: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub owner/name from repository URL: ${url}`);
  }
  return { owner: match[1], name: match[2] };
}

const VERSION_REGEX = /^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.\-]+)?(\+[a-zA-Z0-9.\-]+)?$/;

function validateVersion(name: string, value: string): void {
  if (!VERSION_REGEX.test(value)) {
    throw new Error(
      `Invalid ${name} in package.json: ${JSON.stringify(value)}. Expected a version string.`,
    );
  }
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const packagePath = path.join(repoRoot, 'package.json');
  const versionPath = path.join(repoRoot, 'src', 'version.ts');

  const raw = await readFile(packagePath, 'utf8');
  const pkg = JSON.parse(raw) as PackageJson;

  const repoUrl = pkg.repository?.url;
  if (!repoUrl) {
    throw new Error('package.json must have a repository.url field');
  }

  const repo = parseGitHubOwnerAndName(repoUrl);

  validateVersion('version', pkg.version);
  validateVersion('iOSTemplateVersion', pkg.iOSTemplateVersion);
  validateVersion('macOSTemplateVersion', pkg.macOSTemplateVersion);

  const content =
    `export const version = ${JSON.stringify(pkg.version)};\n` +
    `export const iOSTemplateVersion = ${JSON.stringify(pkg.iOSTemplateVersion)};\n` +
    `export const macOSTemplateVersion = ${JSON.stringify(pkg.macOSTemplateVersion)};\n` +
    `export const packageName = ${JSON.stringify(pkg.name)};\n` +
    `export const repositoryOwner = ${JSON.stringify(repo.owner)};\n` +
    `export const repositoryName = ${JSON.stringify(repo.name)};\n`;

  await writeFile(versionPath, content, 'utf8');
}

main().catch((error) => {
  console.error('Failed to generate src/version.ts:', error);
  process.exit(1);
});
