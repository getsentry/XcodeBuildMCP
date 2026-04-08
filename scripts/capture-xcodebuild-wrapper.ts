#!/usr/bin/env tsx

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

interface WrapperCaptureRecord {
  timestamp: string;
  cwd: string;
  argv: string[];
}

function parseArgs(): string[] {
  const forwardedArgs = process.argv.slice(2);
  if (forwardedArgs.length === 0) {
    throw new Error('Usage: npm run capture:xcodebuild -- <command> [args...]');
  }

  return forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;
}

function resolveRealXcodebuild(): string {
  const result = spawnSync('xcrun', ['-f', 'xcodebuild'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Unable to resolve xcodebuild via xcrun');
  }

  const resolvedPath = result.stdout.trim();
  if (!resolvedPath) {
    throw new Error('xcrun returned an empty xcodebuild path');
  }

  return resolvedPath;
}

async function createWrapperScript(wrapperDir: string): Promise<string> {
  const wrapperPath = path.join(wrapperDir, 'xcodebuild');
  const script = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawn } = require('node:child_process');

const logPath = process.env.XCODEBUILD_WRAPPER_LOG_PATH;
const realPath = process.env.XCODEBUILD_WRAPPER_REAL_PATH;

if (!logPath || !realPath) {
  process.stderr.write('xcodebuild wrapper is missing required environment variables\\n');
  process.exit(1);
}

appendFileSync(
  logPath,
  JSON.stringify({
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    argv: process.argv.slice(2),
  }) + '\\n',
);

const child = spawn(realPath, process.argv.slice(2), { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  process.stderr.write(String(error) + '\\n');
  process.exit(1);
});
`;

  await writeFile(wrapperPath, script, { mode: 0o755 });
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function main(): Promise<void> {
  const command = parseArgs();
  const realXcodebuildPath = resolveRealXcodebuild();
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'xcodebuild-wrapper-'));
  const wrapperDir = path.join(tempRoot, 'bin');
  const logDir = path.join(process.cwd(), 'benchmarks', 'xcodebuild-wrapper');
  const logPath = path.join(logDir, `${new Date().toISOString().replace(/[:.]/gu, '-')}.jsonl`);

  await mkdir(wrapperDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  await createWrapperScript(wrapperDir);

  const child = spawn(command[0]!, command.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${wrapperDir}:${process.env.PATH ?? ''}`,
      XCODEBUILD_WRAPPER_LOG_PATH: logPath,
      XCODEBUILD_WRAPPER_REAL_PATH: realXcodebuildPath,
    },
    stdio: 'inherit',
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  const recordsText = await readFile(logPath, 'utf8').catch(() => '');
  const records = recordsText
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WrapperCaptureRecord);

  process.stdout.write(`\nCaptured ${records.length} xcodebuild invocation(s)\n`);
  process.stdout.write(`Log: ${logPath}\n`);
  for (const [index, record] of records.entries()) {
    process.stdout.write(`\n#${index + 1} ${record.timestamp}\n`);
    process.stdout.write(`cwd: ${record.cwd}\n`);
    process.stdout.write(`argv: ${record.argv.join(' ')}\n`);
  }

  await rm(tempRoot, { recursive: true, force: true });
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
