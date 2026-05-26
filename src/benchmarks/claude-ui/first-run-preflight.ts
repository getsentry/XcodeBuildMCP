import { appendFile } from 'node:fs/promises';
import { getAxePath, getBundledAxeEnvironment } from '../../utils/axe-helpers.ts';
import {
  runLoggedCommand,
  type LifecycleCommandExecutor,
  type LifecycleProgressReporter,
} from './simulator-lifecycle.ts';
import type { BenchmarkConfig } from './types.ts';

export interface FirstRunPreflightTiming {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

function sessionDefaultBundleId(config: BenchmarkConfig): string | undefined {
  const value = config.sessionDefaults?.bundleId;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('sessionDefaults.bundleId must be a non-empty string');
  }
  return value;
}

async function appendLifecycleLog(logPath: string, message: string): Promise<void> {
  await appendFile(logPath, `${message}\n`, 'utf8');
}

async function terminatePreflightApp(opts: {
  config: BenchmarkConfig;
  simulatorId: string;
  bundleId: string;
  cwd: string;
  logPath: string;
  executor: LifecycleCommandExecutor;
  suppressFailure: boolean;
}): Promise<void> {
  let terminate: Awaited<ReturnType<LifecycleCommandExecutor>>;
  try {
    terminate = await opts.executor({
      command: 'xcrun',
      args: ['simctl', 'terminate', opts.simulatorId, opts.bundleId],
      cwd: opts.cwd,
      logPath: opts.logPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (opts.suppressFailure) {
      await appendLifecycleLog(
        opts.logPath,
        `First-run prompt preflight terminate failed: ${message}`,
      );
      return;
    }
    throw error;
  }

  if (terminate.exitCode === 0) return;

  const message = `${opts.config.name}: failed to terminate app after first-run prompt preflight (exit ${terminate.exitCode}); see ${opts.logPath}`;
  if (opts.suppressFailure) {
    await appendLifecycleLog(
      opts.logPath,
      `First-run prompt preflight terminate failed: ${message}`,
    );
    return;
  }
  throw new Error(message);
}

function readNodeText(node: unknown, key: string): string | undefined {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined;
  const value = (node as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNodeChildren(node: unknown): unknown[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return [];
  const value = (node as Record<string, unknown>).children;
  return Array.isArray(value) ? value : [];
}

function parseDescribeUiElements(output: string): unknown[] {
  const parsed = JSON.parse(output) as unknown;
  if (Array.isArray(parsed)) return parsed;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as { elements?: unknown }).elements)
  ) {
    return (parsed as { elements: unknown[] }).elements;
  }
  return [];
}

function hierarchyContainsLabel(elements: unknown[], label: string): boolean {
  const stack = [...elements];
  while (stack.length > 0) {
    const node = stack.pop();
    if (readNodeText(node, 'AXLabel') === label || readNodeText(node, 'label') === label) {
      return true;
    }
    stack.push(...readNodeChildren(node));
  }
  return false;
}

type FirstRunPromptSearchResult =
  | { status: 'found'; label: string }
  | { status: 'not-found'; hasElements: boolean }
  | { status: 'unavailable'; exitCode: number | null };

async function findFirstRunPromptLabel(opts: {
  simulatorId: string;
  labels: string[];
  cwd: string;
  logPath: string;
  executor: LifecycleCommandExecutor;
  axePath: string;
  axeEnv: NodeJS.ProcessEnv;
}): Promise<FirstRunPromptSearchResult> {
  const result = await opts.executor({
    command: opts.axePath,
    args: ['describe-ui', '--udid', opts.simulatorId],
    cwd: opts.cwd,
    logPath: opts.logPath,
    env: opts.axeEnv,
  });
  if (result.exitCode !== 0) return { status: 'unavailable', exitCode: result.exitCode };

  let elements: unknown[];
  try {
    elements = parseDescribeUiElements(result.stdout);
  } catch {
    return { status: 'unavailable', exitCode: null };
  }

  const label = opts.labels.find((item) => hierarchyContainsLabel(elements, item));
  return label
    ? { status: 'found', label }
    : { status: 'not-found', hasElements: elements.length > 0 };
}

const defaultTiming: FirstRunPreflightTiming = {
  now: () => Date.now(),
  sleep: async (milliseconds) => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  },
};

export async function dismissFirstRunPrompts(opts: {
  config: BenchmarkConfig;
  simulatorId: string;
  cwd: string;
  logPath: string;
  executor?: LifecycleCommandExecutor;
  onEvent?: LifecycleProgressReporter;
  axePath?: string;
  axeEnv?: NodeJS.ProcessEnv;
  timing?: FirstRunPreflightTiming;
}): Promise<void> {
  const dismissals = opts.config.firstRunPromptDismissals;
  if (!dismissals || dismissals.labels.length === 0) return;

  const bundleId = sessionDefaultBundleId(opts.config);
  if (!bundleId) {
    throw new Error(
      `${opts.config.name}: firstRunPromptDismissals requires sessionDefaults.bundleId`,
    );
  }

  const axePath = opts.axePath ?? getAxePath();
  if (!axePath) {
    throw new Error(`${opts.config.name}: firstRunPromptDismissals requires AXe to be available`);
  }

  const executor = opts.executor ?? runLoggedCommand;
  const axeEnv = opts.axeEnv ?? { ...process.env, ...getBundledAxeEnvironment() };
  const timing = opts.timing ?? defaultTiming;
  const timeoutMs = (dismissals.timeoutSeconds ?? 10) * 1000;

  opts.onEvent?.(`preflighting first-run prompts for ${bundleId}`);
  await appendLifecycleLog(
    opts.logPath,
    [
      'First-run prompt preflight: enabled',
      `Bundle ID: ${bundleId}`,
      `Labels: ${dismissals.labels.join(', ')}`,
    ].join('\n'),
  );

  const launch = await executor({
    command: 'xcrun',
    args: ['simctl', 'launch', opts.simulatorId, bundleId],
    cwd: opts.cwd,
    logPath: opts.logPath,
  });
  if (launch.exitCode !== 0) {
    throw new Error(
      `${opts.config.name}: failed to launch app for first-run prompt preflight (exit ${launch.exitCode}); see ${opts.logPath}`,
    );
  }

  try {
    const deadline = timing.now() + timeoutMs;
    let promptsDismissed = false;
    let consecutiveReadySnapshots = 0;
    while (timing.now() < deadline) {
      const search = await findFirstRunPromptLabel({
        simulatorId: opts.simulatorId,
        labels: dismissals.labels,
        cwd: opts.cwd,
        logPath: opts.logPath,
        executor,
        axePath,
        axeEnv,
      });

      if (search.status === 'unavailable') {
        consecutiveReadySnapshots = 0;
        await appendLifecycleLog(
          opts.logPath,
          `First-run prompt preflight: UI unavailable; retrying (exit ${search.exitCode})`,
        );
        await timing.sleep(500);
        continue;
      }

      if (search.status === 'not-found') {
        consecutiveReadySnapshots = search.hasElements ? consecutiveReadySnapshots + 1 : 0;
        if (consecutiveReadySnapshots >= 2) {
          promptsDismissed = true;
          break;
        }
        await timing.sleep(500);
        continue;
      }

      consecutiveReadySnapshots = 0;
      const { label } = search;
      opts.onEvent?.(`dismissing first-run prompt '${label}'`);
      await appendLifecycleLog(opts.logPath, `Dismissing first-run prompt label: ${label}`);
      const tap = await executor({
        command: axePath,
        args: ['tap', '--label', label, '--element-type', 'Button', '--udid', opts.simulatorId],
        cwd: opts.cwd,
        logPath: opts.logPath,
        env: axeEnv,
      });
      if (tap.exitCode !== 0) {
        throw new Error(
          `${opts.config.name}: failed to dismiss first-run prompt '${label}' (exit ${tap.exitCode}); see ${opts.logPath}`,
        );
      }
      await timing.sleep(500);
    }

    if (!promptsDismissed) {
      throw new Error(
        `${opts.config.name}: timed out during first-run prompt preflight; see ${opts.logPath}`,
      );
    }
  } finally {
    await terminatePreflightApp({
      config: opts.config,
      simulatorId: opts.simulatorId,
      bundleId,
      cwd: opts.cwd,
      logPath: opts.logPath,
      executor,
      suppressFailure: true,
    });
  }
  await appendLifecycleLog(opts.logPath, 'First-run prompt preflight: complete');
}
