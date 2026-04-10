import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';

type BenchmarkMode = 'warm' | 'cold';

type BenchmarkTool = 'xcodebuildmcp' | 'flowdeck';

interface RunMetrics {
  tool: BenchmarkTool;
  iteration: number;
  exitCode: number | null;
  wallClockMs: number;
  firstStdoutMs: number | null;
  firstMilestoneMs: number | null;
  startupToFirstStreamedTestProgressMs: number | null;
  stdoutPath: string;
  stderrPath: string;
}

interface RunCommandParams {
  tool: BenchmarkTool;
  command: string;
  args: string[];
  cwd: string;
  artifactPrefix: string;
  milestonePattern: RegExp;
  streamedTestProgressPattern: RegExp;
}

function parseArgs(): { iterations: number; mode: BenchmarkMode } {
  const args = process.argv.slice(2);
  let iterations = 1;
  let mode: BenchmarkMode = 'warm';

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--iterations') {
      iterations = Number(args[index + 1] ?? '1');
      index += 1;
      continue;
    }
    if (argument === '--mode') {
      const nextMode = args[index + 1] ?? 'warm';
      if (nextMode === 'warm' || nextMode === 'cold') {
        mode = nextMode;
      }
      index += 1;
    }
  }

  return { iterations, mode };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*[A-Za-z]/gu, '');
}

function isSpinnerFrame(line: string): boolean {
  return ['◒', '◐', '◓', '◑', '│'].includes(line);
}

function normalizeTerminalTranscript(text: string): string {
  const cleaned = stripAnsi(text).replace(/\r/gu, '\n').replace(/[\u0004\u0008]/gu, '');
  const lines = cleaned.split('\n');
  const normalizedLines: string[] = [];
  let joinedCharacterRun = '';

  const flushCharacterRun = (): void => {
    const line = joinedCharacterRun.trim();
    if (line) {
      normalizedLines.push(line);
    }
    joinedCharacterRun = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed || isSpinnerFrame(trimmed)) {
      continue;
    }

    if (trimmed.length === 1 || /^[.()0-9,]+$/u.test(trimmed)) {
      joinedCharacterRun += trimmed;
      continue;
    }

    flushCharacterRun();
    normalizedLines.push(trimmed);
  }

  flushCharacterRun();
  return normalizedLines.join('\n');
}

async function ensureScriptAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/script', ['-q', '/dev/null', 'true'], {
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`/usr/bin/script exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function runCommand(params: RunCommandParams): Promise<RunMetrics> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const start = performance.now();
  let firstStdoutMs: number | null = null;
  let firstMilestoneMs: number | null = null;
  let startupToFirstStreamedTestProgressMs: number | null = null;
  let normalizedStdout = '';

  const child = spawn('/usr/bin/script', ['-q', '/dev/null', params.command, ...params.args], {
    cwd: params.cwd,
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk: Buffer) => {
    if (firstStdoutMs === null) {
      firstStdoutMs = performance.now() - start;
    }

    const text = chunk.toString();
    stdoutChunks.push(text);
    normalizedStdout += normalizeTerminalTranscript(text);

    if (firstMilestoneMs === null && params.milestonePattern.test(normalizedStdout)) {
      firstMilestoneMs = performance.now() - start;
    }

    if (
      startupToFirstStreamedTestProgressMs === null &&
      params.streamedTestProgressPattern.test(normalizedStdout)
    ) {
      startupToFirstStreamedTestProgressMs = performance.now() - start;
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString());
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const stdoutPath = `${params.artifactPrefix}.stdout.txt`;
  const stderrPath = `${params.artifactPrefix}.stderr.txt`;
  await writeFile(stdoutPath, normalizeTerminalTranscript(stdoutChunks.join('')));
  await writeFile(stderrPath, normalizeTerminalTranscript(stderrChunks.join('')));

  return {
    tool: params.tool,
    iteration: 0,
    exitCode,
    wallClockMs: performance.now() - start,
    firstStdoutMs,
    firstMilestoneMs,
    startupToFirstStreamedTestProgressMs,
    stdoutPath,
    stderrPath,
  };
}

async function main(): Promise<void> {
  const { iterations, mode } = parseArgs();
  await ensureScriptAvailable();

  const repoRoot = process.cwd();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(repoRoot, 'benchmarks', 'simulator-test', timestamp);
  await mkdir(outputDir, { recursive: true });

  const workspacePath = path.join(repoRoot, 'example_projects', 'iOS_Calculator', 'CalculatorApp.xcworkspace');
  const xcodebuildmcpDerivedDataPath = path.join(outputDir, 'derived-data-xcodebuildmcp');
  const flowdeckDerivedDataPath = path.join(outputDir, 'derived-data-flowdeck');
  const xcodebuildmcpPayload = JSON.stringify({
    workspacePath,
    scheme: 'CalculatorApp',
    simulatorName: 'iPhone 17 Pro',
    useLatestOS: true,
    extraArgs: ['-only-testing:CalculatorAppTests'],
    progress: true,
    derivedDataPath: xcodebuildmcpDerivedDataPath,
  });

  const results: RunMetrics[] = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    if (mode === 'cold') {
      await rm(xcodebuildmcpDerivedDataPath, { recursive: true, force: true });
      await rm(flowdeckDerivedDataPath, { recursive: true, force: true });
    }

    const xcodebuildmcpResult = await runCommand({
      tool: 'xcodebuildmcp',
      command: './build/cli.js',
      args: ['simulator', 'test', '--json', xcodebuildmcpPayload, '--output', 'text'],
      cwd: repoRoot,
      artifactPrefix: path.join(outputDir, `xcodebuildmcp-run-${iteration}`),
      milestonePattern: /📦\s*Resolving\s*packages|🛠️\s*Compiling|🧪\s*(?:Starting\s*tests|Running\s*tests)/u,
      streamedTestProgressPattern: /🧪\s*(?:Starting\s*tests|Running\s*tests)/u,
    });
    xcodebuildmcpResult.iteration = iteration;
    results.push(xcodebuildmcpResult);

    const flowdeckResult = await runCommand({
      tool: 'flowdeck',
      command: 'flowdeck',
      args: [
        'test',
        '-w',
        workspacePath,
        '-s',
        'CalculatorApp',
        '-S',
        'iPhone 17 Pro',
        '--only',
        'CalculatorAppTests',
        '--progress',
        '-d',
        flowdeckDerivedDataPath,
      ],
      cwd: repoRoot,
      artifactPrefix: path.join(outputDir, `flowdeck-run-${iteration}`),
      milestonePattern: /Resolving Package Graph|Compiling\.\.\.|Running tests/u,
      streamedTestProgressPattern: /Running tests/u,
    });
    flowdeckResult.iteration = iteration;
    results.push(flowdeckResult);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    iterations,
    workspacePath,
    results,
  };

  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
