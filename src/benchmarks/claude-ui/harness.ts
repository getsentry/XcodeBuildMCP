import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { compareBenchmark } from './compare.ts';
import { loadSuite, sessionDefaultEnvNames, validateSessionDefaults } from './config.ts';
import { dismissFirstRunPrompts } from './first-run-preflight.ts';
import { createProgressReporter, type ProgressReporter } from './progress.ts';
import { renderAggregate, renderSuiteReport } from './render.ts';
import {
  deleteTemporarySimulator,
  prepareTemporarySimulator,
  resolveTemporarySimulatorPlan,
  type CreatedTemporarySimulator,
  type LifecycleCommandExecutor,
} from './simulator-lifecycle.ts';
import { analyzeClaudeJsonl } from './transcript.ts';
import type {
  BenchmarkArtifacts,
  BenchmarkConfig,
  BenchmarkResult,
  BenchmarkRunMetadata,
  TemporarySimulatorRunMetadata,
} from './types.ts';
import type { SessionDefaults } from '../../utils/session-store.ts';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceDir, '../../..');
const suitesDir = path.join(repoRoot, 'benchmarks/claude-ui/suites');
const bundledParserPath = path.join(repoRoot, 'benchmarks/claude-ui/parse_claude_conversation.py');
const parserEnvName = 'CLAUDE_UI_BENCHMARK_PARSER';
const serverName = 'xcodebuildmcp-dev';
const mcpToolPrefix = `mcp__${serverName}__`;
const sessionDefaultEnvNameSet = new Set(Object.values(sessionDefaultEnvNames));
interface CommandResult {
  exitCode: number | null;
  durationSeconds: number;
}

export function resolveSuitePath(suite: string): string {
  if (
    path.isAbsolute(suite) ||
    suite.includes(path.sep) ||
    suite.endsWith('.yml') ||
    suite.endsWith('.yaml')
  ) {
    return path.resolve(suite);
  }
  return path.join(suitesDir, `${suite}.yml`);
}

export async function listSuitePaths(): Promise<string[]> {
  const entries = await readdir(suitesDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')),
    )
    .map((entry) => path.join(suitesDir, entry.name))
    .sort();
}

export function requireSuitePaths(suitePaths: string[]): string[] {
  if (suitePaths.length === 0) {
    throw new Error('no suite files found in benchmarks/claude-ui/suites');
  }
  return suitePaths;
}

function suiteSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) throw new Error(`invalid suite name '${name}'`);
  return slug;
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function resolveFrom(baseDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

export async function resolveParserPath(parserPath: string | undefined): Promise<string> {
  const configured = parserPath ?? process.env[parserEnvName] ?? bundledParserPath;
  const resolved = path.resolve(configured);
  try {
    await access(resolved);
  } catch {
    throw new Error(`Claude UI benchmark parser does not exist: ${resolved}`);
  }
  return resolved;
}

function sessionDefaultsWithTemporarySimulator(
  config: BenchmarkConfig,
  temporarySimulator: CreatedTemporarySimulator | undefined,
): SessionDefaults | undefined {
  if (!temporarySimulator) return config.sessionDefaults;
  const defaults = { ...config.sessionDefaults };
  delete defaults.simulatorName;
  return {
    ...defaults,
    simulatorId: temporarySimulator.simulatorId,
  };
}

const sessionDefaultPathKeys = new Set(['workspacePath', 'projectPath', 'derivedDataPath']);

function shouldResolveSessionDefaultPath(key: string, value: string): boolean {
  if (!sessionDefaultPathKeys.has(key)) return false;
  if (path.isAbsolute(value) || value.startsWith('~')) return false;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function isolatedSessionDefaults(
  config: BenchmarkConfig,
  workingDirectory: string,
  temporarySimulator: CreatedTemporarySimulator | undefined,
): SessionDefaults | undefined {
  const defaults = validateSessionDefaults(
    sessionDefaultsWithTemporarySimulator(config, temporarySimulator),
  );
  if (!defaults) return undefined;

  const resolved = { ...defaults };
  for (const [key, value] of Object.entries(defaults)) {
    if (typeof value === 'string' && shouldResolveSessionDefaultPath(key, value)) {
      if (key === 'workspacePath' || key === 'projectPath' || key === 'derivedDataPath') {
        resolved[key] = path.resolve(workingDirectory, value);
      }
    }
  }
  return resolved;
}

export function resolveBenchmarkSimulatorId(
  config: BenchmarkConfig,
  temporarySimulator: CreatedTemporarySimulator | undefined,
): string | undefined {
  return (
    temporarySimulator?.simulatorId ??
    (typeof config.sessionDefaults?.simulatorId === 'string'
      ? config.sessionDefaults.simulatorId
      : undefined)
  );
}

export function requireFirstRunPreflightSimulatorId(
  config: BenchmarkConfig,
  temporarySimulator: CreatedTemporarySimulator | undefined,
): string | undefined {
  const simulatorId = resolveBenchmarkSimulatorId(config, temporarySimulator);
  if (config.firstRunPromptDismissals && !simulatorId) {
    throw new Error(
      'firstRunPromptDismissals requires a temporary simulator or sessionDefaults.simulatorId',
    );
  }
  return simulatorId;
}

export async function writeMcpConfig(opts: {
  config: BenchmarkConfig;
  mcpConfigPath: string;
  mcpWorkspaceDirectory: string;
  mcpWorkspaceConfigPath: string;
  workingDirectory: string;
  temporarySimulator?: CreatedTemporarySimulator;
}): Promise<void> {
  const sessionDefaults = isolatedSessionDefaults(
    opts.config,
    opts.workingDirectory,
    opts.temporarySimulator,
  );
  const isolatedConfig = {
    schemaVersion: 1,
    enabledWorkflows: ['simulator', 'ui-automation'],
    debug: true,
    sentryDisabled: true,
    sessionDefaults: sessionDefaults ?? {},
  };
  const mcpConfig = {
    mcpServers: {
      [serverName]: {
        type: 'stdio',
        command: 'node',
        args: [path.join(repoRoot, 'build/cli.js'), 'mcp'],
        env: {
          XCODEBUILDMCP_DEBUG: 'true',
          XCODEBUILDMCP_SENTRY_DISABLED: 'true',
          XCODEBUILDMCP_CWD: opts.mcpWorkspaceDirectory,
        },
      },
    },
  };

  await mkdir(path.dirname(opts.mcpWorkspaceConfigPath), { recursive: true });
  await writeFile(opts.mcpWorkspaceConfigPath, stringifyYaml(isolatedConfig), 'utf8');
  await writeFile(opts.mcpConfigPath, `${JSON.stringify(mcpConfig, null, 2)}\n`, 'utf8');
}

export function claudeBenchmarkEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const name of sessionDefaultEnvNameSet) delete env[name];
  delete env.XCODEBUILDMCP_CWD;
  return env;
}

function runCommand(opts: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  stdoutPath: string;
  stderrPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const stdout = createWriteStream(opts.stdoutPath);
    const stderr = createWriteStream(opts.stderrPath);
    const started = process.hrtime.bigint();
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.on('error', reject);
    child.on('close', (exitCode) => {
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      Promise.all([finished(stdout), finished(stderr)])
        .then(() => resolve({ exitCode, durationSeconds }))
        .catch(reject);
    });

    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

async function runParser(
  artifacts: BenchmarkArtifacts,
  parserPath: string,
): Promise<number | null> {
  const result = await runCommand({
    command: 'python3',
    args: [
      parserPath,
      artifacts.claudeJsonlPath,
      artifacts.parsedDirectory,
      `--tool-prefix=${mcpToolPrefix}`,
    ],
    cwd: repoRoot,
    stdoutPath: artifacts.parseLogPath,
    stderrPath: `${artifacts.parseLogPath}.stderr`,
  });
  return result.exitCode;
}

function normalizeStoredResult(result: BenchmarkResult): BenchmarkResult {
  if (
    !result.sequence ||
    !Array.isArray(result.sequence.missing) ||
    !Array.isArray(result.sequence.additional)
  ) {
    throw new Error(
      'unsupported result.json: expected sequence.missing and sequence.additional arrays',
    );
  }

  const mode = result.sequence.mode ?? 'warn';
  const matched =
    result.sequence.matched ??
    (result.sequence.missing.length === 0 && result.sequence.additional.length === 0);
  const sequencePass = matched || mode === 'warn';

  return {
    ...result,
    pass: result.metrics.every((item) => item.pass) && result.failureMetric.pass && sequencePass,
    sequence: {
      ...result.sequence,
      mode,
      matched,
      pass: sequencePass,
    },
  };
}

async function readStoredResult(
  resultPathOrDirectory: string,
): Promise<BenchmarkResult | BenchmarkResult[]> {
  const resolved = path.resolve(resultPathOrDirectory);
  const resultPath = (await stat(resolved)).isDirectory()
    ? path.join(resolved, 'result.json')
    : resolved;
  const raw = JSON.parse(await readFile(resultPath, 'utf8')) as BenchmarkResult | BenchmarkResult[];
  return Array.isArray(raw) ? raw.map(normalizeStoredResult) : normalizeStoredResult(raw);
}

function temporarySimulatorMetadata(
  temporarySimulator: CreatedTemporarySimulator | undefined,
  setupDurationSeconds: number,
): TemporarySimulatorRunMetadata | undefined {
  if (!temporarySimulator) return undefined;
  return {
    simulatorId: temporarySimulator.simulatorId,
    name: temporarySimulator.name,
    lifecycleLogPath: temporarySimulator.logPath,
    setupDurationSeconds,
    deletionAttempted: false,
  };
}

function recordTemporarySimulatorDeletion(
  metadata: TemporarySimulatorRunMetadata | undefined,
  deletion: Awaited<ReturnType<typeof deleteTemporarySimulator>>,
): void {
  if (!metadata) return;
  metadata.deletionAttempted = deletion.attempted;
  metadata.deletionSucceeded = deletion.succeeded;
  metadata.deleteExitCode = deletion.exitCode;
  if (deletion.error) metadata.deleteError = deletion.error;
}

export async function runSuite(
  suitePath: string,
  opts: {
    simulatorExecutor?: LifecycleCommandExecutor;
    progress?: ProgressReporter;
    parserPath?: string;
  } = {},
): Promise<BenchmarkResult> {
  const config = await loadSuite(suitePath);
  const parserPath = await resolveParserPath(opts.parserPath);
  const slug = suiteSlug(config.name);
  const runTimestamp = timestamp();
  const runDirectory = path.join(repoRoot, 'out.nosync', 'claude-benchmarks', slug, runTimestamp);
  await mkdir(runDirectory, { recursive: true });
  const progress = opts.progress;
  progress?.event(`artifacts: ${path.relative(process.cwd(), runDirectory) || runDirectory}`);

  const artifacts: BenchmarkArtifacts = {
    runDirectory,
    promptPath: path.join(runDirectory, 'prompt.md'),
    mcpConfigPath: path.join(runDirectory, 'mcp-config.json'),
    mcpWorkspaceDirectory: path.join(runDirectory, 'mcp-workspace'),
    mcpWorkspaceConfigPath: path.join(
      runDirectory,
      'mcp-workspace',
      '.xcodebuildmcp',
      'config.yaml',
    ),
    claudeJsonlPath: path.join(runDirectory, 'claude.jsonl'),
    claudeStderrPath: path.join(runDirectory, 'claude.stderr'),
    claudeCommandLogPath: path.join(runDirectory, 'claude-command.log'),
    simulatorLifecycleLogPath: path.join(runDirectory, 'simulator-lifecycle.log'),
    parsedDirectory: path.join(runDirectory, 'parsed'),
    parseLogPath: path.join(runDirectory, 'parse.log'),
    resultJsonPath: path.join(runDirectory, 'result.json'),
  };

  let temporarySimulator: CreatedTemporarySimulator | undefined;
  let temporarySimulatorRun: TemporarySimulatorRunMetadata | undefined;
  let result: BenchmarkResult | undefined;

  try {
    const simulatorPlan = resolveTemporarySimulatorPlan(config);
    if (simulatorPlan.enabled) {
      progress?.event(`creating temporary simulator (${simulatorPlan.deviceTypeName})`);
    } else if (simulatorPlan.existingSimulatorId) {
      progress?.event(`using suite simulatorId ${simulatorPlan.existingSimulatorId}`);
    } else {
      progress?.event(`temporary simulator disabled (${simulatorPlan.reason ?? 'not enabled'})`);
    }

    const simulatorSetupStarted = process.hrtime.bigint();
    temporarySimulator = await prepareTemporarySimulator({
      config,
      suiteSlug: slug,
      timestamp: runTimestamp,
      cwd: repoRoot,
      logPath: artifacts.simulatorLifecycleLogPath,
      executor: opts.simulatorExecutor,
      onEvent: (message) => progress?.event(message),
    });
    const simulatorSetupDurationSeconds =
      Number(process.hrtime.bigint() - simulatorSetupStarted) / 1_000_000_000;
    temporarySimulatorRun = temporarySimulatorMetadata(
      temporarySimulator,
      simulatorSetupDurationSeconds,
    );
    if (temporarySimulator) {
      progress?.event(`simulator setup took ${simulatorSetupDurationSeconds.toFixed(2)}s`);
    }

    const effectiveSimulatorId = requireFirstRunPreflightSimulatorId(config, temporarySimulator);
    if (effectiveSimulatorId) {
      await dismissFirstRunPrompts({
        config,
        simulatorId: effectiveSimulatorId,
        cwd: repoRoot,
        logPath: artifacts.simulatorLifecycleLogPath,
        executor: opts.simulatorExecutor,
        onEvent: (message) => progress?.event(message),
      });
    }

    const suiteDirectory = path.dirname(suitePath);
    const promptPath = resolveFrom(suiteDirectory, config.prompt);
    const workingDirectory = config.workingDirectory
      ? resolveFrom(repoRoot, config.workingDirectory)
      : repoRoot;
    const prompt = await readFile(promptPath, 'utf8');

    await writeFile(artifacts.promptPath, prompt, 'utf8');
    await writeMcpConfig({
      config,
      mcpConfigPath: artifacts.mcpConfigPath,
      mcpWorkspaceDirectory: artifacts.mcpWorkspaceDirectory,
      mcpWorkspaceConfigPath: artifacts.mcpWorkspaceConfigPath,
      workingDirectory,
      temporarySimulator,
    });

    const claudeArgs = [
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--mcp-config',
      artifacts.mcpConfigPath,
      '--strict-mcp-config',
      '--permission-mode',
      'bypassPermissions',
      '--allowedTools',
      `${mcpToolPrefix}*`,
    ];
    await writeFile(
      artifacts.claudeCommandLogPath,
      `Run dir: ${runDirectory}\nCommand: claude ${claudeArgs.join(' ')} < ${artifacts.promptPath} > ${artifacts.claudeJsonlPath} 2> ${artifacts.claudeStderrPath}\nWorking directory: ${workingDirectory}\nMCP workspace: ${artifacts.mcpWorkspaceDirectory}\nMCP workspace config: ${artifacts.mcpWorkspaceConfigPath}\nSimulator lifecycle log: ${artifacts.simulatorLifecycleLogPath}\nSimulator ID: ${effectiveSimulatorId ?? 'suite/default'}\nStarted: ${new Date().toISOString()}\n`,
      'utf8',
    );

    progress?.event('launching claude');
    const claude = await runCommand({
      command: 'claude',
      args: claudeArgs,
      cwd: workingDirectory,
      stdin: prompt,
      stdoutPath: artifacts.claudeJsonlPath,
      stderrPath: artifacts.claudeStderrPath,
      env: claudeBenchmarkEnv(),
    });
    progress?.event(
      `claude finished in ${claude.durationSeconds.toFixed(2)}s (exit ${claude.exitCode ?? 'null'})`,
    );

    await writeFile(
      artifacts.claudeCommandLogPath,
      `Finished: ${new Date().toISOString()}\nExit status: ${claude.exitCode}\nWall clock seconds: ${claude.durationSeconds.toFixed(2)}\n`,
      { flag: 'a' },
    );

    progress?.event('parsing transcript');
    const parserExitCode = await runParser(artifacts, parserPath);
    progress?.event(`parser finished (exit ${parserExitCode ?? 'null'})`);

    progress?.event('evaluating result');
    const jsonl = await readFile(artifacts.claudeJsonlPath, 'utf8');
    const audit = analyzeClaudeJsonl(jsonl, {
      mcpToolPrefix,
      failurePatterns: config.failurePatterns,
    });
    const run: BenchmarkRunMetadata = {
      suitePath,
      wallClockSeconds: claude.durationSeconds,
      claudeExitCode: claude.exitCode,
      parserExitCode,
      artifacts,
      temporarySimulator: temporarySimulatorRun,
    };
    result = compareBenchmark(config, audit, run);
  } finally {
    if (temporarySimulator) {
      progress?.event(`cleaning up simulator ${temporarySimulator.simulatorId}`);
      try {
        const deletion = await deleteTemporarySimulator(temporarySimulator, {
          cwd: repoRoot,
          executor: opts.simulatorExecutor,
        });
        recordTemporarySimulatorDeletion(temporarySimulatorRun, deletion);
        progress?.event(
          deletion.succeeded
            ? 'simulator deleted'
            : `simulator delete failed (exit ${deletion.exitCode ?? 'null'})`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordTemporarySimulatorDeletion(temporarySimulatorRun, {
          attempted: true,
          succeeded: false,
          exitCode: null,
          error: message,
        });
        progress?.event(`simulator delete failed (${message})`);
      }
    }
  }

  if (!result) throw new Error(`${suitePath}: suite did not produce a result`);
  await writeFile(artifacts.resultJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

export async function main(argv = hideBin(process.argv)): Promise<number> {
  const args = await yargs(argv)
    .option('suite', { type: 'string', describe: 'Suite name or path to a suite YAML file' })
    .option('all', {
      type: 'boolean',
      default: false,
      describe: 'Run every YAML suite in benchmarks/claude-ui/suites',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Print machine-readable JSON results',
    })
    .option('parser', {
      type: 'string',
      describe: `Path to parse_claude_conversation.py (defaults to benchmarks/claude-ui/parse_claude_conversation.py; can also set ${parserEnvName})`,
    })
    .option('from-result', {
      type: 'string',
      describe: 'Render an existing result.json or artifact directory without running Claude',
    })
    .strict()
    .parse();

  if (args.fromResult) {
    if (args.all || args.suite) {
      throw new Error('pass --from-result without --suite or --all');
    }

    const storedResult = await readStoredResult(args.fromResult);
    const results = Array.isArray(storedResult) ? storedResult : [storedResult];
    if (args.json) {
      process.stdout.write(`${JSON.stringify(storedResult, null, 2)}\n`);
    } else {
      for (const item of results) process.stdout.write(renderSuiteReport(item));
      if (results.length > 1) process.stdout.write(`\n${renderAggregate(results)}`);
    }
    return results.every((item) => item.pass) ? 0 : 1;
  }

  if ((args.all && args.suite) || (!args.all && !args.suite)) {
    throw new Error('pass exactly one of --suite <name-or-path>, --all, or --from-result <path>');
  }

  const suitePaths = requireSuitePaths(
    args.all ? await listSuitePaths() : [resolveSuitePath(args.suite as string)],
  );
  const progress = createProgressReporter({ enabled: !args.json });
  const results: BenchmarkResult[] = [];
  for (let index = 0; index < suitePaths.length; index += 1) {
    const suitePath = suitePaths[index]!;
    progress.setSuite(
      index + 1,
      suitePaths.length,
      path.basename(suitePath, path.extname(suitePath)),
    );
    const item = await runSuite(suitePath, { progress, parserPath: args.parser });
    results.push(item);
    progress.event(`suite ${item.pass ? 'passed' : 'failed'}`);
    if (!args.json) process.stdout.write(renderSuiteReport(item));
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(args.all ? results : results[0], null, 2)}\n`);
  } else if (args.all && results.length > 1) {
    process.stdout.write(`\n${renderAggregate(results)}`);
  }

  return results.every((item) => item.pass) ? 0 : 1;
}
