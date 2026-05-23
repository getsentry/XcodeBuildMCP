import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareBenchmark, diffToolSequence } from '../compare.ts';
import { readConfig } from '../config.ts';
import { requireSuitePaths, resolveParserPath } from '../harness.ts';
import { analyzeClaudeJsonl } from '../transcript.ts';
import type { BenchmarkConfig, BenchmarkRunMetadata } from '../types.ts';

const toolPrefix = 'mcp__xcodebuildmcp-dev__';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function line(value: unknown): string {
  return JSON.stringify(value);
}

function runParserScript(args: string[]): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function runMetadata(
  wallClockSeconds: number,
  claudeExitCode = 0,
  parserExitCode = 0,
): BenchmarkRunMetadata {
  return {
    suitePath: '/tmp/weather.yml',
    wallClockSeconds,
    claudeExitCode,
    parserExitCode,
    artifacts: {
      runDirectory: '/tmp/run',
      promptPath: '/tmp/run/prompt.md',
      mcpConfigPath: '/tmp/run/mcp-config.json',
      mcpWorkspaceDirectory: '/tmp/run/mcp-workspace',
      mcpWorkspaceConfigPath: '/tmp/run/mcp-workspace/.xcodebuildmcp/config.yaml',
      claudeJsonlPath: '/tmp/run/claude.jsonl',
      claudeStderrPath: '/tmp/run/claude.stderr',
      claudeCommandLogPath: '/tmp/run/claude-command.log',
      simulatorLifecycleLogPath: '/tmp/run/simulator-lifecycle.log',
      parsedDirectory: '/tmp/run/parsed',
      parseLogPath: '/tmp/run/parse.log',
      resultJsonPath: '/tmp/run/result.json',
    },
  };
}

describe('Claude UI benchmark harness', () => {
  const parserEnvName = 'CLAUDE_UI_BENCHMARK_PARSER';
  const originalParserEnv = process.env[parserEnvName];

  afterEach(() => {
    if (originalParserEnv === undefined) {
      delete process.env[parserEnvName];
    } else {
      process.env[parserEnvName] = originalParserEnv;
    }
  });

  it('defaults to the bundled parser path', async () => {
    delete process.env[parserEnvName];

    await expect(resolveParserPath(undefined)).resolves.toBe(
      path.join(repoRoot, 'benchmarks/claude-ui/parse_claude_conversation.py'),
    );
  });

  it('prefers configured parser paths and rejects missing files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'claude-ui-parser-'));
    try {
      const parserPath = path.join(dir, 'parse_claude_conversation.py');
      await writeFile(parserPath, '# parser\n', 'utf8');

      await expect(resolveParserPath(parserPath)).resolves.toBe(parserPath);
      await expect(resolveParserPath(path.join(dir, 'missing.py'))).rejects.toThrow(
        'Claude UI benchmark parser does not exist',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects empty --all suite discovery', () => {
    expect(() => requireSuitePaths([])).toThrow(
      'no suite files found in benchmarks/claude-ui/suites',
    );
  });

  it('returns a non-zero parser exit when JSONL lines are malformed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'claude-ui-parser-'));
    try {
      const jsonlPath = path.join(dir, 'claude.jsonl');
      const outputPath = path.join(dir, 'parsed');
      await writeFile(
        jsonlPath,
        `${line({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } })}\n{broken\n`,
        'utf8',
      );

      const result = await runParserScript([
        path.join(repoRoot, 'benchmarks/claude-ui/parse_claude_conversation.py'),
        jsonlPath,
        outputPath,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('warn: skipping line 2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Claude UI benchmark analysis', () => {
  it('keeps task prompts deterministic', async () => {
    const [contacts, reminders, weather] = await Promise.all([
      readFile(path.join(repoRoot, 'benchmarks/claude-ui/prompts/contacts.md'), 'utf8'),
      readFile(path.join(repoRoot, 'benchmarks/claude-ui/prompts/reminders.md'), 'utf8'),
      readFile(path.join(repoRoot, 'benchmarks/claude-ui/prompts/weather.md'), 'utf8'),
    ]);

    for (const prompt of [contacts, reminders, weather]) {
      expect(prompt).not.toContain('Use only the XcodeBuildMCP MCP tools');
    }

    expect(contacts).toContain('First name: `MCP`');
    expect(contacts).toContain('Last name: `Contact Benchmark`');
    expect(contacts).toContain('Organization: `XcodeBuildMCP Benchmark`');
    expect(contacts).toContain('Phone: `555-010-4242`');
    expect(contacts).toContain('Email: `mcp.contact.benchmark@example.com`');

    expect(reminders).toContain('Create a new list named `MCP Benchmark List`');
    expect(reminders).toContain(
      'two completed reminders (`Buy milk benchmark`, `Call team benchmark`)',
    );
    expect(reminders).toContain('one incomplete reminder (`File report benchmark`)');

    expect(weather).toContain('Search by typing exactly `London`, then select the London result.');
    expect(weather).toContain('`London`, `11°`, precipitation `78%`, and visibility `9.7 km`');
    expect(weather).toContain('`10.7 mm` total expected');
    expect(weather).toContain('lightning `None`');
  });

  it('counts Claude, MCP, and UI automation tool calls from stream JSONL', () => {
    const transcript = [
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'ToolSearch', input: { query: 'x' } },
            { type: 'tool_use', id: 'tool-2', name: `${toolPrefix}snapshot_ui`, input: {} },
          ],
        },
      }),
      line({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-2',
              content: JSON.stringify({
                schema: 'x',
                didError: false,
                data: { summary: { status: 'SUCCEEDED' } },
              }),
            },
          ],
        },
      }),
      line({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-3',
              name: `${toolPrefix}tap`,
              input: { elementRef: 'e1' },
            },
          ],
        },
      }),
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1000,
        result: 'done',
      }),
    ].join('\n');

    const audit = analyzeClaudeJsonl(transcript, { mcpToolPrefix: toolPrefix });

    expect(audit.totalToolCalls).toBe(3);
    expect(audit.mcpToolCalls).toBe(2);
    expect(audit.uiAutomationCalls).toBe(2);
    expect(audit.mcpSequence.map((call) => call.shortName)).toEqual(['snapshot_ui', 'tap']);
    expect(audit.failures).toEqual([]);
    expect(audit.finalText).toBe('done');
  });

  it('reports tool failures and configured failure patterns', () => {
    const transcript = [
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-1', name: `${toolPrefix}wait_for_ui`, input: {} },
          ],
        },
      }),
      line({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'WAIT_TIMEOUT' },
          ],
        },
      }),
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'stale element ref observed' }] },
      }),
    ].join('\n');

    const audit = analyzeClaudeJsonl(transcript, {
      mcpToolPrefix: toolPrefix,
      failurePatterns: ['stale element ref'],
    });

    expect(audit.failures).toHaveLength(1);
    expect(audit.patternFailures).toHaveLength(1);
  });

  it('rejects malformed failure pattern regexes when loading config', () => {
    expect(() =>
      readConfig(
        {
          name: 'weather',
          prompt: 'prompt.md',
          failurePatterns: ['stale element ref', '[unclosed'],
        },
        'weather.yml',
      ),
    ).toThrow('weather.yml.failurePatterns[1]: invalid regular expression');
  });

  it('rejects invalid session defaults when loading config', () => {
    expect(() =>
      readConfig(
        {
          name: 'weather',
          prompt: 'prompt.md',
          sessionDefaults: {
            simulatorTypo: 'iPhone 17 Pro Max',
          },
        },
        'weather.yml',
      ),
    ).toThrow('Unrecognized key: "simulatorTypo"');

    expect(() =>
      readConfig(
        {
          name: 'weather',
          prompt: 'prompt.md',
          sessionDefaults: {
            projectPath: true,
          },
        },
        'weather.yml',
      ),
    ).toThrow('projectPath: Invalid input: expected string');

    expect(() =>
      readConfig(
        {
          name: 'weather',
          prompt: 'prompt.md',
          sessionDefaults: {
            arch: 'ppc',
          },
        },
        'weather.yml',
      ),
    ).toThrow('arch: Invalid option');
  });

  it('accepts session default env values supported by the runtime schema', () => {
    const config = readConfig(
      {
        name: 'weather',
        prompt: 'prompt.md',
        sessionDefaults: {
          env: { FEATURE_FLAG: '1' },
        },
      },
      'weather.yml',
    );

    expect(config.sessionDefaults?.env).toEqual({ FEATURE_FLAG: '1' });
  });

  it('warns by default when tool sequences drift', () => {
    const config: BenchmarkConfig = {
      name: 'weather',
      prompt: 'prompt.md',
      baseline: {
        totalToolCalls: 4,
        mcpToolCalls: 3,
        uiAutomationCalls: 2,
        wallClockSeconds: 120,
      },
      allowedVariance: {
        totalToolCalls: 1,
        mcpToolCalls: 0,
        uiAutomationCalls: 0,
        wallClockSeconds: 30,
      },
      expectedToolSequence: ['session_show_defaults', 'snapshot_ui', 'tap'],
    };
    const audit = analyzeClaudeJsonl(
      [
        line({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: `${toolPrefix}session_show_defaults`,
                input: {},
              },
              { type: 'tool_use', id: 'tool-2', name: `${toolPrefix}snapshot_ui`, input: {} },
              { type: 'tool_use', id: 'tool-3', name: `${toolPrefix}screenshot`, input: {} },
              { type: 'tool_use', id: 'tool-4', name: `${toolPrefix}tap`, input: {} },
              { type: 'tool_use', id: 'tool-5', name: 'Read', input: {} },
            ],
          },
        }),
      ].join('\n'),
      { mcpToolPrefix: toolPrefix },
    );

    const result = compareBenchmark(config, audit, runMetadata(145));

    expect(result.metrics.find((item) => item.name === 'totalToolCalls')?.pass).toBe(true);
    expect(result.metrics.find((item) => item.name === 'mcpToolCalls')?.pass).toBe(false);
    expect(result.sequence.mode).toBe('warn');
    expect(result.sequence.matched).toBe(false);
    expect(result.sequence.pass).toBe(true);
    expect(result.sequence.additional).toEqual(['screenshot']);
    expect(result.pass).toBe(false);
  });

  it('preserves default allowed variance when config only overrides some keys', () => {
    const config: BenchmarkConfig = readConfig(
      {
        name: 'weather',
        prompt: 'prompt.md',
        baseline: {
          totalToolCalls: 3,
          wallClockSeconds: 120,
        },
        allowedVariance: {
          wallClockSeconds: 30,
        },
      },
      'weather.yml',
    );
    const audit = analyzeClaudeJsonl(
      [
        line({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
              { type: 'tool_use', id: 'tool-2', name: 'Edit', input: {} },
              { type: 'tool_use', id: 'tool-3', name: 'Write', input: {} },
            ],
          },
        }),
      ].join('\n'),
      { mcpToolPrefix: toolPrefix },
    );

    const result = compareBenchmark(config, audit, runMetadata(145));

    expect(result.metrics).toEqual([
      {
        name: 'totalToolCalls',
        actual: 3,
        expected: 3,
        allowedVariance: 0,
        pass: true,
      },
      {
        name: 'wallClockSeconds',
        actual: 145,
        expected: 120,
        allowedVariance: 30,
        pass: true,
      },
    ]);
  });

  it('fails on tool sequence drift when strict mode is enabled', () => {
    const config: BenchmarkConfig = {
      name: 'weather',
      prompt: 'prompt.md',
      expectedToolSequence: ['session_show_defaults', 'snapshot_ui', 'tap'],
      sequence: { mode: 'fail' },
    };
    const audit = analyzeClaudeJsonl(
      [
        line({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: `${toolPrefix}session_show_defaults`,
                input: {},
              },
              { type: 'tool_use', id: 'tool-2', name: `${toolPrefix}snapshot_ui`, input: {} },
              { type: 'tool_use', id: 'tool-3', name: `${toolPrefix}screenshot`, input: {} },
              { type: 'tool_use', id: 'tool-4', name: `${toolPrefix}tap`, input: {} },
            ],
          },
        }),
      ].join('\n'),
      { mcpToolPrefix: toolPrefix },
    );

    const result = compareBenchmark(config, audit, runMetadata(10));

    expect(result.sequence.mode).toBe('fail');
    expect(result.sequence.matched).toBe(false);
    expect(result.sequence.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('fails the benchmark when the external parser fails', () => {
    const config: BenchmarkConfig = {
      name: 'weather',
      prompt: 'prompt.md',
    };
    const audit = analyzeClaudeJsonl('', { mcpToolPrefix: toolPrefix });

    const result = compareBenchmark(config, audit, runMetadata(10, 0, 1));

    expect(result.failureMetric.pass).toBe(false);
    expect(result.failureMetric.count).toBe(1);
    expect(result.pass).toBe(false);
  });

  it('returns no sequence hunks when expected and actual match', () => {
    expect(diffToolSequence(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});
