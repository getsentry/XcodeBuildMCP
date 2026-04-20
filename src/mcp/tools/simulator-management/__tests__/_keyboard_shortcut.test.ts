import { describe, it, expect } from 'vitest';
import {
  createMockCommandResponse,
  type CommandExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { sendKeyboardShortcut } from '../_keyboard_shortcut.ts';

const BOOTED_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { udid: 'test-uuid-123', name: 'iPhone 15 Pro', state: 'Booted' },
    ],
  },
});

const SHUTDOWN_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { udid: 'test-uuid-123', name: 'iPhone 15 Pro', state: 'Shutdown' },
    ],
  },
});

const EMPTY_JSON = JSON.stringify({ devices: {} });
const ESCAPED_NAME_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { udid: 'escaped-uuid', name: 'Test\\Device"', state: 'Booted' },
    ],
  },
});
const PREFIX_NAME_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { udid: 'prefix-uuid', name: 'iPhone 15', state: 'Booted' },
    ],
  },
});

type Call = { command: string[] };

function makeFifoExecutor(
  responses: Array<{ success: boolean; output?: string; error?: string }>,
): { executor: CommandExecutor; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const executor: CommandExecutor = async (command) => {
    calls.push({ command });
    const r = responses[i] ?? { success: true, output: '' };
    i += 1;
    return createMockCommandResponse({
      success: r.success,
      output: r.output ?? '',
      error: r.error,
    });
  };
  return { executor, calls };
}

describe('sendKeyboardShortcut', () => {
  it('sends Cmd+K for software-keyboard when simulator is booted and window exists', async () => {
    const { executor, calls } = makeFifoExecutor([
      { success: true, output: BOOTED_JSON },
      { success: true, output: '' },
      { success: true, output: 'OK' },
      { success: true, output: '' },
    ]);

    const result = await sendKeyboardShortcut('test-uuid-123', 'software-keyboard', executor);

    expect(result.success).toBe(true);
    expect(calls[0].command).toEqual(['xcrun', 'simctl', 'list', 'devices', '--json']);
    expect(calls[1].command).toEqual(['open', '-a', 'Simulator']);
    expect(calls[2].command[0]).toBe('osascript');
    expect(calls[2].command.join(' ')).toContain('iPhone 15 Pro');
    expect(calls[3].command[0]).toBe('osascript');
    const keystrokeScript = calls[3].command.join(' ');
    expect(keystrokeScript).toContain('keystroke "k"');
    expect(keystrokeScript).toContain('command down');
    expect(keystrokeScript).not.toContain('shift down');
  });

  it('sends Cmd+Shift+K for connect-hardware-keyboard', async () => {
    const { executor, calls } = makeFifoExecutor([
      { success: true, output: BOOTED_JSON },
      { success: true, output: '' },
      { success: true, output: 'OK' },
      { success: true, output: '' },
    ]);

    const result = await sendKeyboardShortcut(
      'test-uuid-123',
      'connect-hardware-keyboard',
      executor,
    );

    expect(result.success).toBe(true);
    const keystrokeScript = calls[3].command.join(' ');
    expect(keystrokeScript).toContain('keystroke "k"');
    expect(keystrokeScript).toContain('command down');
    expect(keystrokeScript).toContain('shift down');
  });

  it('escapes backslashes before embedding simulator names in the focus AppleScript', async () => {
    const { executor, calls } = makeFifoExecutor([
      { success: true, output: ESCAPED_NAME_JSON },
      { success: true, output: '' },
      { success: true, output: 'OK' },
      { success: true, output: '' },
    ]);

    const result = await sendKeyboardShortcut('escaped-uuid', 'software-keyboard', executor);

    expect(result.success).toBe(true);
    expect(calls[2].command[2]).toContain('Test\\\\Device\\"');
  });

  it('matches the simulator window by exact title or runtime suffix instead of substring contains', async () => {
    const { executor, calls } = makeFifoExecutor([
      { success: true, output: PREFIX_NAME_JSON },
      { success: true, output: '' },
      { success: true, output: 'OK' },
      { success: true, output: '' },
    ]);

    const result = await sendKeyboardShortcut('prefix-uuid', 'software-keyboard', executor);

    expect(result.success).toBe(true);
    expect(calls[2].command[2]).toContain('title is "iPhone 15"');
    expect(calls[2].command[2]).toContain('title starts with "iPhone 15 –"');
    expect(calls[2].command[2]).not.toContain('title contains');
  });

  it('errors when simulator UUID is not found', async () => {
    const { executor, calls } = makeFifoExecutor([{ success: true, output: EMPTY_JSON }]);

    const result = await sendKeyboardShortcut('missing-uuid', 'software-keyboard', executor);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('missing-uuid');
      expect(result.error).toContain('not found');
    }
    expect(calls).toHaveLength(1);
  });

  it('errors when simulator is not booted', async () => {
    const { executor, calls } = makeFifoExecutor([{ success: true, output: SHUTDOWN_JSON }]);

    const result = await sendKeyboardShortcut('test-uuid-123', 'software-keyboard', executor);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not booted');
    }
    expect(calls).toHaveLength(1);
  });

  it('errors when `open -a Simulator` fails', async () => {
    const { executor, calls } = makeFifoExecutor([
      { success: true, output: BOOTED_JSON },
      { success: false, error: 'could not open' },
    ]);

    const result = await sendKeyboardShortcut('test-uuid-123', 'software-keyboard', executor);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Simulator app');
    }
    expect(calls).toHaveLength(2);
  });

  it('errors and does not send keystroke when window lookup returns NO_WINDOW', async () => {
    const { executor, calls } = makeFifoExecutor([
      { success: true, output: BOOTED_JSON },
      { success: true, output: '' },
      { success: true, output: 'NO_WINDOW' },
    ]);

    const result = await sendKeyboardShortcut('test-uuid-123', 'software-keyboard', executor);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('iPhone 15 Pro');
    }
    expect(calls).toHaveLength(3);
  });

  it('errors when simctl list fails', async () => {
    const { executor } = makeFifoExecutor([{ success: false, error: 'simctl blew up' }]);

    const result = await sendKeyboardShortcut('test-uuid-123', 'software-keyboard', executor);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('simctl blew up');
    }
  });

  it('errors when keystroke osascript fails', async () => {
    const { executor } = makeFifoExecutor([
      { success: true, output: BOOTED_JSON },
      { success: true, output: '' },
      { success: true, output: 'OK' },
      { success: false, error: 'accessibility denied' },
    ]);

    const result = await sendKeyboardShortcut('test-uuid-123', 'software-keyboard', executor);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('accessibility denied');
    }
  });
});
