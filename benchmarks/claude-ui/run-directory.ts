#!/usr/bin/env tsx
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { main } from '../../src/benchmarks/claude-ui/harness.ts';

async function directoryExists(directory: string): Promise<boolean> {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

async function suitePaths(directory: string): Promise<string[]> {
  if (!(await directoryExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')),
    )
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function run(): Promise<number> {
  const directory = process.argv[2];
  const maybeLabel = process.argv[3];
  const label = maybeLabel && !maybeLabel.startsWith('-') ? maybeLabel : directory;
  const forwardedArgs =
    maybeLabel && !maybeLabel.startsWith('-') ? process.argv.slice(4) : process.argv.slice(3);
  if (!directory) {
    console.error('Usage: run-directory.ts <suite-directory> [label] [benchmark args...]');
    return 1;
  }

  const suites = await suitePaths(directory);
  if (suites.length === 0) {
    console.error(`No ${label} Claude UI benchmark suites found in ${directory}`);
    return 1;
  }

  for (const suite of suites) {
    const exitCode = await main(['--suite', suite, ...forwardedArgs]);
    if (exitCode !== 0) return exitCode;
  }
  return 0;
}

run()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
