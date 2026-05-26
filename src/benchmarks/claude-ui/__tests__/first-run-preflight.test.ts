import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dismissFirstRunPrompts } from '../first-run-preflight.ts';
import type { LifecycleCommandExecutor, LifecycleCommandOptions } from '../simulator-lifecycle.ts';
import type { BenchmarkConfig } from '../types.ts';

function config(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return {
    name: 'reminders',
    prompt: '../prompts/reminders.md',
    sessionDefaults: {
      simulatorName: 'iPhone 17 Pro Max',
      bundleId: 'com.apple.reminders',
    },
    firstRunPromptDismissals: {
      labels: ['Continue', 'Not Now'],
      timeoutSeconds: 5,
    },
    ...overrides,
  };
}

async function tempLogPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-ui-first-run-'));
  return path.join(directory, 'simulator-lifecycle.log');
}

function describeUiWithLabel(label: string): string {
  return JSON.stringify({
    elements: [
      {
        AXLabel: 'Application',
        children: [{ AXLabel: label, children: [] }],
      },
    ],
  });
}

const emptyDescribeUi = JSON.stringify({ elements: [] });
const loadedDescribeUi = describeUiWithLabel('Application Ready');

describe('Claude UI first-run prompt preflight', () => {
  it('launches the app, dismisses configured first-run prompts, and terminates before Claude runs', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const events: string[] = [];
    const describeOutputs = [
      describeUiWithLabel('Continue'),
      describeUiWithLabel('Not Now'),
      loadedDescribeUi,
    ];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        return {
          exitCode: 0,
          stdout: describeOutputs.shift() ?? loadedDescribeUi,
          stderr: '',
          durationSeconds: 0.01,
        };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };

    await dismissFirstRunPrompts({
      config: config(),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      axeEnv: { PATH: '/usr/bin' },
      timing: { now: () => 1_000, sleep: async () => {} },
      onEvent: (message) => events.push(message),
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      [
        '/mock/axe',
        'tap',
        '--label',
        'Continue',
        '--element-type',
        'Button',
        '--udid',
        'TEMP-SIM-123',
      ],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      [
        '/mock/axe',
        'tap',
        '--label',
        'Not Now',
        '--element-type',
        'Button',
        '--udid',
        'TEMP-SIM-123',
      ],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
    expect(events).toEqual([
      'preflighting first-run prompts for com.apple.reminders',
      "dismissing first-run prompt 'Continue'",
      "dismissing first-run prompt 'Not Now'",
    ]);
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain('First-run prompt preflight: enabled');
    expect(log).toContain('Dismissing first-run prompt label: Continue');
    expect(log).toContain('Dismissing first-run prompt label: Not Now');
    expect(log).toContain('First-run prompt preflight: complete');
  });

  it('keeps polling through empty transitions between sequential prompts', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const describeOutputs = [
      describeUiWithLabel('Continue'),
      emptyDescribeUi,
      describeUiWithLabel('Not Now'),
      loadedDescribeUi,
    ];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        return {
          exitCode: 0,
          stdout: describeOutputs.shift() ?? loadedDescribeUi,
          stderr: '',
          durationSeconds: 0.01,
        };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };
    let now = 1_000;

    await dismissFirstRunPrompts({
      config: config(),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      [
        '/mock/axe',
        'tap',
        '--label',
        'Continue',
        '--element-type',
        'Button',
        '--udid',
        'TEMP-SIM-123',
      ],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      [
        '/mock/axe',
        'tap',
        '--label',
        'Not Now',
        '--element-type',
        'Button',
        '--udid',
        'TEMP-SIM-123',
      ],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain('Dismissing first-run prompt label: Continue');
    expect(log).toContain('Dismissing first-run prompt label: Not Now');
  });

  it('keeps polling when initial app UI appears before first-run prompts', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const describeOutputs = [
      loadedDescribeUi,
      describeUiWithLabel('Continue'),
      loadedDescribeUi,
      loadedDescribeUi,
    ];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        return {
          exitCode: 0,
          stdout: describeOutputs.shift() ?? loadedDescribeUi,
          stderr: '',
          durationSeconds: 0.01,
        };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };

    await dismissFirstRunPrompts({
      config: config({ firstRunPromptDismissals: { labels: ['Continue'], timeoutSeconds: 5 } }),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: { now: () => 1_000, sleep: async () => {} },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      [
        '/mock/axe',
        'tap',
        '--label',
        'Continue',
        '--element-type',
        'Button',
        '--udid',
        'TEMP-SIM-123',
      ],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
  });

  it('retries transient describe-ui failures before dismissing prompts', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const describeResults = [
      { exitCode: 1, stdout: '' },
      { exitCode: 1, stdout: '' },
      { exitCode: 0, stdout: describeUiWithLabel('Continue') },
      { exitCode: 0, stdout: loadedDescribeUi },
    ];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        const result = describeResults.shift() ?? { exitCode: 0, stdout: loadedDescribeUi };
        return { ...result, stderr: '', durationSeconds: 0.01 };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };
    let now = 1_000;

    await dismissFirstRunPrompts({
      config: config(),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      [
        '/mock/axe',
        'tap',
        '--label',
        'Continue',
        '--element-type',
        'Button',
        '--udid',
        'TEMP-SIM-123',
      ],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain('First-run prompt preflight: UI unavailable; retrying (exit 1)');
    expect(log).toContain('Dismissing first-run prompt label: Continue');
  });

  it('starts the prompt timeout after app launch completes', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const describeResults = [
      { exitCode: 1, stdout: '' },
      { exitCode: 0, stdout: loadedDescribeUi },
    ];
    let now = 1_000;
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === 'xcrun' && opts.args[1] === 'launch') now += 9_000;
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        const result = describeResults.shift() ?? { exitCode: 0, stdout: loadedDescribeUi };
        return { ...result, stderr: '', durationSeconds: 0.01 };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };

    await dismissFirstRunPrompts({
      config: config({ firstRunPromptDismissals: { labels: ['Continue'], timeoutSeconds: 5 } }),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain('First-run prompt preflight: UI unavailable; retrying (exit 1)');
    expect(log).toContain('First-run prompt preflight: complete');
  });

  it('does not fail after prompts are gone even when the timeout deadline has passed', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        return { exitCode: 0, stdout: loadedDescribeUi, stderr: '', durationSeconds: 0.01 };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };
    let nowCalls = 0;

    await dismissFirstRunPrompts({
      config: config(),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: {
        now: () => {
          nowCalls += 1;
          return nowCalls <= 3 ? 1_000 : 7_000;
        },
        sleep: async () => {},
      },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain('First-run prompt preflight: complete');
  });

  it('waits for observable UI before treating missing prompt labels as complete', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const describeResults = [
      { exitCode: 0, stdout: emptyDescribeUi },
      { exitCode: 0, stdout: loadedDescribeUi },
    ];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        const result = describeResults.shift() ?? { exitCode: 0, stdout: loadedDescribeUi };
        return { ...result, stderr: '', durationSeconds: 0.01 };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };
    let now = 1_000;

    await dismissFirstRunPrompts({
      config: config(),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
  });

  it('terminates the app when prompt dismissal times out after launch', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        return { exitCode: 0, stdout: emptyDescribeUi, stderr: '', durationSeconds: 0.01 };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };
    let now = 1_000;

    await expect(
      dismissFirstRunPrompts({
        config: config({ firstRunPromptDismissals: { labels: ['Continue'], timeoutSeconds: 1 } }),
        simulatorId: 'TEMP-SIM-123',
        cwd: '/repo',
        logPath,
        executor,
        axePath: '/mock/axe',
        timing: {
          now: () => now,
          sleep: async (milliseconds) => {
            now += milliseconds;
          },
        },
      }),
    ).rejects.toThrow('timed out during first-run prompt preflight');

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
  });

  it('logs terminate failures after successful preflight', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const describeOutputs = [loadedDescribeUi, loadedDescribeUi];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        return {
          exitCode: 0,
          stdout: describeOutputs.shift() ?? loadedDescribeUi,
          stderr: '',
          durationSeconds: 0.01,
        };
      }
      if (opts.command === 'xcrun' && opts.args[1] === 'terminate') {
        return { exitCode: 1, stdout: '', stderr: 'not running', durationSeconds: 0.01 };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };

    await dismissFirstRunPrompts({
      config: config({ firstRunPromptDismissals: { labels: ['Continue'], timeoutSeconds: 5 } }),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: { now: () => 1_000, sleep: async () => {} },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain('First-run prompt preflight terminate failed');
    expect(log).toContain('First-run prompt preflight: complete');
  });

  it('retries malformed describe-ui output as transiently unavailable', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const describeResults = [
      { exitCode: 0, stdout: 'not json' },
      { exitCode: 0, stdout: loadedDescribeUi },
    ];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.command === '/mock/axe' && opts.args[0] === 'describe-ui') {
        const result = describeResults.shift() ?? { exitCode: 0, stdout: loadedDescribeUi };
        return { ...result, stderr: '', durationSeconds: 0.01 };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };
    let now = 1_000;

    await dismissFirstRunPrompts({
      config: config(),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
      timing: {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      },
    });

    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'launch', 'TEMP-SIM-123', 'com.apple.reminders'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['/mock/axe', 'describe-ui', '--udid', 'TEMP-SIM-123'],
      ['xcrun', 'simctl', 'terminate', 'TEMP-SIM-123', 'com.apple.reminders'],
    ]);
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain('First-run prompt preflight: UI unavailable; retrying (exit null)');
  });

  it('does nothing when a suite has no configured first-run prompt dismissals', async () => {
    const logPath = await tempLogPath();
    const commands: LifecycleCommandOptions[] = [];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };

    await dismissFirstRunPrompts({
      config: config({ firstRunPromptDismissals: undefined }),
      simulatorId: 'TEMP-SIM-123',
      cwd: '/repo',
      logPath,
      executor,
      axePath: '/mock/axe',
    });

    expect(commands).toEqual([]);
  });

  it('requires a bundleId because the harness preflights the app outside Claude', async () => {
    const logPath = await tempLogPath();

    await expect(
      dismissFirstRunPrompts({
        config: config({ sessionDefaults: { simulatorName: 'iPhone 17 Pro Max' } }),
        simulatorId: 'TEMP-SIM-123',
        cwd: '/repo',
        logPath,
        executor: async () => ({ exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 }),
        axePath: '/mock/axe',
      }),
    ).rejects.toThrow('firstRunPromptDismissals requires sessionDefaults.bundleId');
  });
});
