import { mcpToolPrefix } from './constants.ts';
import type {
  BenchmarkArtifacts,
  BenchmarkConfig,
  ClaudeInvocationConfig,
  ToolAnalysisConfig,
} from './types.ts';

export function usesMcpServer(config: BenchmarkConfig): boolean {
  return config.claude?.useMcpServer ?? true;
}

function renderTemplate(value: string, variables: Record<string, string>): string {
  return value.replaceAll(/{([A-Za-z0-9_]+)}/g, (match, key: string) => variables[key] ?? match);
}

function templateVariables(opts: {
  runDirectory: string;
  workingDirectory: string;
  simulatorId?: string;
}): Record<string, string> {
  return {
    runDirectory: opts.runDirectory,
    workingDirectory: opts.workingDirectory,
    simulatorId: opts.simulatorId ?? 'suite/default',
  };
}

export function buildClaudeArgs(opts: {
  config: BenchmarkConfig;
  artifacts: BenchmarkArtifacts;
  workingDirectory: string;
  pluginDirs?: string[];
  simulatorId?: string;
  model?: string;
  resumeSessionId?: string;
  sessionId?: string;
}): string[] {
  const claudeConfig: ClaudeInvocationConfig = opts.config.claude ?? {};
  const useMcpServer = usesMcpServer(opts.config);
  const allowedTools = claudeConfig.allowedTools ?? (useMcpServer ? [`${mcpToolPrefix}*`] : []);
  const args = ['-p', '--verbose', '--output-format', 'stream-json'];
  if (opts.sessionId) {
    args.push('--session-id', opts.sessionId);
  }
  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }
  args.push('--disable-slash-commands');
  const permissionMode = claudeConfig.permissionMode ?? 'bypassPermissions';
  if (permissionMode !== 'default') {
    args.push('--permission-mode', permissionMode);
  }

  args.push('--mcp-config', opts.artifacts.mcpConfigPath, '--strict-mcp-config');
  if (claudeConfig.tools && claudeConfig.tools.length > 0) {
    args.push('--tools', claudeConfig.tools.join(','));
  }
  if (allowedTools.length > 0) {
    args.push('--allowedTools', allowedTools.join(','));
  }
  const model = opts.model ?? claudeConfig.model;
  if (model) {
    args.push('--model', model);
  }
  if (claudeConfig.appendSystemPrompt) {
    args.push(
      '--append-system-prompt',
      renderTemplate(
        claudeConfig.appendSystemPrompt,
        templateVariables({
          runDirectory: opts.artifacts.runDirectory,
          workingDirectory: opts.workingDirectory,
          simulatorId: opts.simulatorId,
        }),
      ),
    );
  }
  for (const pluginDir of opts.pluginDirs ?? []) {
    args.push('--plugin-dir', pluginDir);
  }
  args.push(...(claudeConfig.extraArgs ?? []));
  return args;
}

export function benchmarkContextEnv(opts: {
  runDirectory: string;
  workingDirectory: string;
  simulatorId?: string;
}): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries({
      CLAUDE_UI_BENCHMARK_RUN_DIR: opts.runDirectory,
      CLAUDE_UI_BENCHMARK_WORKING_DIRECTORY: opts.workingDirectory,
      CLAUDE_UI_BENCHMARK_SIMULATOR_ID: opts.simulatorId,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function parserToolArgs(toolAnalysis: ToolAnalysisConfig | undefined): string[] {
  if (!toolAnalysis) return [`--tool-prefix=${mcpToolPrefix}`];
  const args: string[] = [];
  const toolNames = new Set<string>();
  for (const matcher of toolAnalysis.matchers) {
    if (matcher.kind === 'namePrefix') args.push(`--tool-prefix=${matcher.prefix}`);
    if (matcher.kind === 'bashCommand') toolNames.add('Bash');
  }
  for (const toolName of toolNames) args.push(`--tool-name=${toolName}`);
  return args;
}
