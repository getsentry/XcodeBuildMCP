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

  const content =
    `export const version = '${pkg.version}';\n` +
    `export const iOSTemplateVersion = '${pkg.iOSTemplateVersion}';\n` +
    `export const macOSTemplateVersion = '${pkg.macOSTemplateVersion}';\n` +
    `export const packageName = '${pkg.name}';\n` +
    `export const repositoryOwner = '${repo.owner}';\n` +
    `export const repositoryName = '${repo.name}';\n`;

  await writeFile(versionPath, content, 'utf8');
}

main().catch((error) => {
  console.error('Failed to generate src/version.ts:', error);
  process.exit(1);
});
