#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cliPath = path.join(repoRoot, 'build', 'cli.js');

function fail(message, detail) {
  console.error(`\n❌ ${message}`);
  if (detail) {
    console.error(detail);
  }
  process.exit(1);
}

function loadToolCatalog() {
  if (!existsSync(cliPath)) {
    fail(
      'Missing build artifact: build/cli.js',
      'Run `npm run build:tsup` before `npm run docs:check`.',
    );
  }

  const result = spawnSync(process.execPath, [cliPath, 'tools', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    fail('Failed to load CLI tool catalog from build artifact.', result.stderr || result.stdout);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
    fail('Could not parse JSON from `node build/cli.js tools --json`.', message);
  }
}

function getConsumerDocs() {
  return [path.join(repoRoot, 'README.md'), path.join(repoRoot, 'CHANGELOG.md')];
}

function buildValidationSets(catalog) {
  const validPairs = new Set();
  const validWorkflows = new Set();

  if (!Array.isArray(catalog.workflows)) {
    fail('Tool catalog does not contain a workflows array.');
  }

  for (const workflow of catalog.workflows) {
    if (!workflow || typeof workflow.workflow !== 'string') {
      continue;
    }

    validWorkflows.add(workflow.workflow);

    if (!Array.isArray(workflow.tools)) {
      continue;
    }

    for (const tool of workflow.tools) {
      if (tool && typeof tool.name === 'string') {
        validPairs.add(`${workflow.workflow} ${tool.name}`);
      }
    }
  }

  return { validPairs, validWorkflows };
}

function extractCommandCandidates(content) {
  const lines = content.split(/\r?\n/u);
  const candidates = [];
  const inlineCodeRegex = /`([^`\n]+)`/g;
  const fenceHeaderRegex = /^\s*(?:```|~~~)([a-z0-9_-]*)\s*$/iu;
  const codeFenceLanguages = new Set(['', 'bash', 'sh', 'zsh', 'shell', 'console']);

  let inFence = false;
  let shouldScanFence = false;

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const line = lines[lineNumber - 1];
    const fenceMatch = line.match(fenceHeaderRegex);

    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        shouldScanFence = codeFenceLanguages.has(fenceMatch[1].toLowerCase());
      } else {
        inFence = false;
        shouldScanFence = false;
      }
      continue;
    }

    if (inFence) {
      if (shouldScanFence) {
        candidates.push({ lineNumber, text: line });
      }
      continue;
    }

    inlineCodeRegex.lastIndex = 0;
    let inlineMatch = inlineCodeRegex.exec(line);
    while (inlineMatch) {
      candidates.push({ lineNumber, text: inlineMatch[1] });
      inlineMatch = inlineCodeRegex.exec(line);
    }
  }

  return candidates;
}

function findInvalidCommands(files, validPairs, validWorkflows) {
  const validTopLevel = new Set(['mcp', 'tools', 'daemon', 'init', 'setup', 'upgrade']);
  const validDaemonActions = new Set(['status', 'start', 'stop', 'restart', 'list']);
  const findings = [];

  const commandRegex =
    /(?:^|[^a-z0-9-])xcodebuildmcp(?!-)\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g;

  for (const absoluteFilePath of files) {
    const relativePath = path.relative(repoRoot, absoluteFilePath) || absoluteFilePath;
    const content = readFileSync(absoluteFilePath, 'utf8');
    const candidates = extractCommandCandidates(content);

    for (const candidate of candidates) {
      const { lineNumber, text } = candidate;
      commandRegex.lastIndex = 0;
      let match = commandRegex.exec(text);

      while (match) {
        const first = match[1];
        const second = match[2];
        const command = second ? `${first} ${second}` : first;

        let valid = false;

        if (!second) {
          valid = validTopLevel.has(first) || validWorkflows.has(first);
        } else if (first === 'daemon') {
          valid = validDaemonActions.has(second);
        } else {
          valid = validPairs.has(command);
        }

        if (!valid) {
          findings.push(`${relativePath}:${lineNumber}: ${command}`);
        }

        match = commandRegex.exec(text);
      }
    }
  }

  return findings;
}

function main() {
  const catalog = loadToolCatalog();
  const files = getConsumerDocs();
  const { validPairs, validWorkflows } = buildValidationSets(catalog);
  const findings = findInvalidCommands(files, validPairs, validWorkflows);

  if (findings.length > 0) {
    fail(
      'Found invalid CLI command references in consumer docs.',
      `${findings.join('\n')}\n\nRun \`node build/cli.js tools\` to inspect valid commands.`,
    );
  }

  console.log('✅ Docs CLI command check passed (README.md + CHANGELOG.md).');
}

main();
